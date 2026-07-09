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
    icon = ICON_PATH if os.path.exists(ICON_PATH) else None
    # debug=True enables WebView2's native right-click menu (Cut/Copy/Paste/Select all);
    # on Windows pywebview ties AreDefaultContextMenusEnabled to debug (edgechromium.py).
    # But debug also auto-opens DevTools — turn that off so only the context menu stays
    # (DevTools is still reachable via F12 / right-click → Inspect if ever needed).
    webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False
    webview.start(icon=icon, debug=True)


if __name__ == "__main__":
    main()
