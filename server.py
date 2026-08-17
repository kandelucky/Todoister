# -*- coding: utf-8 -*-
"""
Todoister — HTTP server backed by SQLite (triage.db).

Source: triage.db (Todoist data downloaded via the Sync API).
Writes: directly to SQLite (Phase 2). pending queue + Todoist push — Phase 3-4.
"""
import hashlib
import json
import os
import re
import sys
import sqlite3
import datetime
import threading
import webbrowser
import subprocess
import uuid
import base64
import urllib.error
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import sync as sync_mod
import nb_files
import agent_panel
# Access via sync_mod.TOKEN so reload_token() takes effect at runtime
import gcal
import gcal_api
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Shared helpers split into modules 2026-07-08 (mechanical move). Import them
# back into this namespace so Handler code and app.py stay unchanged.
from store import (
    BASE, DB_PATH, ONBOARDING_HTML, LOG, HTML, PORT, SYNC_INTERVAL,
    FILTER_SYNC_LIMIT, _lock, AVATAR_CDN, TODOIST_DEV_URL, FILTERS_HELP_URL,
    TZ_HELP_URL, PRIO_TD_TO_UI, PRIO_UI_TO_TD, now, build_account, db,
    ensure_schema, get_setting, set_setting, log_action, split_due,
    load_state_dict, build_completed, lookup_project_id, lookup_section_id,
    short_title, now_iso, recurrence_end_date,
    task_due_obj, queue_cmd, cancel_pending_for, has_pending_add,
    build_item_add_args, has_pending_reminder_add, cancel_pending_reminder_for,
)
from pages import build_guide_page, GUIDE_TOPICS
from gcal_sync import gcal_access_token, gcal_reconcile, gcal_schedule_reconcile


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/favicon.ico":
            # Browsers auto-request this; serve the app icon (or 204) to keep the console clean.
            ico = os.path.join(BASE, "assets", "icon.ico")
            if os.path.exists(ico):
                with open(ico, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/x-icon")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "max-age=86400")
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(204)
                self.end_headers()
            return
        if path == "/onboarding":
            with open(ONBOARDING_HTML, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/setup-status":
            self._json(200, {
                "has_db": os.path.exists(DB_PATH),
                "has_token": bool(sync_mod.TOKEN),
                "ready": os.path.exists(DB_PATH) and bool(sync_mod.TOKEN),
            })
        elif path == "/open-todoist-dev":
            # Open Todoist's developer settings in the system browser (not the
            # in-app WebView), so the user can copy their API token.
            try:
                webbrowser.open(TODOIST_DEV_URL)
            except Exception as e:
                log_action(f"[{now()}] open-todoist-dev failed: {e}")
            self.send_response(204)
            self.end_headers()
        elif path == "/open-filters-help":
            try:
                webbrowser.open(FILTERS_HELP_URL)
            except Exception as e:
                log_action(f"[{now()}] open-filters-help failed: {e}")
            self.send_response(204)
            self.end_headers()
        elif path == "/open-tz-help":
            try:
                webbrowser.open(TZ_HELP_URL)
            except Exception as e:
                log_action(f"[{now()}] open-tz-help failed: {e}")
            self.send_response(204)
            self.end_headers()
        elif path in ("/", "/index.html"):
            # First run (no local DB yet) → onboarding. If the DB exists but the
            # token was removed (disconnected), still serve the app: local tasks
            # stay visible and the avatar offers "Connect" to reconnect.
            if not os.path.exists(DB_PATH):
                self.send_response(302)
                self.send_header("Location", "/onboarding")
                self.end_headers()
                return
            with open(HTML, "rb") as f:
                body = f.read()
            # Cache-bust the editor bundle by its file mtime. The embedded WebView2
            # caches assets aggressively and ignores Ctrl+Shift+R, so a rebuilt
            # bundle would otherwise keep loading the stale copy. The ?v= query
            # changes whenever the file changes; the server strips it (line 744).
            try:
                ver = str(int(os.path.getmtime(os.path.join(BASE, "notebook-assets", "bundle.js")))).encode()
                body = body.replace(b"notebook-assets/bundle.js", b"notebook-assets/bundle.js?v=" + ver)
                body = body.replace(b"notebook-assets/bundle.css", b"notebook-assets/bundle.css?v=" + ver)
            except OSError:
                pass
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/state":
            with _lock:
                self._json(200, load_state_dict())
        elif path == "/api/agent_queue":
            # AI agent panel: the agent's poll (also its heartbeat) — agent_panel.py
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            with _lock:
                with db() as conn:
                    resp = agent_panel.get_queue(conn, {k: v[0] for k, v in qs.items()})
                    conn.commit()
            self._json(200, resp)
        elif path == "/oauth/callback":
            # Google OAuth loopback redirect (full-sync authorization).
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code = qs.get("code", [""])[0]
            state = qs.get("state", [""])[0]
            with _lock:
                with db() as conn:
                    expect = get_setting(conn, "gcal_oauth_state", "")
                    cid = get_setting(conn, "gcal_client_id", "")
                    cs = get_setting(conn, "gcal_client_secret", "")
            err = qs.get("error", [""])[0]
            if not code or not state or state != expect or not (cid and cs):
                err = err or "bad request"
            if not err:
                try:
                    # token exchange = network, so outside the lock
                    d = gcal_api.exchange_code(cid, cs, code, f"http://127.0.0.1:{PORT}/oauth/callback")
                    rt = d.get("refresh_token", "")
                    if not rt:
                        raise ValueError("no refresh token in the response")
                    with _lock:
                        with db() as conn:
                            set_setting(conn, "gcal_refresh_token", rt)
                            set_setting(conn, "gcal_access_token", d.get("access_token", ""))
                            set_setting(conn, "gcal_access_expiry", str(time.time() + int(d.get("expires_in", 3600))))
                            set_setting(conn, "gcal_oauth_state", "")
                            conn.commit()
                    log_action(f"[{now()}] gcal full sync authorized")
                    # initial backfill: push existing timed tasks as events
                    gcal_schedule_reconcile(1.0)
                except Exception as e:
                    err = str(e)
                    log_action(f"[{now()}] gcal oauth exchange failed: {e}")
            ok_ka = "ავტორიზაცია წარმატებულია — შეგიძლია დახურო ეს ფანჯარა და ტოდოისტერს დაუბრუნდე."
            fail_ka = "ავტორიზაცია ვერ შედგა"
            body = ("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Todoister</title>"
                    "<style>body{background:#1e1e1e;color:#eee;font-family:'Segoe UI','Noto Sans Georgian',sans-serif;"
                    "display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}"
                    ".c{max-width:420px;text-align:center;line-height:1.6;}</style></head><body><div class=\"c\">"
                    + ("<h2>Todoister</h2><p>%s</p>" % ok_ka if not err
                       else "<h2>Todoister</h2><p>%s: %s</p>" % (fail_ka, err))
                    + "</div></body></html>").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/gcal_events":
            # Google events for the calendar view (read-only, secret iCal URL).
            # The ICS itself is cached in gcal.py; only the setting read is locked.
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            start = qs.get("start", [""])[0]
            try:
                days = int(qs.get("days", ["7"])[0])
            except ValueError:
                days = 7
            with _lock:
                with db() as conn:
                    url = get_setting(conn, "gcal_ics_url", "")
                    # events we created via full sync — the task block already
                    # shows them, so hide the iCal copy (UID = "<eventId>@google.com")
                    try:
                        own = {r["gcal_event_id"] for r in conn.execute(
                            "SELECT gcal_event_id FROM task_local "
                            "WHERE gcal_event_id IS NOT NULL AND gcal_event_id != ''"
                        ).fetchall()}
                    except sqlite3.OperationalError:
                        own = set()
            if not url or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start or ""):
                return self._json(200, {"events": []})
            try:
                evs = gcal.get_events(url, start, days)
                if own:
                    evs = [e for e in evs
                           if (e.get("uid") or "").split("@", 1)[0] not in own]
                self._json(200, {"events": evs})
            except Exception as e:
                log_action(f"[{now()}] gcal fetch failed: {e}")
                self._json(200, {"events": [], "error": str(e)})
        elif path == "/api/completed":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            cursor = qs.get("cursor", [None])[0]
            try:
                with _lock:
                    self._json(200, build_completed(cursor))
            except Exception as e:
                log_action(f"[{now()}] /api/completed failed: {e}")
                self._json(200, {"items": [], "next_cursor": None, "error": str(e)})
        elif path.startswith("/assets/"):
            name = path.split("/")[-1]
            fp = os.path.join(BASE, "assets", name)
            if "/" in name or "\\" in name or ".." in name or not os.path.isfile(fp):
                return self._json(404, {"error": "not found"})
            ctype = ("image/png" if name.endswith(".png")
                     else "image/svg+xml" if name.endswith(".svg")
                     else "application/octet-stream")
            with open(fp, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "max-age=86400")
            self.end_headers()
            self.wfile.write(body)
        elif path.startswith("/notebook-assets/"):
            name = path.split("/")[-1]
            fp = os.path.join(BASE, "notebook-assets", name)
            if "/" in name or "\\" in name or ".." in name or not os.path.isfile(fp):
                return self._json(404, {"error": "not found"})
            ctype = ("application/javascript" if name.endswith(".js")
                     else "text/css" if name.endswith(".css")
                     else "application/octet-stream")
            with open(fp, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/app.css":
            fp = os.path.join(BASE, "app.css")
            if not os.path.isfile(fp):
                return self._json(404, {"error": "not found"})
            with open(fp, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/css; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path.startswith("/js/") and path.endswith(".js"):
            name = path.split("/")[-1]
            fp = os.path.join(BASE, "js", name)
            if "/" in name or "\\" in name or ".." in name or not os.path.isfile(fp):
                return self._json(404, {"error": "not found"})
            with open(fp, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/i18n.js":
            fp = os.path.join(BASE, "i18n.js")
            if not os.path.isfile(fp):
                return self._json(404, {"error": "not found"})
            with open(fp, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path.startswith("/lang/") and path.endswith(".json"):
            name = path.split("/")[-1]
            fp = os.path.join(BASE, "lang", name)
            if "/" in name or "\\" in name or ".." in name or not os.path.isfile(fp):
                return self._json(404, {"error": "not found"})
            with open(fp, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/guide":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            topic = qs.get("topic", ["program"])[0]
            lang = qs.get("lang", ["en"])[0]
            try:
                body = build_guide_page(topic, lang).encode("utf-8")
            except Exception as e:
                return self._json(500, {"error": str(e)})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/attachment":
            self._proxy_attachment()
        else:
            self._json(404, {"error": "not found"})

    ALLOWED_HOSTS = {"files.todoist.com", "image-resize.todoist.com"}

    def _handle_upload(self):
        """Receive a file (base64 in JSON) and upload to Todoist's /uploads endpoint.
        Returns the file_attachment metadata that can be attached to a comment."""
        length = int(self.headers.get("Content-Length", 0))
        if length > 50 * 1024 * 1024:  # 50MB safety cap
            return self._json(413, {"error": "file too large"})
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "bad json"})
        try:
            file_data = base64.b64decode(body["data"])
        except Exception as e:
            return self._json(400, {"error": f"bad base64: {e}"})
        filename = body.get("filename", "upload.bin")
        ctype = body.get("type", "application/octet-stream")

        try:
            metadata = self._todoist_upload(file_data, filename, ctype)
        except RuntimeError as e:
            code, msg = e.args if len(e.args) == 2 else (502, str(e))
            return self._json(code, {"error": msg})
        self._json(200, metadata)

    def _todoist_upload(self, file_data, filename, ctype):
        """Upload bytes to Todoist's /uploads endpoint → file_attachment metadata.
        Raises RuntimeError(code, msg) on failure. Lives in nb_files.todoist_upload."""
        return nb_files.todoist_upload(file_data, filename, ctype)

    def _handle_upload_url(self):
        """Fetch a remote image by URL server-side and upload it to Todoist, so a web image
        pasted into a note (which the browser puts on the clipboard as a link, not bytes)
        becomes a real attachment like any other file. Returns the file_attachment metadata."""
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "bad json"})
        url = (body.get("url") or "").strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            return self._json(400, {"error": "bad url"})
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                ctype = r.headers.get("Content-Type", "application/octet-stream").split(";")[0].strip().lower()
                data = r.read(6 * 1024 * 1024 + 1)   # read a little over 5 MB so oversize is detectable
        except Exception as e:
            log_action(f"[{now()}] upload_url fetch ERROR: {e}")
            return self._json(502, {"error": f"fetch failed: {e}"})
        if not ctype.startswith("image/"):
            return self._json(400, {"error": "not an image"})
        if len(data) > 5 * 1024 * 1024:
            return self._json(400, {"error": "Todoist Free Tier: max 5 MB per file"})
        name = (url.split("?")[0].split("/")[-1] or "image").strip()
        ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
               "image/webp": ".webp", "image/bmp": ".bmp", "image/svg+xml": ".svg"}.get(ctype, "")
        if ext and not name.lower().endswith(ext):
            name = (name or "image") + ext
        try:
            metadata = self._todoist_upload(data, name, ctype)
        except RuntimeError as e:
            code, msg = e.args if len(e.args) == 2 else (502, str(e))
            return self._json(code, {"error": msg})
        self._json(200, metadata)

    def _handle_export(self):
        """Write an exported note to disk and open it. HTML opens in the default browser
        (proper printing / Save as PDF); other files reveal the exports folder.
        Body: {filename, data (base64), open: 'browser'|'folder'}. Download from the
        native WebView is blocked, so the server writes the file instead."""
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "bad json"})
        fn = body.get("filename") or "note.html"
        mode = body.get("open") or "browser"
        try:
            data = base64.b64decode(body.get("data") or "")
        except Exception as e:
            return self._json(400, {"error": f"bad base64: {e}"})
        safe = re.sub(r'[\\/:*?"<>|]+', "_", fn).strip() or "note"
        exp_dir = os.path.join(DATA_DIR, "exports")
        try:
            os.makedirs(exp_dir, exist_ok=True)
            fpath = os.path.join(exp_dir, safe)
            with open(fpath, "wb") as f:
                f.write(data)
            if mode == "browser":
                webbrowser.open("file:///" + fpath.replace("\\", "/"))
            else:
                try:
                    os.startfile(exp_dir)  # Windows: reveal the folder
                except Exception:
                    webbrowser.open("file:///" + exp_dir.replace("\\", "/"))
            log_action(f"[{now()}] export {mode}: {safe}")
            self._json(200, {"ok": True, "path": fpath})
        except Exception as e:
            log_action(f"[{now()}] export ERROR: {e}")
            self._json(500, {"error": str(e)})

    def _handle_download(self):
        """Save a Todoist-hosted attachment to a location the user picks. The native WebView blocks
        browser downloads, so we pop pywebview's native Save dialog (choose folder + name), then
        fetch the file with our Bearer auth and write it there. Body: {url, name}.
        Fallback (no window): save to Downloads and reveal it in Explorer."""
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "bad json"})
        target = (body.get("url") or "").strip()
        host = urllib.parse.urlparse(target).netloc
        if not target or host not in self.ALLOWED_HOSTS:
            return self._json(403, {"error": f"forbidden host: {host}"})
        name = body.get("name") or os.path.basename(urllib.parse.urlparse(target).path) or "download"
        safe = re.sub(r'[\\/:*?"<>|]+', "_", name).strip() or "download"
        dl_dir = os.path.join(os.path.expanduser("~"), "Downloads")
        if not os.path.isdir(dl_dir):
            dl_dir = os.path.expanduser("~")

        # Ask the user where to save + what to name it (native Save dialog). dest stays None if
        # there's no window or the dialog throws → we fall back to Downloads + reveal below.
        dest = None
        try:
            import webview
            win = webview.windows[0] if getattr(webview, "windows", None) else None
            if win is not None:
                dlg = getattr(getattr(webview, "FileDialog", None), "SAVE", None)
                if dlg is None:
                    dlg = webview.SAVE_DIALOG
                res = win.create_file_dialog(dlg, directory=dl_dir, save_filename=safe)
                if not res:
                    return self._json(200, {"ok": True, "cancelled": True})   # user cancelled
                dest = res[0] if isinstance(res, (list, tuple)) else res
        except Exception as e:
            log_action(f"[{now()}] download dialog error: {e}")

        try:
            req = urllib.request.Request(target, headers={
                "Authorization": f"Bearer {sync_mod.TOKEN}",
                "User-Agent": "Mozilla/5.0",
            })
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if not dest:
                # No dialog → Downloads, without clobbering, then reveal in Explorer.
                base, ext = os.path.splitext(safe)
                dest = os.path.join(dl_dir, safe)
                i = 1
                while os.path.exists(dest):
                    dest = os.path.join(dl_dir, f"{base} ({i}){ext}")
                    i += 1
                with open(dest, "wb") as f:
                    f.write(data)
                try:
                    subprocess.Popen('explorer /select,"' + os.path.normpath(dest) + '"')
                except Exception:
                    pass
            else:
                with open(dest, "wb") as f:
                    f.write(data)
            log_action(f"[{now()}] download: {os.path.basename(dest)}")
            self._json(200, {"ok": True, "path": dest})
        except Exception as e:
            log_action(f"[{now()}] download ERROR: {e}")
            self._json(500, {"error": str(e)})

    def _handle_init(self):
        """First-run onboarding: receive token, validate, write .env, init DB, initial sync."""
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "bad json"})
        token = (body.get("token") or "").strip()
        if not token:
            return self._json(400, {"error": "token is empty"})

        # 1. Quick validation: token format sanity
        # error_key → onboarding translates it; error → fallback (English)
        if len(token) < 20 or " " in token:
            return self._json(400, {"error": "Token is in the wrong format",
                                     "error_key": "err.token_bad_format"})

        # 2. Try a minimal Sync API call to validate
        try:
            old_token = sync_mod.TOKEN
            sync_mod.TOKEN = token
            try:
                _resp = sync_mod.call_sync(sync_token="*", resource_types=["user"])
            finally:
                sync_mod.TOKEN = old_token  # restore in case write fails
            if _resp.get("error"):
                return self._json(401, {"error": f"Todoist rejected the token: {_resp.get('error')}",
                                        "error_key": "err.token_rejected",
                                        "error_args": {"detail": str(_resp.get("error"))}})
        except urllib.error.HTTPError as e:
            return self._json(401, {"error": f"Token could not be verified (HTTP {e.code}). Try again.",
                                    "error_key": "err.token_check_failed",
                                    "error_args": {"code": e.code}})
        except Exception as e:
            return self._json(502, {"error": f"Network error: {e}",
                                    "error_key": "err.network", "error_args": {"detail": str(e)}})

        # 3. Persist token to .env, reload
        try:
            sync_mod.write_env_token(token)
            sync_mod.reload_token()
        except Exception as e:
            return self._json(500, {"error": f"Could not write .env: {e}",
                                    "error_key": "err.env_write_failed", "error_args": {"detail": str(e)}})

        # 4. Initialize DB schema + initial sync (download all)
        try:
            sync_mod.init_db()
            ensure_schema()
            counts = sync_mod.initial_sync()
        except Exception as e:
            return self._json(500, {"error": f"Initial sync failed: {e}",
                                    "error_key": "err.initial_sync_failed", "error_args": {"detail": str(e)}})

        self._json(200, {
            "ok": True,
            "tasks": counts.get("tasks", 0),
            "projects": counts.get("projects", 0),
            "sections": counts.get("sections", 0),
        })

    def _handle_manual_sync(self):
        """User-triggered push + pull. Returns errors if any."""
        push_err = None
        pull_err = None
        try:
            sync_mod.push_queue(verbose=False, quiet=True)
        except Exception as e:
            push_err = str(e)[:200]
        try:
            sync_mod.incremental_sync(quiet=True)
        except Exception as e:
            pull_err = str(e)[:200]
        with _lock:
            resp = {"ok": (push_err is None and pull_err is None)}
            if push_err: resp["push_error"] = push_err
            if pull_err: resp["pull_error"] = pull_err
            resp.update(load_state_dict())
        # Manual "Sync now" also refreshes Google Calendar — pushes any pending
        # task changes to Google right away. No-op when full sync is off.
        gcal_schedule_reconcile(0.5)
        self._json(200, resp)

    def _filter_drop_from_todoist(self, conn, fid):
        """Remove a filter from Todoist: cancel a still-pending filter_add if it was
        never pushed, otherwise queue a filter_delete."""
        pending_add = conn.execute(
            "SELECT 1 FROM pending_ops WHERE command_type='filter_add' "
            "AND json_extract(args_json,'$.temp_id')=?", (fid,)
        ).fetchone()
        if pending_add:
            conn.execute(
                "DELETE FROM pending_ops WHERE json_extract(args_json,'$.temp_id')=? "
                "OR json_extract(args_json,'$.id')=?", (fid, fid)
            )
        else:
            queue_cmd(conn, "filter_delete", {"id": fid})

    # Todoist-sourced data wiped on disconnect. task_local (the Megi layer) is
    # deliberately NOT here — it is local-only and kept across disconnects.
    # filters ARE wiped: synced ones come back on reconnect, local ones are lost
    # (the disconnect dialog warns about this).
    DISCONNECT_WIPE_TABLES = (
        "tasks", "sections", "projects", "labels",
        "comments", "reminders", "filters", "pending_ops", "sync_state",
    )

    def _handle_disconnect(self):
        """Disconnect the Todoist account and erase all synced local data: remove
        the token and wipe every Todoist-sourced table. The Megi layer
        (task_local) is preserved. Reconnecting re-downloads from Todoist."""
        try:
            sync_mod.clear_env_token()
            with _lock:
                with db() as conn:
                    for tbl in self.DISCONNECT_WIPE_TABLES:
                        conn.execute(f"DELETE FROM {tbl}")
                    conn.commit()
        except Exception as e:
            log_action(f"[{now()}] disconnect ERROR: {e}")
            return self._json(500, {"error": str(e)})
        with _lock:
            resp = {"ok": True}
            resp.update(load_state_dict())
        self._json(200, resp)

    def _proxy_attachment(self):
        """Stream a Todoist-hosted file with our Bearer auth, so WebView2 can display it.
        Forwards a Range request (and relays 206 + Content-Range) so an uploaded <video> can
        actually start playing and seek — Chromium/WebView2 needs range support for media."""
        try:
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            target = (params.get("u") or [""])[0]
            if not target:
                return self._json(400, {"error": "missing u"})
            host = urllib.parse.urlparse(target).netloc
            if host not in self.ALLOWED_HOSTS:
                return self._json(403, {"error": f"forbidden host: {host}"})
            headers = {
                "Authorization": f"Bearer {sync_mod.TOKEN}",
                "User-Agent": "Mozilla/5.0",
            }
            rng = self.headers.get("Range")
            if rng:
                headers["Range"] = rng
            req = urllib.request.Request(target, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                ct = r.headers.get("Content-Type", "application/octet-stream")
                content_range = r.headers.get("Content-Range")
                status = r.getcode() or 200
                body = r.read()
            self.send_response(status)
            self.send_header("Content-Type", ct)
            self.send_header("Accept-Ranges", "bytes")
            if content_range:
                self.send_header("Content-Range", content_range)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, max-age=3600")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self._json(502, {"error": str(e)})

    def _handle_nb_deleted_resolve(self):
        """Notebook pages deleted on Todoist (state.nb_deleted_pending): the user chose
        {ids:[…], action:"restore"|"discard"}. Restore talks to Todoist (re-uploads the page's
        files), so it manages the DB lock itself — outside the generic _handle path."""
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "bad json"})
        action = body.get("action") or ""
        if action not in ("restore", "discard"):
            return self._json(400, {"error": "bad action"})
        try:
            summary = nb_files.resolve_remote_deleted(body.get("ids") or [], action)
        except Exception as e:
            log_action(f"[{now()}] ERROR nb_deleted_resolve: {e}")
            return self._json(500, {"error": str(e)})
        resp = {"ok": True, "summary": summary}
        resp.update(load_state_dict())
        self._json(200, resp)

    def _handle_file_alive(self):
        """Check whether a Todoist-hosted file still exists. Its comment may have been deleted
        elsewhere (phone/web) while we weren't watching; on open the note uses this to replace a
        now-dead inline image with an empty "add image" block. Returns {alive: bool}.

        Safety: only Todoist hosts are probed; anything else (or any network error) is reported
        alive, so a transient failure never wrongly deletes the user's image. Only a clear
        401/403/404/410 counts as dead."""
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "bad json"})
        target = (body.get("url") or "").strip()
        host = urllib.parse.urlparse(target).netloc
        if not target or host not in self.ALLOWED_HOSTS:
            return self._json(200, {"alive": True})   # not a Todoist file → not ours to judge
        req = urllib.request.Request(target, headers={
            "Authorization": f"Bearer {sync_mod.TOKEN}",
            "User-Agent": "Mozilla/5.0",
            "Range": "bytes=0-0",   # fetch a single byte — we only care about the status
        })
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return self._json(200, {"alive": 200 <= r.status < 400})
        except urllib.error.HTTPError as e:
            return self._json(200, {"alive": e.code not in (401, 403, 404, 410)})
        except Exception:
            return self._json(200, {"alive": True})

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/upload":
            return self._handle_upload()
        if path == "/api/upload_url":
            return self._handle_upload_url()
        if path == "/api/file_alive":
            return self._handle_file_alive()
        if path == "/api/sync":
            return self._handle_manual_sync()
        if path == "/api/init":
            return self._handle_init()
        if path == "/api/disconnect":
            return self._handle_disconnect()
        if path == "/api/export_open":
            return self._handle_export()
        if path == "/api/download":
            return self._handle_download()
        if path == "/api/nb_deleted_resolve":
            return self._handle_nb_deleted_resolve()
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "bad json"})
        self.added_id = None
        self.deleted_ids = None
        with _lock:
            with db() as conn:
                try:
                    ok = self._handle(conn, path, body)
                    if ok:
                        conn.commit()
                except Exception as e:
                    log_action(f"[{now()}] ERROR {path}: {e}")
                    return self._json(500, {"error": str(e)})
        if not ok:
            return self._json(404, {"error": "unknown action"})
        # Any successful mutation may have touched a due/priority/content —
        # let the debounced Google Calendar pass pick it up (no-op when
        # full sync is off or nothing changed).
        gcal_schedule_reconcile()
        resp = {"ok": True}
        if isinstance(ok, dict):
            resp.update(ok)          # handler extras (e.g. agent_panel batch_id)
        if getattr(self, "added_id", None):
            resp["new_id"] = self.added_id
        if getattr(self, "deleted_ids", None):
            resp["deleted_ids"] = self.deleted_ids
        resp.update(load_state_dict())
        self._json(200, resp)

    def _handle(self, conn, path, body):
        tid = body.get("id")
        short = short_title(conn, tid) if tid else ""

        if path.startswith("/api/agent_"):
            # AI agent panel endpoints live in agent_panel.py (returns True / dict / False)
            return agent_panel.handle_post(conn, path, body)

        if path == "/api/sync_discard_dead":
            # Drop the commands Todoist rejected for good (pending_ops.dead=1, see
            # sync.apply_sync_status). The local rows stay as they are; nothing is sent.
            rows = conn.execute(
                "SELECT command_type, last_error FROM pending_ops WHERE dead=1"
            ).fetchall()
            conn.execute("DELETE FROM pending_ops WHERE dead=1")
            log_action(f"[{now()}] dropped {len(rows)} rejected command(s): "
                       + ", ".join(f"{r['command_type']} ({r['last_error']})" for r in rows))
            return {"discarded": len(rows)}

        if path == "/api/update" and tid:
            return self._update_field(conn, tid, short, body.get("field"), body.get("value"))

        if path == "/api/reminder_add" and tid:
            return self._reminder_add(conn, tid, short, body)

        if path == "/api/reminder_delete":
            return self._reminder_delete(conn, body)

        if path == "/api/subtask_add" and tid:
            text = (body.get("text") or "").strip()
            if not text:
                return True
            parent = conn.execute(
                "SELECT project_id, section_id FROM tasks WHERE id=?", (tid,)
            ).fetchone()
            if not parent:
                return True
            sid = str(uuid.uuid4())
            max_order = conn.execute(
                "SELECT COALESCE(MAX(child_order),0)+1 m FROM tasks WHERE parent_id=?", (tid,)
            ).fetchone()["m"]
            conn.execute(
                "INSERT INTO tasks(id,project_id,section_id,parent_id,content,priority,"
                "child_order,added_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)",
                (sid, parent["project_id"], parent["section_id"], tid, text,
                 max_order, now_iso(), now_iso()),
            )
            queue_cmd(conn, "item_add", {
                "temp_id": sid,
                "content": text,
                "project_id": parent["project_id"],
                "parent_id": tid,
                "priority": 1,
            })
            log_action(f"[{now()}] {tid} → subtask added: {text!r}")
            return True

        if path == "/api/subtask_toggle" and tid:
            idx = body.get("idx", -1)
            done = body.get("done", False)
            subs = conn.execute(
                "SELECT id FROM tasks WHERE parent_id=? AND is_deleted=0 ORDER BY child_order",
                (tid,)
            ).fetchall()
            if 0 <= idx < len(subs):
                sub_id = subs[idx]["id"]
                conn.execute(
                    "UPDATE tasks SET checked=?, completed_at=? WHERE id=?",
                    (1 if done else 0, now_iso() if done else None, sub_id),
                )
                queue_cmd(conn, "item_complete" if done else "item_uncomplete", {"id": sub_id})
                log_action(f"[{now()}] {tid} → subtask {'✓' if done else '○'} idx={idx}")
            return True

        if path == "/api/subtask_del" and tid:
            idx = body.get("idx", -1)
            subs = conn.execute(
                "SELECT id, content FROM tasks WHERE parent_id=? AND is_deleted=0 ORDER BY child_order",
                (tid,)
            ).fetchall()
            if 0 <= idx < len(subs):
                sub_id = subs[idx]["id"]
                conn.execute("UPDATE tasks SET is_deleted=1 WHERE id=?", (sub_id,))
                if has_pending_add(conn, sub_id):
                    cancel_pending_for(conn, sub_id)
                else:
                    queue_cmd(conn, "item_delete", {"id": sub_id})
                log_action(f"[{now()}] {tid} → subtask deleted: {subs[idx]['content']!r}")
            return True

        if path == "/api/task_add":
            text = body.get("text") or "New task"
            proj_name = body.get("project") or "Inbox"
            sec_name = body.get("section") or ""
            desc = body.get("description") or ""
            prio_ui = body.get("priority", "P4")
            due_date = body.get("due_date") or None
            due_time = (body.get("due_time") or "").strip() or None
            due_tz = (body.get("due_timezone") or "").strip() or None

            pid = lookup_project_id(conn, proj_name)
            if not pid:
                return True
            sid = lookup_section_id(conn, pid, sec_name) if sec_name else None
            new_id = str(uuid.uuid4())
            priority = PRIO_UI_TO_TD.get(prio_ui, 1)
            if sid is None:
                m = conn.execute(
                    "SELECT COALESCE(MAX(child_order),0)+1 m FROM tasks "
                    "WHERE project_id=? AND section_id IS NULL AND parent_id IS NULL",
                    (pid,)
                ).fetchone()["m"]
            else:
                m = conn.execute(
                    "SELECT COALESCE(MAX(child_order),0)+1 m FROM tasks "
                    "WHERE project_id=? AND section_id=? AND parent_id IS NULL",
                    (pid, sid)
                ).fetchone()["m"]
            labels = body.get("labels") or []
            # A timed due lives in due_datetime (due_date NULL) — the shape split_due
            # and task_due_obj already understand.
            due_datetime = f"{due_date}T{due_time}:00" if (due_date and due_time) else None
            conn.execute(
                "INSERT INTO tasks(id,project_id,section_id,content,description,priority,"
                "labels_json,due_date,due_datetime,due_timezone,child_order,added_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (new_id, pid, sid, text, desc, priority,
                 json.dumps(labels, ensure_ascii=False),
                 (None if due_datetime else due_date), due_datetime,
                 (due_tz if due_datetime else None), m, now_iso(), now_iso()),
            )
            add_args = {
                "temp_id": new_id,
                "content": text,
                "project_id": pid,
                "priority": priority,
            }
            if sid: add_args["section_id"] = sid
            if desc: add_args["description"] = desc
            if labels: add_args["labels"] = labels
            due = task_due_obj(conn, new_id)
            if due: add_args["due"] = due
            queue_cmd(conn, "item_add", add_args)
            self.added_id = new_id
            log_action(f"[{now()}] {new_id[:8]} → new task «{text[:30]}»")
            return True

        if path == "/api/task_duplicate" and tid:
            t = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
            if not t:
                return True
            new_id = str(uuid.uuid4())
            new_content = (t["content"] or "") + " (copy)"
            conn.execute(
                "INSERT INTO tasks(id,project_id,section_id,parent_id,content,description,"
                "priority,labels_json,due_date,due_datetime,due_string,due_is_recurring,"
                "child_order,added_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (new_id, t["project_id"], t["section_id"], t["parent_id"],
                 new_content, t["description"] or "", t["priority"],
                 t["labels_json"], t["due_date"], t["due_datetime"], t["due_string"],
                 t["due_is_recurring"], (t["child_order"] or 0) + 1,
                 now_iso(), now_iso()),
            )
            add_args = {
                "temp_id": new_id,
                "content": new_content,
                "project_id": t["project_id"],
                "priority": t["priority"],
            }
            if t["section_id"]: add_args["section_id"] = t["section_id"]
            if t["parent_id"]:  add_args["parent_id"] = t["parent_id"]
            if t["description"]: add_args["description"] = t["description"]
            due = task_due_obj(conn, new_id)
            if due: add_args["due"] = due
            try:
                labels = json.loads(t["labels_json"] or "[]")
                if labels: add_args["labels"] = labels
            except Exception: pass
            queue_cmd(conn, "item_add", add_args)
            log_action(f"[{now()}] {tid} → duplicate {new_id[:8]} ({short!r})")
            return True

        if path == "/api/task_delete" and tid:
            conn.execute("UPDATE tasks SET is_deleted=1, updated_at=? WHERE id=?", (now_iso(), tid))
            subs = conn.execute(
                "SELECT id FROM tasks WHERE parent_id=? AND is_deleted=0", (tid,)
            ).fetchall()
            for s in subs:
                conn.execute("UPDATE tasks SET is_deleted=1, updated_at=? WHERE id=?", (now_iso(), s["id"]))
            # If the task (or any subtask) was local-only — cancel pending; else queue delete.
            if has_pending_add(conn, tid):
                cancel_pending_for(conn, tid)
            else:
                queue_cmd(conn, "item_delete", {"id": tid})
            for s in subs:
                if has_pending_add(conn, s["id"]):
                    cancel_pending_for(conn, s["id"])
                else:
                    queue_cmd(conn, "item_delete", {"id": s["id"]})
            # Report what was soft-deleted so the client can offer an exact restore.
            self.deleted_ids = [tid] + [s["id"] for s in subs]
            log_action(f"[{now()}] {tid} «{short}» → deleted")
            return True

        if path == "/api/task_restore" and tid:
            # Undo of task_delete: un-hide the task + its (deleted-together) subtasks.
            ids = [tid] + [i for i in (body.get("subs") or []) if i]
            for i in ids:
                conn.execute(
                    "UPDATE tasks SET is_deleted=0, updated_at=? WHERE id=?", (now_iso(), i)
                )
            # Sync: if the delete is still queued (not yet pushed) just cancel it —
            # Todoist never knew. If it was already pushed, recreate the task (new id).
            for i in ids:
                pend = conn.execute(
                    "SELECT uuid FROM pending_ops WHERE command_type='item_delete' "
                    "AND json_extract(args_json,'$.id')=?", (i,)
                ).fetchone()
                if pend:
                    conn.execute("DELETE FROM pending_ops WHERE uuid=?", (pend["uuid"],))
                else:
                    row = conn.execute("SELECT * FROM tasks WHERE id=?", (i,)).fetchone()
                    if row:
                        queue_cmd(conn, "item_add", build_item_add_args(conn, row))
            log_action(f"[{now()}] {tid} «{short}» → restored")
            return True

        if path == "/api/task_move" and tid:
            new_proj = body.get("project", "")
            pid = lookup_project_id(conn, new_proj)
            if pid:
                conn.execute(
                    "UPDATE tasks SET project_id=?, section_id=NULL, updated_at=? WHERE id=?",
                    (pid, now_iso(), tid),
                )
                queue_cmd(conn, "item_move", {"id": tid, "project_id": pid})
                log_action(f"[{now()}] {tid} «{short}» → → {new_proj}")
            return True

        if path == "/api/task_reorder":
            order = body.get("order")  # full ordered id list (section sort)
            if order:
                items = []
                ts = now_iso()
                for i, oid in enumerate(order):
                    conn.execute("UPDATE tasks SET child_order=?, updated_at=? WHERE id=?", (i + 1, ts, oid))
                    items.append({"id": oid, "child_order": i + 1})
                if items:
                    queue_cmd(conn, "item_reorder", {"items": items})
                    log_action(f"[{now()}] section sorted ({len(items)} items)")
                return True
            if not tid:
                return True
            direction = body.get("dir")  # "up" | "down"
            row = conn.execute(
                "SELECT project_id, section_id, child_order FROM tasks WHERE id=?", (tid,)
            ).fetchone()
            if not row:
                return True
            sibs = conn.execute(
                "SELECT id, child_order FROM tasks WHERE project_id=? AND section_id IS ? "
                "AND parent_id IS NULL AND is_deleted=0 AND checked=0 "
                "ORDER BY child_order, added_at",
                (row["project_id"], row["section_id"]),
            ).fetchall()
            ids = [s["id"] for s in sibs]
            if tid not in ids:
                return True
            idx = ids.index(tid)
            swap = idx - 1 if direction == "up" else idx + 1
            if swap < 0 or swap >= len(ids):
                return True
            a, b = sibs[idx], sibs[swap]
            oa = a["child_order"] or 0
            ob = b["child_order"] or 0
            if oa == ob:
                ob = oa + (1 if direction == "down" else -1)
            conn.execute("UPDATE tasks SET child_order=?, updated_at=? WHERE id=?", (ob, now_iso(), a["id"]))
            conn.execute("UPDATE tasks SET child_order=?, updated_at=? WHERE id=?", (oa, now_iso(), b["id"]))
            queue_cmd(conn, "item_reorder", {"items": [
                {"id": a["id"], "child_order": ob},
                {"id": b["id"], "child_order": oa},
            ]})
            log_action(f"[{now()}] {tid} «{short}» → reorder {direction}")
            return True

        if path == "/api/section_add":
            proj_name = body.get("project", "")
            name = (body.get("name") or "").strip()
            after_name = body.get("after")  # name to insert after; "" = top; None = end
            pid = lookup_project_id(conn, proj_name)
            if pid and name:
                exists = conn.execute(
                    "SELECT 1 FROM sections WHERE project_id=? AND name=? AND is_deleted=0",
                    (pid, name)
                ).fetchone()
                if not exists:
                    sid = str(uuid.uuid4())
                    reorder_needed = False
                    if after_name is None:
                        section_order = conn.execute(
                            "SELECT COALESCE(MAX(section_order),0)+1 m FROM sections WHERE project_id=?",
                            (pid,)
                        ).fetchone()["m"]
                    else:
                        if after_name == "":
                            insert_order = 1
                        else:
                            row = conn.execute(
                                "SELECT section_order FROM sections WHERE project_id=? AND name=? AND is_deleted=0",
                                (pid, after_name)
                            ).fetchone()
                            if row:
                                insert_order = row["section_order"] + 1
                            else:
                                insert_order = conn.execute(
                                    "SELECT COALESCE(MAX(section_order),0)+1 m FROM sections WHERE project_id=?",
                                    (pid,)
                                ).fetchone()["m"]
                        # Bump existing sections at >= insert_order
                        conn.execute(
                            "UPDATE sections SET section_order = section_order + 1, updated_at = ? "
                            "WHERE project_id = ? AND is_deleted = 0 AND section_order >= ?",
                            (now_iso(), pid, insert_order),
                        )
                        section_order = insert_order
                        reorder_needed = True
                    conn.execute(
                        "INSERT INTO sections(id,project_id,name,section_order,added_at,updated_at) "
                        "VALUES(?,?,?,?,?,?)",
                        (sid, pid, name, section_order, now_iso(), now_iso()),
                    )
                    queue_cmd(conn, "section_add", {
                        "temp_id": sid,
                        "name": name,
                        "project_id": pid,
                        "section_order": section_order,
                    })
                    if reorder_needed:
                        rows = conn.execute(
                            "SELECT id, section_order FROM sections "
                            "WHERE project_id=? AND is_deleted=0 ORDER BY section_order",
                            (pid,)
                        ).fetchall()
                        payload = [{"id": r["id"], "section_order": i + 1} for i, r in enumerate(rows)]
                        queue_cmd(conn, "section_reorder", {"sections": payload})
                    log_action(f"[{now()}] section added: {proj_name} / «{name}» (order={section_order})")
            return True

        if path == "/api/section_delete":
            proj_name = body.get("project", "")
            name = body.get("name", "")
            pid = lookup_project_id(conn, proj_name)
            sid = lookup_section_id(conn, pid, name) if pid else None
            if sid:
                conn.execute("UPDATE sections SET is_deleted=1, updated_at=? WHERE id=?", (now_iso(), sid))
                conn.execute("UPDATE tasks SET section_id=NULL, updated_at=? WHERE section_id=?", (now_iso(), sid))
                # If section was local-only — cancel pending section_add
                pending_add = conn.execute(
                    "SELECT 1 FROM pending_ops "
                    "WHERE command_type='section_add' AND json_extract(args_json,'$.temp_id')=?",
                    (sid,)
                ).fetchone()
                if pending_add:
                    conn.execute(
                        "DELETE FROM pending_ops "
                        "WHERE json_extract(args_json,'$.id')=? OR json_extract(args_json,'$.temp_id')=?",
                        (sid, sid)
                    )
                else:
                    queue_cmd(conn, "section_delete", {"id": sid})
                log_action(f"[{now()}] section deleted: {proj_name} / «{name}»")
            return True

        if path == "/api/section_rename":
            proj_name = body.get("project", "")
            old_name = body.get("old", "")
            new_name = (body.get("new") or "").strip()
            pid = lookup_project_id(conn, proj_name)
            sid = lookup_section_id(conn, pid, old_name) if pid else None
            if sid and new_name:
                conn.execute(
                    "UPDATE sections SET name=?, updated_at=? WHERE id=?",
                    (new_name, now_iso(), sid),
                )
                queue_cmd(conn, "section_update", {"id": sid, "name": new_name})
                log_action(f"[{now()}] section: «{old_name}» → «{new_name}»")
            return True

        if path == "/api/section_reorder":
            proj_name = body.get("project", "")
            order = body.get("order") or []  # list of section names in new order
            pid = lookup_project_id(conn, proj_name)
            if not pid or not order:
                return True
            payload = []
            for i, name in enumerate(order):
                sid = lookup_section_id(conn, pid, name)
                if not sid:
                    continue
                conn.execute(
                    "UPDATE sections SET section_order=?, updated_at=? WHERE id=?",
                    (i + 1, now_iso(), sid),
                )
                payload.append({"id": sid, "section_order": i + 1})
            if payload:
                queue_cmd(conn, "section_reorder", {"sections": payload})
                log_action(f"[{now()}] sections reordered: {proj_name} ({len(payload)})")
            return True

        if path == "/api/project_add":
            name = (body.get("name") or "").strip()
            color = body.get("color") or "charcoal"
            is_fav = bool(body.get("is_favorite"))   # add straight to Todoist Favorites on creation
            anchor = body.get("anchor")       # name of an existing project to insert near; None = append
            above = bool(body.get("above"))   # True = insert above anchor, else below
            if not name:
                return True
            base = None
            if anchor:
                arow = conn.execute(
                    "SELECT child_order FROM projects "
                    "WHERE name=? AND is_deleted=0 AND is_inbox=0", (anchor,)
                ).fetchone()
                base = arow["child_order"] if arow else None
            if base is None:
                child_order = conn.execute(
                    "SELECT COALESCE(MAX(child_order),0)+1 m FROM projects "
                    "WHERE is_inbox=0 AND is_deleted=0"
                ).fetchone()["m"]
            else:
                child_order = base if above else base + 1
                conn.execute(
                    "UPDATE projects SET child_order = child_order + 1 "
                    "WHERE is_inbox=0 AND is_deleted=0 AND child_order >= ?",
                    (child_order,),
                )
            pid = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO projects(id,name,color,child_order,is_favorite,is_inbox,is_archived,is_deleted) "
                "VALUES(?,?,?,?,?,0,0,0)",
                (pid, name, color, child_order, 1 if is_fav else 0),
            )
            add_args = {
                "temp_id": pid, "name": name, "color": color, "child_order": child_order,
            }
            if is_fav:
                add_args["is_favorite"] = True
            queue_cmd(conn, "project_add", add_args)
            log_action(f"[{now()}] project added: «{name}» ({color}, order={child_order}, fav={is_fav})")
            return True

        if path == "/api/project_update":
            old_name = body.get("name", "")
            new_name = body.get("new_name")
            color = body.get("color")
            is_fav = body.get("is_favorite")   # None = leave unchanged; bool = set
            pid = conn.execute(
                "SELECT id FROM projects WHERE name=? AND is_deleted=0 AND is_inbox=0", (old_name,)
            ).fetchone()
            pid = pid["id"] if pid else None
            if not pid:
                return True
            args = {"id": pid}
            if new_name is not None and new_name.strip():
                nn = new_name.strip()
                conn.execute("UPDATE projects SET name=? WHERE id=?", (nn, pid))
                args["name"] = nn
            if color:
                conn.execute("UPDATE projects SET color=? WHERE id=?", (color, pid))
                args["color"] = color
            if is_fav is not None:
                fav = bool(is_fav)
                conn.execute("UPDATE projects SET is_favorite=? WHERE id=?", (1 if fav else 0, pid))
                args["is_favorite"] = fav
            if len(args) > 1:
                queue_cmd(conn, "project_update", args)
                log_action(f"[{now()}] project updated: «{old_name}» {args}")
            return True

        if path == "/api/gcal_set_url":
            # The URL is a secret — store it in app_settings only, never log it.
            url = (body.get("url") or "").strip()
            if not url.lower().startswith("https://"):
                raise ValueError("bad url")
            name = gcal.probe(url)     # fetch once: validates + returns the calendar name
            set_setting(conn, "gcal_ics_url", url)
            set_setting(conn, "gcal_name", name)
            log_action(f"[{now()}] gcal connected («{name}»)")
            return True

        if path == "/api/gcal_disconnect":
            conn.execute("DELETE FROM app_settings WHERE key IN ('gcal_ics_url','gcal_name')")
            gcal.clear_cache()
            log_action(f"[{now()}] gcal disconnected")
            return True

        if path == "/api/gcal_oauth_creds":
            # Full sync, step 1: store the user's OAuth client and open the
            # consent screen in the system browser. Secrets are never logged.
            cid = (body.get("client_id") or "").strip()
            cs = (body.get("client_secret") or "").strip()
            if not cid or not cs:
                raise ValueError("empty credentials")
            state = uuid.uuid4().hex
            set_setting(conn, "gcal_client_id", cid)
            set_setting(conn, "gcal_client_secret", cs)
            set_setting(conn, "gcal_oauth_state", state)
            url = gcal_api.build_auth_url(cid, f"http://127.0.0.1:{PORT}/oauth/callback", state)
            try:
                webbrowser.open(url)
            except Exception as e:
                log_action(f"[{now()}] gcal oauth browser open failed: {e}")
            log_action(f"[{now()}] gcal full sync: consent screen opened")
            return True

        if path == "/api/gcal_oauth_disconnect":
            rt = get_setting(conn, "gcal_refresh_token", "")
            if rt:
                gcal_api.revoke(rt)
            conn.execute("DELETE FROM app_settings WHERE key IN "
                         "('gcal_refresh_token','gcal_access_token','gcal_access_expiry','gcal_oauth_state')")
            log_action(f"[{now()}] gcal full sync disconnected")
            return True

        if path == "/api/set_pref":
            key = (body.get("key") or "").strip()
            if key:
                set_setting(conn, key, "1" if body.get("value") else "0")
                log_action(f"[{now()}] pref set: {key}={body.get('value')}")
            return True

        if path == "/api/project_archive":
            name = body.get("name", "")
            row = conn.execute(
                "SELECT id FROM projects WHERE name=? AND is_deleted=0 AND is_inbox=0", (name,)
            ).fetchone()
            if row:
                pid = row["id"]
                conn.execute("UPDATE projects SET is_archived=1 WHERE id=?", (pid,))
                queue_cmd(conn, "project_archive", {"id": pid})
                log_action(f"[{now()}] project archived: «{name}»")
            return True

        if path == "/api/project_delete":
            name = body.get("name", "")
            row = conn.execute(
                "SELECT id FROM projects WHERE name=? AND is_deleted=0 AND is_inbox=0", (name,)
            ).fetchone()
            if row:
                pid = row["id"]
                conn.execute("UPDATE projects SET is_deleted=1 WHERE id=?", (pid,))
                # Todoist cascades the delete server-side; mirror it locally
                conn.execute("UPDATE tasks SET is_deleted=1 WHERE project_id=?", (pid,))
                conn.execute("UPDATE sections SET is_deleted=1 WHERE project_id=?", (pid,))
                # If the project was local-only (never pushed), cancel its pending project_add
                pending_add = conn.execute(
                    "SELECT 1 FROM pending_ops "
                    "WHERE command_type='project_add' AND json_extract(args_json,'$.temp_id')=?",
                    (pid,)
                ).fetchone()
                if pending_add:
                    conn.execute(
                        "DELETE FROM pending_ops "
                        "WHERE json_extract(args_json,'$.id')=? OR json_extract(args_json,'$.temp_id')=?",
                        (pid, pid)
                    )
                else:
                    queue_cmd(conn, "project_delete", {"id": pid})
                log_action(f"[{now()}] project deleted: «{name}»")
            return True

        if path == "/api/project_unarchive":
            name = body.get("name", "")
            # Free-tier guard: skip if 5 active projects already exist (frontend also checks)
            active = conn.execute(
                "SELECT COUNT(*) c FROM projects WHERE is_deleted=0 AND is_archived=0 AND is_inbox=0"
            ).fetchone()["c"]
            if active >= 5:
                return True
            row = conn.execute(
                "SELECT id FROM projects WHERE name=? AND is_deleted=0 AND is_archived=1 AND is_inbox=0", (name,)
            ).fetchone()
            if row:
                pid = row["id"]
                conn.execute("UPDATE projects SET is_archived=0 WHERE id=?", (pid,))
                queue_cmd(conn, "project_unarchive", {"id": pid})
                log_action(f"[{now()}] project unarchived: «{name}»")
            return True

        if path == "/api/project_reorder":
            order = body.get("order") or []  # list of project names in new order (Inbox excluded)
            payload = []
            for i, nm in enumerate(order):
                row = conn.execute(
                    "SELECT id FROM projects WHERE name=? AND is_deleted=0 AND is_inbox=0", (nm,)
                ).fetchone()
                if not row:
                    continue
                conn.execute("UPDATE projects SET child_order=? WHERE id=?", (i + 1, row["id"]))
                payload.append({"id": row["id"], "child_order": i + 1})
            if payload:
                queue_cmd(conn, "project_reorder", {"projects": payload})
                log_action(f"[{now()}] projects reordered ({len(payload)})")
            return True

        # ---- Filters: local by default; up to 3 can be mirrored to Todoist ----
        if path == "/api/filter_add":
            name = (body.get("name") or "").strip()
            query = (body.get("query") or "").strip()
            color = body.get("color") or "charcoal"
            if not name:
                return True
            order = conn.execute(
                "SELECT COALESCE(MAX(item_order),0)+1 m FROM filters WHERE is_deleted=0"
            ).fetchone()["m"]
            fid = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO filters(id,name,query,color,item_order,is_favorite,is_synced,is_deleted) "
                "VALUES(?,?,?,?,?,0,0,0)",
                (fid, name, query, color, order),
            )
            self.added_id = fid
            log_action(f"[{now()}] filter added: «{name}» [{query}]")
            return True

        if path == "/api/filter_update":
            fid = body.get("id")
            if not fid:
                return True
            row = conn.execute("SELECT is_synced FROM filters WHERE id=?", (fid,)).fetchone()
            args = {"id": fid}
            if (body.get("name") or "").strip():
                nm = body["name"].strip()
                conn.execute("UPDATE filters SET name=? WHERE id=?", (nm, fid)); args["name"] = nm
            if "query" in body:
                q = (body.get("query") or "").strip()
                conn.execute("UPDATE filters SET query=? WHERE id=?", (q, fid)); args["query"] = q
            if body.get("color"):
                conn.execute("UPDATE filters SET color=? WHERE id=?", (body["color"], fid)); args["color"] = body["color"]
            if row and row["is_synced"] and len(args) > 1:
                queue_cmd(conn, "filter_update", args)
            log_action(f"[{now()}] filter updated: {fid}")
            return True

        if path == "/api/filter_delete":
            fid = body.get("id")
            if fid:
                row = conn.execute("SELECT is_synced FROM filters WHERE id=?", (fid,)).fetchone()
                conn.execute("UPDATE filters SET is_deleted=1 WHERE id=?", (fid,))
                if row and row["is_synced"]:
                    self._filter_drop_from_todoist(conn, fid)
                log_action(f"[{now()}] filter deleted: {fid}")
            return True

        if path == "/api/filter_sync":      # local -> synced (push to Todoist)
            fid = body.get("id")
            if not fid:
                return True
            synced = conn.execute(
                "SELECT COUNT(*) c FROM filters WHERE is_synced=1 AND is_deleted=0"
            ).fetchone()["c"]
            row = conn.execute(
                "SELECT name, query, color, is_synced FROM filters WHERE id=? AND is_deleted=0", (fid,)
            ).fetchone()
            if not row or row["is_synced"]:
                return True
            if synced >= FILTER_SYNC_LIMIT:
                return True                  # over the Free limit — frontend already guards
            conn.execute("UPDATE filters SET is_synced=1 WHERE id=?", (fid,))
            queue_cmd(conn, "filter_add", {
                "temp_id": fid, "name": row["name"], "query": row["query"] or "", "color": row["color"],
            })
            log_action(f"[{now()}] filter → synced: «{row['name']}»")
            return True

        if path == "/api/filter_unsync":    # synced -> local (remove from Todoist, keep local)
            fid = body.get("id")
            if fid:
                conn.execute("UPDATE filters SET is_synced=0 WHERE id=?", (fid,))
                self._filter_drop_from_todoist(conn, fid)
                log_action(f"[{now()}] filter → local: {fid}")
            return True

        if path == "/api/filter_reorder":
            order = body.get("order") or []  # list of filter ids in new order
            for i, fid in enumerate(order):
                conn.execute("UPDATE filters SET item_order=? WHERE id=?", (i + 1, fid))
            return True

        if path == "/api/nb_flush":
            # Page left / window closing: attach the JSON now instead of waiting out the idle timer.
            # The upload runs outside this request's DB lock (own thread), so respond at once.
            fid = body.get("id") or None
            threading.Thread(target=nb_files.flush_due, args=(fid,), daemon=True).start()
            return True

        if path == "/api/comment_add" and tid:
            text = (body.get("text") or "").strip()
            attachment = body.get("attachment")
            if not text and not attachment:
                return True
            new_id = str(uuid.uuid4())
            ts = now_iso()
            conn.execute(
                "INSERT INTO comments(id,task_id,content,posted_at,file_attachment) VALUES(?,?,?,?,?)",
                (new_id, tid, text, ts,
                 json.dumps(attachment, ensure_ascii=False) if attachment else None),
            )
            cmd_args = {"temp_id": new_id, "item_id": tid, "content": text}
            if attachment:
                cmd_args["file_attachment"] = attachment
            queue_cmd(conn, "note_add", cmd_args)
            log_action(f"[{now()}] {tid} «{short}» → comment +1{' [+attachment]' if attachment else ''}")
            return True

        if path == "/api/comment_delete":
            cid = body.get("comment_id")
            if not cid:
                return True
            conn.execute("UPDATE comments SET is_deleted=1 WHERE id=?", (cid,))
            pending_add = conn.execute(
                "SELECT 1 FROM pending_ops "
                "WHERE command_type='note_add' AND json_extract(args_json,'$.temp_id')=?",
                (cid,)
            ).fetchone()
            if pending_add:
                conn.execute(
                    "DELETE FROM pending_ops "
                    "WHERE json_extract(args_json,'$.id')=? OR json_extract(args_json,'$.temp_id')=?",
                    (cid, cid)
                )
            else:
                queue_cmd(conn, "note_delete", {"id": cid})
            log_action(f"[{now()}] comment deleted: {cid[:8]}")
            return True

        if path == "/api/refresh":
            # Manual sync: push pending → pull deltas. Returns updated state.
            try:
                sync_mod.push_queue(verbose=False, quiet=True)
            except Exception as e:
                log_action(f"[{now()}] refresh push error: {e}")
            try:
                sync_mod.incremental_sync(quiet=True)
            except Exception as e:
                log_action(f"[{now()}] refresh pull error: {e}")
            return True

        if path == "/api/all_done":
            log_action(f"[{now()}] ▶▶ User: ready for Todoister's review")
            return True

        return False

    def _reminder_add(self, conn, tid, short, body):
        """Add a reminder. Body: {id, type:'relative'|'absolute', mm_offset?, due_date?, due_time?}
        Pro feature — Todoist may reject; local row is written regardless and command queued."""
        rtype = (body.get("type") or "relative").strip()
        rid = str(uuid.uuid4())
        if rtype == "relative":
            try:
                mm = int(body.get("mm_offset") or 30)
            except Exception:
                mm = 30
            conn.execute(
                "INSERT INTO reminders(id, item_id, type, mm_offset, is_deleted) "
                "VALUES(?, ?, 'relative', ?, 0)",
                (rid, tid, mm),
            )
            queue_cmd(conn, "reminder_add", {
                "temp_id": rid,
                "item_id": tid,
                "type": "relative",
                "minute_offset": mm,
            })
            log_action(f"[{now()}] {tid} «{short}» → reminder add: {mm} min before")
        else:
            d = (body.get("due_date") or "").strip()
            t = (body.get("due_time") or "").strip()
            if not d:
                return True  # ignore empty
            if t:
                due_dt = f"{d}T{t}:00"
                conn.execute(
                    "INSERT INTO reminders(id, item_id, type, due_datetime, is_deleted) "
                    "VALUES(?, ?, 'absolute', ?, 0)",
                    (rid, tid, due_dt),
                )
                due_arg = {"date": due_dt}
            else:
                conn.execute(
                    "INSERT INTO reminders(id, item_id, type, due_date, is_deleted) "
                    "VALUES(?, ?, 'absolute', ?, 0)",
                    (rid, tid, d),
                )
                due_arg = {"date": d}
            queue_cmd(conn, "reminder_add", {
                "temp_id": rid,
                "item_id": tid,
                "type": "absolute",
                "due": due_arg,
            })
            log_action(f"[{now()}] {tid} «{short}» → reminder add: {d} {t}")
        return True

    def _reminder_delete(self, conn, body):
        rid = body.get("reminder_id")
        if not rid:
            return True
        row = conn.execute("SELECT item_id FROM reminders WHERE id=?", (rid,)).fetchone()
        if not row:
            return True
        conn.execute("UPDATE reminders SET is_deleted=1 WHERE id=?", (rid,))
        # If the reminder was never pushed (still has its temp uuid), just drop the pending_add
        local_only = has_pending_reminder_add(conn, rid)
        if local_only:
            cancel_pending_reminder_for(conn, rid)
        else:
            queue_cmd(conn, "reminder_delete", {"id": rid})
        log_action(f"[{now()}] reminder {rid[:8]}… deleted")
        return True

    def _update_field(self, conn, tid, short, field, value):
        ts = now_iso()
        if field == "text":
            conn.execute("UPDATE tasks SET content=?, updated_at=? WHERE id=?", (value, ts, tid))
            queue_cmd(conn, "item_update", {"id": tid, "content": value}, coalesce_id=tid)
            log_action(f"[{now()}] {tid} → text changed")
        elif field == "description":
            conn.execute("UPDATE tasks SET description=?, updated_at=? WHERE id=?", (value, ts, tid))
            queue_cmd(conn, "item_update", {"id": tid, "description": value}, coalesce_id=tid)
            log_action(f"[{now()}] {tid} «{short}» → description")
        elif field == "nb_body":
            # Notebook page body, dual storage: value = {"md": <Markdown>, "json": <BlockNote
            # envelope>}. Markdown goes to the task description (Todoist renders it, editable on
            # any device); the full document stays local in task_local.body_json (and later
            # travels as an attached file). Todoist never sees the JSON in the description.
            value = value if isinstance(value, dict) else {}
            md = value.get("md") or ""
            body_json = value.get("json") or ""
            conn.execute("UPDATE tasks SET description=?, updated_at=? WHERE id=?", (md, ts, tid))
            queue_cmd(conn, "item_update", {"id": tid, "description": md}, coalesce_id=tid)
            conn.execute(
                "INSERT INTO task_local(task_id, body_json) VALUES(?, ?) "
                "ON CONFLICT(task_id) DO UPDATE SET body_json=excluded.body_json",
                (tid, body_json),
            )
            nb_files.mark_dirty(conn, tid)
            nb_files.schedule_flush()
            log_action(f"[{now()}] {tid} «{short}» → notebook body (md {len(md)} ch, json {len(body_json)} ch)")
        elif field == "nb_body_cache":
            # Local cache only (envelope fetched back from the attached file on a fresh DB) —
            # nothing changes on Todoist, no dirty flag.
            conn.execute(
                "INSERT INTO task_local(task_id, body_json) VALUES(?, ?) "
                "ON CONFLICT(task_id) DO UPDATE SET body_json=excluded.body_json",
                (tid, value or ""),
            )
        elif field == "completed":
            conn.execute(
                "UPDATE tasks SET checked=?, completed_at=?, updated_at=? WHERE id=?",
                (1 if value else 0, ts if value else None, ts, tid),
            )
            queue_cmd(conn, "item_complete" if value else "item_uncomplete", {"id": tid})
            log_action(f"[{now()}] {tid} «{short}» → {'✓' if value else '○'}")
        elif field == "priority":
            p = PRIO_UI_TO_TD.get(value, 1)
            conn.execute("UPDATE tasks SET priority=?, updated_at=? WHERE id=?", (p, ts, tid))
            queue_cmd(conn, "item_update", {"id": tid, "priority": p}, coalesce_id=tid)
            log_action(f"[{now()}] {tid} «{short}» → {value}")
        elif field == "due_date":
            # Keep any existing time when the date changes. split_due copes with a
            # time embedded in due_date (the shape Todoist sends), not just due_datetime.
            cur = conn.execute("SELECT due_date, due_datetime FROM tasks WHERE id=?", (tid,)).fetchone()
            _, cur_time = split_due(cur["due_date"], cur["due_datetime"]) if cur else ("", "")
            # A recurrence with an "ending <date>" cap is over once the task moves to a
            # date AFTER that cap: the task becomes a plain dated task (due_string cleared →
            # task_due_obj sends only the date, Todoist drops the repeat). Until 2026-08-17
            # the cap was stripped and the repeat kept — that revived dead recurrences
            # ("every day ending 2026-06-25" moved to August became "every day" forever).
            if value:
                cur_str = conn.execute("SELECT due_string FROM tasks WHERE id=?", (tid,)).fetchone()
                end = recurrence_end_date(cur_str["due_string"]) if cur_str else None
                if end and value > end:
                    conn.execute("UPDATE tasks SET due_string=NULL, due_is_recurring=0 WHERE id=?", (tid,))
                    log_action(f"[{now()}] {tid} «{short}» recurrence ended ({cur_str['due_string']}) → plain date")
            if not value:
                # Clearing the date also drops any recurrence (matches Todoist).
                conn.execute("UPDATE tasks SET due_date=NULL, due_datetime=NULL, "
                             "due_string=NULL, due_is_recurring=0, updated_at=? WHERE id=?", (ts, tid))
            elif cur_time:
                conn.execute("UPDATE tasks SET due_date=NULL, due_datetime=?, updated_at=? WHERE id=?",
                             (f"{value}T{cur_time}:00", ts, tid))
            else:
                conn.execute("UPDATE tasks SET due_date=?, due_datetime=NULL, updated_at=? WHERE id=?", (value, ts, tid))
            queue_cmd(conn, "item_update", {"id": tid, "due": task_due_obj(conn, tid)}, coalesce_id=tid)
            log_action(f"[{now()}] {tid} «{short}» → date {value or '—'}")
        elif field == "due_time":
            cur = conn.execute("SELECT due_date, due_datetime FROM tasks WHERE id=?", (tid,)).fetchone()
            cur_date, _ = split_due(cur["due_date"], cur["due_datetime"]) if cur else ("", "")
            if cur_date and value:
                conn.execute("UPDATE tasks SET due_date=NULL, due_datetime=?, updated_at=? WHERE id=?",
                             (f"{cur_date}T{value}:00", ts, tid))
            elif cur_date and not value:
                conn.execute("UPDATE tasks SET due_date=?, due_datetime=NULL, updated_at=? WHERE id=?", (cur_date, ts, tid))
            queue_cmd(conn, "item_update", {"id": tid, "due": task_due_obj(conn, tid)}, coalesce_id=tid)
            log_action(f"[{now()}] {tid} «{short}» → time {value or '—'}")
        elif field == "due_timezone":
            conn.execute("UPDATE tasks SET due_timezone=?, updated_at=? WHERE id=?",
                         ((value or None), ts, tid))
            queue_cmd(conn, "item_update", {"id": tid, "due": task_due_obj(conn, tid)}, coalesce_id=tid)
            log_action(f"[{now()}] {tid} «{short}» → tz {value or 'floating'}")
        elif field == "due_string":
            # Recurrence. Todoist parses due.string ("every day", "every week", ...)
            # server-side and re-spawns the task on completion. We just store the
            # string + is_recurring flag and send due via item_update; sync fills
            # in the concrete date Todoist computes. Empty string clears recurrence
            # but keeps the current date.
            rec = 1 if value else 0
            conn.execute("UPDATE tasks SET due_string=?, due_is_recurring=?, updated_at=? WHERE id=?",
                         ((value or None), rec, ts, tid))
            queue_cmd(conn, "item_update", {"id": tid, "due": task_due_obj(conn, tid)}, coalesce_id=tid)
            log_action(f"[{now()}] {tid} «{short}» → repeat {value or '—'}")
        elif field == "project":
            pid = lookup_project_id(conn, value)
            if pid:
                conn.execute(
                    "UPDATE tasks SET project_id=?, section_id=NULL, updated_at=? WHERE id=?",
                    (pid, ts, tid),
                )
                queue_cmd(conn, "item_move", {"id": tid, "project_id": pid})
                log_action(f"[{now()}] {tid} «{short}» → project {value}")
        elif field == "section":
            cur = conn.execute("SELECT project_id FROM tasks WHERE id=?", (tid,)).fetchone()
            if cur:
                sid = lookup_section_id(conn, cur["project_id"], value) if value else None
                conn.execute(
                    "UPDATE tasks SET section_id=?, updated_at=? WHERE id=?",
                    (sid, ts, tid),
                )
                # Todoist Sync API: item_move with section_id (or null to remove)
                args = {"id": tid}
                if sid:
                    args["section_id"] = sid
                else:
                    args["project_id"] = cur["project_id"]  # back to project, no section
                queue_cmd(conn, "item_move", args)
                log_action(f"[{now()}] {tid} «{short}» → section {value or '—'}")
        elif field == "chosen_labels":
            conn.execute(
                "UPDATE tasks SET labels_json=?, updated_at=? WHERE id=?",
                (json.dumps(value, ensure_ascii=False), ts, tid),
            )
            queue_cmd(conn, "item_update", {"id": tid, "labels": value}, coalesce_id=tid)
            log_action(f"[{now()}] {tid} «{short}» → labels {','.join(value) or '—'}")
        elif field == "interpretation":
            # local-only (Todoister field, not in Todoist)
            conn.execute(
                "INSERT INTO task_local(task_id, interpretation) VALUES(?, ?) "
                "ON CONFLICT(task_id) DO UPDATE SET interpretation=excluded.interpretation",
                (tid, value),
            )
            log_action(f"[{now()}] {tid} «{short}» → interpretation [local]")
        elif field == "pinned":
            # local-only (Todoister field, not in Todoist)
            conn.execute(
                "INSERT INTO task_local(task_id, pinned) VALUES(?, ?) "
                "ON CONFLICT(task_id) DO UPDATE SET pinned=excluded.pinned",
                (tid, 1 if value else 0),
            )
            log_action(f"[{now()}] {tid} «{short}» → pinned={bool(value)} [local]")
        elif field == "archived":
            conn.execute(
                "INSERT INTO task_local(task_id, archived) VALUES(?, ?) "
                "ON CONFLICT(task_id) DO UPDATE SET archived=excluded.archived",
                (tid, 1 if value else 0),
            )
            log_action(f"[{now()}] {tid} «{short}» → archived={bool(value)} [local]")
        elif field == "sticky":
            # local-only super-priority sticky note (Todoister field, not in Todoist)
            conn.execute(
                "INSERT INTO task_local(task_id, sticky) VALUES(?, ?) "
                "ON CONFLICT(task_id) DO UPDATE SET sticky=excluded.sticky",
                (tid, 1 if value else 0),
            )
            log_action(f"[{now()}] {tid} «{short}» → sticky={bool(value)} [local]")
        elif field == "review_status":
            # local-only
            conn.execute(
                "INSERT INTO task_local(task_id, review_status) VALUES(?, ?) "
                "ON CONFLICT(task_id) DO UPDATE SET review_status=excluded.review_status",
                (tid, value),
            )
            log_action(f"[{now()}] {tid} «{short}» → status {value or '—'} [local]")
        elif field == "deadline_date":
            # Pro feature. Empty value clears.
            v = (value or "").strip() or None
            conn.execute(
                "UPDATE tasks SET deadline_date=?, deadline_lang=?, updated_at=? WHERE id=?",
                (v, "en" if v else None, ts, tid),
            )
            deadline_arg = {"date": v, "lang": "en"} if v else None
            queue_cmd(conn, "item_update", {"id": tid, "deadline": deadline_arg}, coalesce_id=tid)
            log_action(f"[{now()}] {tid} «{short}» → deadline {v or '—'}")
        else:
            return False
        return True


def main():
    if not os.path.exists(DB_PATH):
        print(f"\n❗ DB not found: {DB_PATH}")
        print("Run first: python sync.py init\n")
        sys.exit(1)
    ensure_schema()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"[{now()}] server started → {url}", flush=True)
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
