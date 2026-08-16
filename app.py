# -*- coding: utf-8 -*-
"""
Todoister — task editor as a native window (pywebview + WebView2).

The server runs in a daemon thread; the HTML opens in a real window.
Closing the window stops the server too.
"""
import os
import sys
import time
import threading
import urllib.request
import ctypes
import json
import winreg

from paths import RES_DIR, DATA_DIR

os.environ["NO_BROWSER"] = "1"

# Under pythonw.exe stdout/stderr=None, so print() would crash. Redirect to a file.
_BASE = RES_DIR
if sys.stdout is None or sys.stderr is None:
    _log_path = os.path.join(DATA_DIR, "app.log")
    _f = open(_log_path, "a", encoding="utf-8", buffering=1)
    sys.stdout = _f
    sys.stderr = _f

import webview
from http.server import ThreadingHTTPServer

from server import Handler, PORT, DB_PATH, now, ensure_schema, SYNC_INTERVAL, gcal_reconcile
from store import db as store_db, split_due
import sync as sync_mod

URL = f"http://localhost:{PORT}"
WINDOW_TITLE = "Todoister"
ICON_PATH = os.path.join(_BASE, "assets", "icon.ico")


def set_app_id():
    """Give this process its own Windows taskbar identity (AppUserModelID).
    Without it, Windows groups our window under the .exe that launched it — here the
    shared ctkmaker venv python.exe — so it shows ctkmaker's taskbar icon/grouping.
    Must run before the window is created."""
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Kandelucky.Todoister")
    except Exception as e:
        print(f"[{now()}] set app id failed: {e}", flush=True)


def style_window(*_args):
    """Give the native window a dark title bar (matching the app background) and
    the Todoister icon. Windows-only; silently no-ops elsewhere or on failure."""
    try:
        hwnd = ctypes.windll.user32.FindWindowW(None, WINDOW_TITLE)
        if not hwnd:
            return
        dwm = ctypes.windll.dwmapi
        # DWMWA_USE_IMMERSIVE_DARK_MODE = 20 (dark caption buttons/text)
        dark = ctypes.c_int(1)
        dwm.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(dark), ctypes.sizeof(dark))
        # DWMWA_CAPTION_COLOR = 35 — exact title-bar color (COLORREF 0x00BBGGRR) = #1e1e1e
        color = ctypes.c_int(0x001E1E1E)
        dwm.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(color), ctypes.sizeof(color))
        # Window + taskbar icon. Load explicit big/small sizes (not LR_DEFAULTSIZE)
        # and set both the window icon (WM_SETICON) and the class icon
        # (SetClassLongPtr) so the live taskbar icon is ours, bypassing stale caches.
        if os.path.exists(ICON_PATH):
            u = ctypes.windll.user32
            LR = 0x00000010  # LR_LOADFROMFILE
            big = u.LoadImageW(None, ICON_PATH, 1, 32, 32, LR)    # IMAGE_ICON
            small = u.LoadImageW(None, ICON_PATH, 1, 16, 16, LR)
            set_class = getattr(u, "SetClassLongPtrW", None) or u.SetClassLongW
            if big:
                u.SendMessageW(hwnd, 0x0080, 1, big)   # WM_SETICON, ICON_BIG
                try: set_class(hwnd, -14, big)         # GCLP_HICON
                except Exception: pass
            if small:
                u.SendMessageW(hwnd, 0x0080, 0, small)  # WM_SETICON, ICON_SMALL
                try: set_class(hwnd, -34, small)        # GCLP_HICONSM
                except Exception: pass
    except Exception as e:
        print(f"[{now()}] window styling failed: {e}", flush=True)

# ---------------------------------------------------------------------------
# Single instance — a named mutex owned by the first process. A second launch
# finds it, brings the existing window to the front and quits silently.
# Windows releases the mutex automatically when the owning process dies, so a
# crash never leaves a stale lock behind.
# ---------------------------------------------------------------------------
_MUTEX_NAME = "Local\\Kandelucky.Todoister.SingleInstance"
_ERROR_ALREADY_EXISTS = 183
_instance_mutex = None  # keep the handle alive for the whole process lifetime


def another_instance_running():
    """Try to become THE instance. Returns True if one already exists."""
    global _instance_mutex
    try:
        k32 = ctypes.windll.kernel32
        k32.CreateMutexW.restype = ctypes.c_void_p
        h = k32.CreateMutexW(None, False, _MUTEX_NAME)
        already = (k32.GetLastError() == _ERROR_ALREADY_EXISTS)
        _instance_mutex = h
        return already
    except Exception as e:
        print(f"[{now()}] single-instance check failed: {e}", flush=True)
        return False


def focus_existing_window():
    """Bring the already-open Todoister window to the foreground (restore if
    minimized). Uses the AttachThreadInput trick when Windows refuses a plain
    SetForegroundWindow from a fresh process."""
    try:
        u = ctypes.windll.user32
        hwnd = u.FindWindowW(None, WINDOW_TITLE)
        if not hwnd:
            return
        SW_RESTORE, SW_SHOW = 9, 5
        u.ShowWindow(hwnd, SW_RESTORE if u.IsIconic(hwnd) else SW_SHOW)
        u.SetForegroundWindow(hwnd)
        if u.GetForegroundWindow() != hwnd:
            fg = u.GetForegroundWindow()
            fg_tid = u.GetWindowThreadProcessId(fg, None) if fg else 0
            my_tid = ctypes.windll.kernel32.GetCurrentThreadId()
            if fg_tid and fg_tid != my_tid:
                u.AttachThreadInput(my_tid, fg_tid, True)
                try:
                    u.BringWindowToTop(hwnd)
                    u.SetForegroundWindow(hwnd)
                finally:
                    u.AttachThreadInput(my_tid, fg_tid, False)
    except Exception as e:
        print(f"[{now()}] focus existing window failed: {e}", flush=True)


# ---------------------------------------------------------------------------
# Taskbar badge — red circle with the number of tasks due today + overdue,
# drawn onto the taskbar icon (ITaskbarList3::SetOverlayIcon), like Todoist.
# Same rule as the sidebar "Today" count: open, top-level tasks whose local
# due date is today or earlier. 0 → badge removed; 100+ → "99+".
# ---------------------------------------------------------------------------
BADGE_INTERVAL = 5          # seconds between DB checks (one tiny query)
BADGE_COLOR = "#dc4c3e"     # app --accent / --p1 (app.css)
_CLSID_TASKBAR = "{56FDF344-FD6D-11d0-958A-006097C9A090}"
_IID_TASKBAR3 = "{EA1AFB91-9E28-4B86-90E9-9E9F8A5EEFAF}"


class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_uint32), ("Data2", ctypes.c_uint16),
                ("Data3", ctypes.c_uint16), ("Data4", ctypes.c_ubyte * 8)]


def _com_call(obj, index, restype, argtypes, *args):
    """Call vtable slot `index` of COM object pointer `obj`."""
    vtbl = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    proto = ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)
    return proto(vtbl[index])(obj, *args)


def _taskbar_list3():
    """CoCreate ITaskbarList3 on the calling thread (COM initialised here)."""
    ole = ctypes.windll.ole32
    ole.CoInitialize(None)
    clsid, iid = _GUID(), _GUID()
    ole.CLSIDFromString(_CLSID_TASKBAR, ctypes.byref(clsid))
    ole.CLSIDFromString(_IID_TASKBAR3, ctypes.byref(iid))
    obj = ctypes.c_void_p()
    CLSCTX_INPROC_SERVER = 1
    hr = ole.CoCreateInstance(ctypes.byref(clsid), None, CLSCTX_INPROC_SERVER,
                              ctypes.byref(iid), ctypes.byref(obj))
    if hr != 0 or not obj:
        raise OSError(f"CoCreateInstance(TaskbarList) hr=0x{hr & 0xFFFFFFFF:08X}")
    # vtable: IUnknown 0-2 · ITaskbarList 3-7 (HrInit=3) · ITaskbarList2 8 ·
    # ITaskbarList3 9-20 (SetOverlayIcon=18)
    _com_call(obj, 3, ctypes.c_long, ())
    return obj


def _set_overlay(taskbar, hwnd, hicon, text):
    _com_call(taskbar, 18, ctypes.c_long,
              (ctypes.c_void_p, ctypes.c_void_p, ctypes.c_wchar_p),
              hwnd, hicon, text)


def due_badge_count():
    """Open top-level tasks due today or overdue (local date) — mirrors the
    sidebar 'Today' number in js/03-render.js."""
    import datetime
    today = datetime.date.today().isoformat()
    n = 0
    with store_db() as conn:
        rows = conn.execute(
            "SELECT due_date, due_datetime FROM tasks "
            "WHERE is_deleted=0 AND checked=0 AND parent_id IS NULL "
            "AND (due_date IS NOT NULL OR due_datetime IS NOT NULL)"
        ).fetchall()
    for r in rows:
        d, _t = split_due(r["due_date"], r["due_datetime"])
        if d and d <= today:
            n += 1
    return n


def make_badge_icon(text):
    """Render the red circle + white number as an HICON via System.Drawing
    (already loaded by pywebview's WinForms backend). Caller must DestroyIcon."""
    import clr
    clr.AddReference("System.Drawing")
    from System.Drawing import (Bitmap, Graphics, Color, ColorTranslator, SolidBrush,
                                Font, FontStyle, StringFormat, StringAlignment,
                                StringFormatFlags, RectangleF, GraphicsUnit)
    from System.Drawing.Drawing2D import SmoothingMode
    from System.Drawing.Text import TextRenderingHint
    # Overlay is 16x16 at 96 dpi; render at the real DPI so it stays crisp
    try:
        dpi = ctypes.windll.user32.GetDpiForSystem()
    except Exception:
        dpi = 96
    S = max(16, int(round(16 * dpi / 96.0)))
    bmp = Bitmap(S, S)
    g = Graphics.FromImage(bmp)
    try:
        g.Clear(Color.Transparent)
        g.SmoothingMode = SmoothingMode.AntiAlias
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit
        g.FillEllipse(SolidBrush(ColorTranslator.FromHtml(BADGE_COLOR)), 0, 0, S - 1, S - 1)
        scale = {1: 0.72, 2: 0.60}.get(len(text), 0.42)
        font = Font("Segoe UI", S * scale, FontStyle.Bold, GraphicsUnit.Pixel)
        fmt = StringFormat()
        fmt.Alignment = StringAlignment.Center
        fmt.LineAlignment = StringAlignment.Center
        fmt.FormatFlags = StringFormatFlags.NoWrap | StringFormatFlags.NoClip
        # nudge up a hair — Segoe's ascent makes centred digits sit low
        rect = RectangleF(0, -S * 0.04, S, S)
        g.DrawString(text, font, SolidBrush(Color.White), rect, fmt)
    finally:
        g.Dispose()
    hicon = bmp.GetHicon()
    bmp.Dispose()
    return int(hicon.ToInt64())


def taskbar_badge_loop():
    """Background: wait for the native window, then keep the overlay in sync
    with the due count. Re-applies each tick (cheap) so an Explorer restart
    doesn't leave the badge missing."""
    while not is_setup_ready():
        time.sleep(BADGE_INTERVAL)   # onboarding not finished — no DB yet
    u = ctypes.windll.user32
    hwnd = 0
    while not hwnd:
        hwnd = u.FindWindowW(None, WINDOW_TITLE)
        if not hwnd:
            time.sleep(0.5)
    try:
        taskbar = _taskbar_list3()
    except Exception as e:
        print(f"[{now()}] taskbar badge unavailable: {e}", flush=True)
        return
    print(f"[{now()}] taskbar badge started ({BADGE_INTERVAL}s)", flush=True)
    last = None
    while True:
        try:
            n = due_badge_count()
            try:
                refresh_lang()
                tray_update(n, sticky_tasks())
            except Exception as e:
                print(f"[{now()}] tray refresh error: {e}", flush=True)
            if n <= 0:
                if last != 0:
                    _set_overlay(taskbar, hwnd, None, "")
                last = 0
            else:
                text = str(n) if n < 100 else "99+"
                hicon = make_badge_icon(text)
                try:
                    _set_overlay(taskbar, hwnd, hicon, f"{n} due")
                finally:
                    u.DestroyIcon(hicon)   # taskbar keeps its own copy
                if last != n:
                    print(f"[{now()}] taskbar badge -> {text}", flush=True)
                last = n
        except Exception as e:
            print(f"[{now()}] taskbar badge error: {e}", flush=True)
        time.sleep(BADGE_INTERVAL)

# ---------------------------------------------------------------------------
# System tray — NotifyIcon on the WinForms UI thread (pywebview's own thread).
# Closing the window (X) hides it to the tray; the app keeps running (sync,
# badge). Quit only from the tray menu. Tray icon carries the same due-count
# badge; menu = pinned (sticky) tasks · Open · Add task · Today · Inbox ·
# Sync now · Start with Windows · Quit. Labels come from lang/<lang>.json,
# following the language chosen in the app (localStorage "lang").
# ---------------------------------------------------------------------------
# app.css :root — keep in sync by hand (menu is native, not CSS)
UI = {
    "bg": "#252525", "hover": "#363636", "border": "#4d4d4d",
    "text": "#eeeeee", "text2": "#b3b3b3", "text3": "#999999", "accent": "#dc4c3e",
    "p1": "#dc4c3e", "p2": "#eb8909", "p3": "#2a67e2", "p4": "#999999",
    "sticky": "#637760", "sticky_hi": "#7e9a7a", "sticky_text": "#f1f2ee",
}
# tray menu look — chosen with Lasha from rendered variants (see core memory)
STYLE = {
    "font_pt": 9.0,            # ≈15 % smaller than the first 10.5 pt version
    "pad": (5, 3, 8, 3),       # item padding l,t,r,b
    "open_bold": False,
    "pinned": "stripe",        # "fill" | "stripe" | "card"  (Lasha chose B = stripe)
    "pinned_bold": False,
}
_AUTOSTART_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_AUTOSTART_NAME = "Todoister"
_tray = {
    "window": None,      # pywebview Window
    "form": None,        # WinForms Form (window.native)
    "icon": None,        # NotifyIcon
    "menu": None,        # ContextMenuStrip
    "lang": "en",
    "strings": {},       # lang code -> dict
    "count": 0,          # due badge count (shared with the taskbar badge loop)
    "sticky": [],        # [(id, text, priority)]
    "quit": False,       # True once Quit was chosen — lets FormClosing through
    "hidden": False,
    "renderer": None,
}


def tray_str(key, **kw):
    """i18n lookup for tray labels: lang/<lang>.json, fallback en, then key."""
    lang = _tray["lang"]
    for code in (lang, "en"):
        d = _tray["strings"].get(code)
        if d is None:
            try:
                with open(os.path.join(RES_DIR, "lang", f"{code}.json"), encoding="utf-8") as f:
                    d = json.load(f)
            except Exception:
                d = {}
            _tray["strings"][code] = d
        if key in d:
            txt = d[key]
            for k, v in kw.items():
                txt = txt.replace("{" + k + "}", str(v))
            return txt
    return key


def js_async(script):
    """Fire JS in the page from any thread without blocking (evaluate_js waits
    for the result and would deadlock if called on the UI thread)."""
    w = _tray["window"]
    if not w:
        return
    def _run():
        try:
            w.evaluate_js(script)
        except Exception as e:
            print(f"[{now()}] js_async failed: {e}", flush=True)
    threading.Thread(target=_run, daemon=True).start()


STICKY_VISIBLE = 2   # pinned rows shown in the tray menu — mirrors STICKY_VISIBLE in js/03-render.js


def sticky_tasks():
    """ALL pinned (sticky) open tasks in queue order — same rule as stickyOrder()
    in js/03-render.js: soonest due first (no due → last) → higher priority
    (Todoist 4=P1) → text A→Z. The menu shows the first STICKY_VISIBLE + a "+N" row."""
    with store_db() as conn:
        rows = conn.execute(
            "SELECT t.id, t.content, t.priority, t.due_date, t.due_datetime FROM tasks t "
            "JOIN task_local tl ON tl.task_id = t.id "
            "WHERE tl.sticky=1 AND t.checked=0 AND t.is_deleted=0"
        ).fetchall()
    items = []
    for r in rows:
        d, tm = split_due(r["due_date"], r["due_datetime"])
        due_key = (d + "T" + (tm or "99:99")) if d else "9999"
        prio = r["priority"] or 1
        text = r["content"] or ""
        items.append(((due_key, -prio, text.casefold()), (r["id"], text, prio)))
    items.sort(key=lambda x: x[0])
    return [x[1] for x in items]


def refresh_lang():
    """Read the app's chosen language from the page (background thread only)."""
    w = _tray["window"]
    if not w:
        return
    try:
        v = w.evaluate_js("(function(){try{return localStorage.getItem('lang')||'en'}catch(e){return 'en'}})()")
        if isinstance(v, str) and v:
            _tray["lang"] = v
    except Exception:
        pass


def _prio_ring(td_priority):
    """Priority ring for a pinned-task menu row — same look as the app's task
    checkbox (Todoist priority 4=P1 red · 3=P2 orange · 2=P3 blue · 1=P4 grey)."""
    from System.Drawing import Bitmap, Graphics, Pen, ColorTranslator, Color
    from System.Drawing.Drawing2D import SmoothingMode
    color = {4: UI["p1"], 3: UI["p2"], 2: UI["p3"]}.get(td_priority, UI["p4"])
    bmp = Bitmap(16, 16)
    g = Graphics.FromImage(bmp)
    g.Clear(Color.Transparent)
    g.SmoothingMode = SmoothingMode.AntiAlias
    g.DrawEllipse(Pen(ColorTranslator.FromHtml(color), 2.0), 2, 2, 12, 12)
    g.Dispose()
    return bmp


def _dark_renderer():
    """ToolStrip renderer that paints the tray menu in the app's dark theme.
    Note: pythonnet 3.1 on Python 3.14 crashes when instantiating a Python
    subclass of a .NET class, so instead of overriding OnRender* we subscribe
    to the renderer's public Render* events (raised right after the default
    drawing) and paint over it. Text uses each item's ForeColor/Font, which the
    default renderer already honours."""
    import clr
    clr.AddReference("System.Windows.Forms")
    clr.AddReference("System.Drawing")
    import System.Windows.Forms as WinForms
    from System.Drawing import SolidBrush, Pen, ColorTranslator, Rectangle, Point, Color
    from System.Drawing.Drawing2D import SmoothingMode, LineCap, LineJoin
    from System.Windows.Forms import (ToolStripRenderEventHandler, ToolStripItemRenderEventHandler,
                                      ToolStripSeparatorRenderEventHandler,
                                      ToolStripItemImageRenderEventHandler,
                                      ToolStripArrowRenderEventHandler)

    C = {k: ColorTranslator.FromHtml(v) for k, v in UI.items()}
    r = WinForms.ToolStripProfessionalRenderer()
    r.RoundedEdges = False

    def bg(sender, e):
        e.Graphics.FillRectangle(SolidBrush(C["bg"]), e.AffectedBounds)

    def border(sender, e):
        b = e.AffectedBounds
        e.Graphics.FillRectangle(SolidBrush(C["bg"]), b.X, b.Bottom - 2, b.Width, 2)  # kill default shadow line
        e.Graphics.DrawRectangle(Pen(C["border"]), b.X, b.Y, b.Width - 1, b.Height - 1)

    def _round_rect(x, y, w, h, rad):
        from System.Drawing.Drawing2D import GraphicsPath
        p = GraphicsPath()
        d = rad * 2
        p.AddArc(x, y, d, d, 180, 90)
        p.AddArc(x + w - d, y, d, d, 270, 90)
        p.AddArc(x + w - d, y + h - d, d, d, 0, 90)
        p.AddArc(x, y + h - d, d, d, 90, 90)
        p.CloseFigure()
        return p

    def item_bg(sender, e):
        item = e.Item
        g = e.Graphics
        sticky = str(item.Tag).startswith("sticky")
        mode = STYLE["pinned"]
        row = Rectangle(1, 0, item.Width - 2, item.Height)
        if not sticky:
            g.FillRectangle(SolidBrush(C["hover"] if (item.Selected and item.Enabled) else C["bg"]), row)
            return
        green = C["sticky_hi"] if item.Selected else C["sticky"]
        if mode == "fill":
            g.FillRectangle(SolidBrush(green), row)
        elif mode == "stripe":
            g.FillRectangle(SolidBrush(C["hover"] if item.Selected else C["bg"]), row)
            g.FillRectangle(SolidBrush(Color.FromArgb(40, C["sticky_hi"])), row)   # faint green tint
            g.FillRectangle(SolidBrush(C["sticky_hi"]), 1, 0, 4, item.Height)      # left bar
        else:  # card — each pinned task = small rounded green card, like the in-app sticky note
            g.FillRectangle(SolidBrush(C["bg"]), row)
            g.SmoothingMode = SmoothingMode.AntiAlias
            g.FillPath(SolidBrush(green), _round_rect(5, 1, item.Width - 10, item.Height - 2, 6))

    def separator(sender, e):
        w, h = e.Item.Width, e.Item.Height
        e.Graphics.FillRectangle(SolidBrush(C["bg"]), 0, 0, w, h)
        e.Graphics.DrawLine(Pen(C["border"]), 8, h // 2, w - 8, h // 2)

    def check(sender, e):
        g = e.Graphics
        rc = e.ImageRectangle
        item = e.Item
        fill = C["hover"] if (item.Selected and item.Enabled) else C["bg"]
        # default renderer paints a light highlight box behind the check — cover the whole cell
        g.FillRectangle(SolidBrush(fill), 1, 0, rc.Right + 4, item.Height)
        g.SmoothingMode = SmoothingMode.AntiAlias
        cx, cy = rc.X + rc.Width // 2, rc.Y + rc.Height // 2
        g.DrawLines(Pen(C["accent"], 2.0), [Point(cx - 5, cy), Point(cx - 1, cy + 4), Point(cx + 6, cy - 4)])

    PRIO = {4: "p1", 3: "p2", 2: "p3", 1: "p4"}

    def arrow(sender, e):
        """Cover the default arrow with the row's own background (same layers as
        item_bg, so no visible box), then draw our chevron — priority colour on
        pinned rows, muted text colour elsewhere."""
        g = e.Graphics
        rc = e.ArrowRectangle
        item = e.Item
        tag = str(item.Tag)
        sticky = tag.startswith("sticky")
        base = C["hover"] if (item.Selected and item.Enabled) else C["bg"]
        if sticky and STYLE["pinned"] == "stripe":
            g.FillRectangle(SolidBrush(base), rc)
            g.FillRectangle(SolidBrush(Color.FromArgb(40, C["sticky_hi"])), rc)
        elif sticky:
            g.FillRectangle(SolidBrush(_sticky_fill(item)), rc)
        else:
            g.FillRectangle(SolidBrush(base), rc)
        g.SmoothingMode = SmoothingMode.AntiAlias
        cx, cy = rc.X + rc.Width // 2, rc.Y + rc.Height // 2
        if sticky:
            prio = int(tag.split(":")[1]) if ":" in tag else 1
            color, width, a = C[PRIO.get(prio, "p4")], 2.6, 7     # bigger, priority-coloured
        else:
            color, width, a = C["text2"], 1.6, 4
        pen = Pen(color, width)
        pen.StartCap = pen.EndCap = LineCap.Round
        pen.LineJoin = LineJoin.Round
        g.DrawLines(pen, [Point(cx - a // 2, cy - a), Point(cx + a // 2, cy), Point(cx - a // 2, cy + a)])

    def _sticky_fill(item):
        mode = STYLE["pinned"]
        if mode == "stripe":
            return C["hover"] if item.Selected else C["bg"]
        if mode == "card":
            return C["sticky_hi"] if item.Selected else C["sticky"]
        return C["sticky_hi"] if item.Selected else C["sticky"]

    r.RenderToolStripBackground += ToolStripRenderEventHandler(bg)
    r.RenderImageMargin += ToolStripRenderEventHandler(bg)
    r.RenderToolStripBorder += ToolStripRenderEventHandler(border)
    r.RenderMenuItemBackground += ToolStripItemRenderEventHandler(item_bg)
    r.RenderSeparator += ToolStripSeparatorRenderEventHandler(separator)
    r.RenderItemCheck += ToolStripItemImageRenderEventHandler(check)
    r.RenderArrow += ToolStripArrowRenderEventHandler(arrow)
    # keep the python closures alive as long as the renderer
    r_keep = (bg, border, item_bg, separator, check, arrow)
    _tray["renderer_handlers"] = r_keep
    return r


def _round_corners(handle):
    """Win11 rounded corners for the popup (DWMWA_WINDOW_CORNER_PREFERENCE)."""
    try:
        pref = ctypes.c_int(2)  # DWMWCP_ROUND
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            ctypes.c_void_p(int(handle.ToInt64())), 33, ctypes.byref(pref), ctypes.sizeof(pref))
    except Exception:
        pass


def make_tray_icon(count):
    """App icon with a red dot in the top-right corner when count > 0 (0 → plain).
    Returns a System.Drawing.Icon."""
    from System.Drawing import (Bitmap, Graphics, Color, ColorTranslator, SolidBrush, Icon,
                                Font, FontStyle, StringFormat, StringAlignment,
                                StringFormatFlags, RectangleF, GraphicsUnit, Rectangle)
    from System.Drawing.Drawing2D import SmoothingMode
    from System.Drawing.Text import TextRenderingHint
    try:
        dpi = ctypes.windll.user32.GetDpiForSystem()
    except Exception:
        dpi = 96
    S = max(16, int(round(16 * dpi / 96.0)))
    bmp = Bitmap(S, S)
    g = Graphics.FromImage(bmp)
    try:
        g.Clear(Color.Transparent)
        g.SmoothingMode = SmoothingMode.AntiAlias
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit
        if os.path.exists(ICON_PATH):
            # System.Drawing.Icon mis-decodes this .ico (garbage pixels) — let
            # Windows pick the right size via LoadImage and draw that handle
            from System import IntPtr
            u = ctypes.windll.user32
            u.LoadImageW.restype = ctypes.c_void_p
            h = u.LoadImageW(None, ICON_PATH, 1, S, S, 0x10)   # IMAGE_ICON, LR_LOADFROMFILE
            if h:
                base = Icon.FromHandle(IntPtr(h))
                g.DrawIcon(base, Rectangle(0, 0, S, S))
                u.DestroyIcon(ctypes.c_void_p(h))
        if count > 0:
            # Tray icons are tiny (16 px @96 dpi) — digits are unreadable there
            # (Lasha, 2026-08-16), so the tray only shows a red dot = "something
            # to do"; the exact number stays on the taskbar overlay + tooltip.
            d = max(6, int(round(S * 0.42)))            # dot diameter
            x, y = S - d - 1, S - d - 1                  # bottom-right, 1 px inset
            g.FillEllipse(SolidBrush(Color.FromArgb(0x1e, 0x1e, 0x1e)), x - 1, y - 1, d + 2, d + 2)  # dark rim = contrast
            g.FillEllipse(SolidBrush(ColorTranslator.FromHtml(BADGE_COLOR)), x, y, d, d)
    finally:
        g.Dispose()
    hicon = bmp.GetHicon()
    bmp.Dispose()
    ico = Icon.FromHandle(hicon).Clone()   # own copy → we can free the handle
    ctypes.windll.user32.DestroyIcon(ctypes.c_void_p(int(hicon.ToInt64())))
    return ico


def autostart_enabled():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _AUTOSTART_KEY) as k:
            winreg.QueryValueEx(k, _AUTOSTART_NAME)
            return True
    except OSError:
        return False


def autostart_command():
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    vbs = os.path.join(RES_DIR, "start.vbs")
    return f'wscript.exe "{vbs}"'


def set_autostart(enabled):
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _AUTOSTART_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if enabled:
                winreg.SetValueEx(k, _AUTOSTART_NAME, 0, winreg.REG_SZ, autostart_command())
            else:
                try:
                    winreg.DeleteValue(k, _AUTOSTART_NAME)
                except FileNotFoundError:
                    pass
        print(f"[{now()}] autostart {'on' if enabled else 'off'}", flush=True)
    except Exception as e:
        print(f"[{now()}] autostart change failed: {e}", flush=True)


# --- UI-thread actions (called from menu handlers / FormClosing) -------------
def tray_show_window():
    form = _tray["form"]
    if not form:
        return
    import System.Windows.Forms as WinForms
    if not form.Visible:
        form.Show()
    if form.WindowState == WinForms.FormWindowState.Minimized:
        form.WindowState = WinForms.FormWindowState.Normal
    form.Activate()
    _mark_shown()


def _mark_shown():
    """Window became visible (tray action, or a 2nd launch un-hid it from
    outside) — resume page polling + refresh right away."""
    if _tray["hidden"]:
        _tray["hidden"] = False
        js_async("window.__trayHidden=false; if(typeof fetchState==='function') fetchState();")
        print(f"[{now()}] window shown", flush=True)


def _on_visible_changed(sender, e):
    try:
        form = _tray["form"]
        if form and form.Visible:
            _mark_shown()
    except Exception as ex:
        print(f"[{now()}] visible-changed hook failed: {ex}", flush=True)


def tray_hide_window():
    form = _tray["form"]
    if not form:
        return
    _tray["hidden"] = True
    form.Hide()
    js_async("window.__trayHidden=true;")
    print(f"[{now()}] window hidden to tray", flush=True)


def tray_quit():
    _tray["quit"] = True
    ni = _tray["icon"]
    if ni:
        try:
            ni.Visible = False
            ni.Dispose()
        except Exception:
            pass
    form = _tray["form"]
    if form:
        form.Close()     # pywebview's FormClosed → Application.Exit → main() returns


def _on_form_closing(sender, e):
    """X / Alt+F4 → hide to tray. Quit from tray, Windows shutdown, Task
    Manager etc. close for real."""
    try:
        import System.Windows.Forms as WinForms
        if _tray["quit"]:
            return
        if e.CloseReason == WinForms.CloseReason.UserClosing:
            e.Cancel = True
            tray_hide_window()
    except Exception as ex:
        print(f"[{now()}] form closing hook failed: {ex}", flush=True)


def _build_menu(sender, e):
    """ContextMenuStrip.Opening — rebuild items with the current language,
    pinned tasks and autostart state."""
    import System.Windows.Forms as WinForms
    from System import EventHandler
    from System.ComponentModel import CancelEventHandler
    from System.Drawing import Font, FontStyle, ColorTranslator
    menu = _tray["menu"]
    menu.Items.Clear()
    pad = WinForms.Padding(*STYLE["pad"])

    C = {k: ColorTranslator.FromHtml(v) for k, v in UI.items()}

    def add(parent, text, handler=None, image=None, tag=None):
        item = WinForms.ToolStripMenuItem(text)
        item.Padding = pad
        item.ForeColor = C["text"]
        if image is not None:
            item.Image = image
        if tag is not None:
            item.Tag = tag
        if tag and str(tag).startswith("sticky"):
            item.ForeColor = C["text"] if STYLE["pinned"] == "stripe" else C["sticky_text"]
            if STYLE["pinned_bold"]:
                item.Font = Font(menu.Font, FontStyle.Bold)
            if STYLE["pinned"] == "card":
                item.Margin = WinForms.Padding(0, 1, 0, 1)
        if handler:
            item.Click += EventHandler(lambda s, a, h=handler: h())
        parent.Items.Add(item) if hasattr(parent, "Items") else parent.DropDownItems.Add(item)
        return item

    def sep(parent):
        (parent.Items if hasattr(parent, "Items") else parent.DropDownItems).Add(WinForms.ToolStripSeparator())

    n = _tray["count"]
    open_item = add(menu, tray_str("tray.open") + (f"  ({n})" if n else ""), tray_show_window)
    if STYLE["open_bold"]:
        open_item.Font = Font(menu.Font, FontStyle.Bold)

    # pinned (sticky) tasks — own block, sticky-note colours, no header
    if _tray["sticky"]:
        sep(menu)
        for tid, text, prio in _tray["sticky"][:STICKY_VISIBLE]:
            label = text if len(text) <= 40 else text[:39] + "…"
            item = add(menu, label, tag=f"sticky:{prio}")   # priority → arrow colour
            item.DropDown.Renderer = _tray["renderer"]
            item.DropDown.Opening += CancelEventHandler(lambda s, a: _round_corners(s.Handle))
            add(item, tray_str("tray.open_task"),
                lambda t=tid: (tray_show_window(), js_async(f"openModal({json.dumps(t)})")))
            add(item, tray_str("sticky.complete"),
                lambda t=tid: js_async(f"completeTask({json.dumps(t)})"))
        more = len(_tray["sticky"]) - STICKY_VISIBLE
        if more > 0:   # "+N" row, same size/style as a pinned row → opens the app on the queue popover
            add(menu, tray_str("sticky.more", n=more),
                lambda: (tray_show_window(), js_async("openStickyPopover()")),
                tag="stickymore")
    sep(menu)

    add(menu, tray_str("nav.add_task"),
        lambda: (tray_show_window(), js_async("openQuickAdd()")))
    add(menu, tray_str("nav.today"),
        lambda: (tray_show_window(), js_async("setView('today')")))
    add(menu, tray_str("nav.inbox"),
        lambda: (tray_show_window(), js_async("setView('inbox')")))
    add(menu, tray_str("sync.now"), lambda: js_async("manualSync()"))
    sep(menu)
    auto = add(menu, tray_str("tray.autostart"))
    auto.Padding = pad
    auto.CheckOnClick = True
    auto.Checked = autostart_enabled()
    auto.CheckedChanged += EventHandler(lambda s, a: set_autostart(s.Checked))
    sep(menu)
    add(menu, tray_str("tray.quit"), tray_quit)


def _create_tray():
    """Runs on the WinForms UI thread once the window exists."""
    import System.Windows.Forms as WinForms
    from System import EventHandler
    from System.Windows.Forms import FormClosingEventHandler
    from System.ComponentModel import CancelEventHandler
    form = _tray["form"]
    ni = WinForms.NotifyIcon()
    ni.Icon = make_tray_icon(0)
    ni.Text = WINDOW_TITLE
    menu = WinForms.ContextMenuStrip()
    from System.Drawing import Font
    menu.Font = Font("Segoe UI", STYLE["font_pt"])
    _tray["renderer"] = _dark_renderer()
    menu.Renderer = _tray["renderer"]
    menu.ShowImageMargin = True
    menu.Opening += CancelEventHandler(_build_menu)
    menu.Opening += CancelEventHandler(lambda s, a: _round_corners(s.Handle))
    ni.ContextMenuStrip = menu
    ni.DoubleClick += EventHandler(lambda s, a: tray_show_window())
    ni.Visible = True
    _tray["icon"] = ni
    _tray["menu"] = menu
    form.FormClosing += FormClosingEventHandler(_on_form_closing)
    form.VisibleChanged += EventHandler(_on_visible_changed)
    print(f"[{now()}] tray icon ready", flush=True)


def setup_tray(window):
    """window.events.shown handler — hop onto the UI thread and build the tray."""
    try:
        from System import Action
        form = window.native
        _tray["window"] = window
        _tray["form"] = form
        form.Invoke(Action(_create_tray))
    except Exception as e:
        print(f"[{now()}] tray setup failed: {e}", flush=True)


def tray_update(count, sticky):
    """Called from the badge loop (background thread): push count/sticky into
    the tray icon + tooltip on the UI thread. Icon only redrawn on change."""
    _tray["sticky"] = sticky
    prev = _tray["count"]
    _tray["count"] = count
    ni, form = _tray["icon"], _tray["form"]
    if not ni or not form or _tray["quit"]:
        return
    if prev == count and ni.Text != WINDOW_TITLE:
        return
    def _apply():
        try:
            if _tray["quit"]:
                return
            old = ni.Icon
            ni.Icon = make_tray_icon(count)
            if old:
                old.Dispose()
            tip = WINDOW_TITLE
            if count:
                tip += " — " + tray_str("tray.due_tip", n=count)
            ni.Text = tip[:63]   # NotifyIcon limit
        except Exception as e:
            print(f"[{now()}] tray update failed: {e}", flush=True)
    try:
        from System import Action
        form.BeginInvoke(Action(_apply))
    except Exception as e:
        print(f"[{now()}] tray invoke failed: {e}", flush=True)


def is_setup_ready():
    return os.path.exists(DB_PATH) and bool(sync_mod.TOKEN)


def start_server():
    if os.path.exists(DB_PATH):
        ensure_schema()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[{now()}] server started → {URL}", flush=True)
    srv.serve_forever()


def background_sync_loop():
    """Periodic auto-sync: push pending changes + pull deltas. Silent unless changes.
    Waits until setup (DB + token) is ready before doing any work."""
    print(f"[{now()}] bg-sync started ({SYNC_INTERVAL}s interval)", flush=True)
    # One-time: cache the account user (name/email/avatar) if we don't have it yet.
    # The `user` resource only arrives on a full sync, so fetch it once on startup.
    try:
        if is_setup_ready():
            with sync_mod.db() as conn:
                if not sync_mod.get_state(conn, "user_json"):
                    u = sync_mod.fetch_user()
                    if u:
                        sync_mod.store_user(conn, u)
                        conn.commit()
                        print(f"[{now()}] account user cached", flush=True)
                # One-time backfill of pre-existing Todoist filters (incremental
                # sync only returns filters that change after this point).
                if not sync_mod.get_state(conn, "filters_pulled"):
                    fs = sync_mod.fetch_filters()
                    for f in fs:
                        sync_mod.upsert_filter(conn, f)
                    sync_mod.set_state(conn, "filters_pulled", "1")
                    conn.commit()
                    print(f"[{now()}] filters backfilled ({len(fs)})", flush=True)
    except Exception as e:
        print(f"[{now()}] user/filter fetch error: {e}", flush=True)
    while True:
        try:
            time.sleep(SYNC_INTERVAL)
            if not is_setup_ready():
                continue  # onboarding not done yet
            # Push pending queue if non-empty
            try:
                with sync_mod.db() as conn:
                    pending = conn.execute(
                        "SELECT COUNT(*) c FROM pending_ops"
                    ).fetchone()["c"]
                if pending > 0:
                    sync_mod.push_queue(verbose=False, quiet=True)
            except Exception as e:
                print(f"[{now()}] bg-sync push error: {e}", flush=True)
            # Pull deltas
            try:
                sync_mod.incremental_sync(quiet=True)
            except Exception as e:
                print(f"[{now()}] bg-sync pull error: {e}", flush=True)
            # Google Calendar full sync: diff pass (no-op when off / unchanged);
            # catches due changes that arrived from Todoist, not just local edits
            try:
                gcal_reconcile()
            except Exception as e:
                print(f"[{now()}] bg-sync gcal error: {e}", flush=True)
        except Exception as e:
            print(f"[{now()}] bg-sync loop error: {e}", flush=True)


def wait_ready(timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(URL, timeout=0.3)
            return True
        except Exception:
            time.sleep(0.1)
    return False


def main():
    if another_instance_running():
        print(f"[{now()}] already running -> focusing existing window", flush=True)
        focus_existing_window()
        # hard exit: with the CLR already loaded (import webview) a normal
        # interpreter shutdown can hang under pythonw, leaving a ghost process
        os._exit(0)
    set_app_id()  # distinct taskbar identity — must precede window creation
    threading.Thread(target=start_server, daemon=True).start()
    if not wait_ready():
        print("Server failed to start.", file=sys.stderr)
        sys.exit(1)
    threading.Thread(target=background_sync_loop, daemon=True).start()

    W, H = 1280, 860
    try:
        u = ctypes.windll.user32
        sw, sh = u.GetSystemMetrics(0), u.GetSystemMetrics(1)
    except Exception:
        sw, sh = 1920, 1080
    x = max(0, (sw - W) // 2)
    y = max(0, (sh - H) // 2)

    window = webview.create_window(
        WINDOW_TITLE,
        URL,
        width=W,
        height=H,
        min_size=(900, 600),
        resizable=True,
        background_color="#1e1e1e",
        x=x,
        y=y,
    )
    # Dark title bar + icon once the native window exists
    window.events.shown += style_window
    window.events.shown += lambda *a: setup_tray(window)
    threading.Thread(target=taskbar_badge_loop, daemon=True).start()
    icon = ICON_PATH if os.path.exists(ICON_PATH) else None
    # debug=True enables WebView2's native right-click menu (Cut/Copy/Paste/Select all);
    # on Windows pywebview ties AreDefaultContextMenusEnabled to debug (edgechromium.py).
    # But debug also auto-opens DevTools — turn that off so only the context menu stays
    # (DevTools is still reachable via F12 / right-click → Inspect if ever needed).
    webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False
    webview.start(icon=icon, debug=True)
    # Quit chosen from the tray (or a real close): daemon threads + CLR loaded —
    # a hard exit avoids a lingering pythonw process on interpreter shutdown.
    print(f"[{now()}] exiting", flush=True)
    os._exit(0)


if __name__ == "__main__":
    main()
