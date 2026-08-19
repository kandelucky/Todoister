"""
apikeys.py — access control for Todoister's local HTTP server (Package B, 2026-08-18,
Kiki's letter №2 §5, Lasha's yes).

Before: the server listened on 127.0.0.1 only, and that was all — no token, the agent name was
self-declared, every endpoint (read every task / comment / attachment, task_delete, update, the
agent endpoints) was open to ANY process on this PC. Honest limit that stays: a local process
running with the user's rights can read this DB and the key files — no app can wall itself off
from that. What this module does stop: accidental / self-declared access, browser pages
(SameSite=Strict cookie), and it is the precondition for any tunnel / web-agent talk later.

Model
  - table api_keys (name, key, scope, created_at, last_used_at). Scopes: `full` (everything) and
    `panel` (agent-panel only: read state / attachments, poll, propose, done, take — no direct
    task writes).
  - `app` key: made fresh at every app start by app.py (scope full, no file); the window opens
    `http://localhost:PORT/?t=<key>` → the server answers with a Set-Cookie (HttpOnly,
    SameSite=Strict, Path=/) and from then on every fetch / <img> of the UI carries it — the 20+
    fetch sites in the UI stay untouched.
  - agent keys: made in the app (panel header → key dialog) or by migration for the already known
    agent (setting agent_name → scope full). Each is written to DATA_DIR/agent-keys/<name>.key
    (user-readable, never in git) so the agent reads it from there; sent as
    `Authorization: Bearer <key>` (or `?token=`). The key proves the name: agent_panel takes the
    identity from the key, not from the self-declared `agent` param.
  - Open without a key: `/favicon.ico`, `/oauth/callback` (Google's loopback redirect — has its
    own `state` check). Entry pages `/`, `/index.html`, `/onboarding` without a valid key answer
    a small "open Todoister from the app" page (200, no data).
  - 401 = no / unknown key; 403 = key without the scope for that path.

Hooks: store.ensure_schema → ensure_schema(conn); server.Handler.do_GET/do_POST → authorize()
first thing; app.py → new_app_key() before opening the window; agent_panel reads
params["_agent"] / body["_agent"] (set by the server from the key's name).
"""
import datetime
import json
import os
import secrets
import time
from http import cookies as _cookies

from paths import DATA_DIR

KEYS_DIR = os.path.join(DATA_DIR, "agent-keys")
SCOPES = ("full", "panel")
COOKIE = "todoister_key"
APP_KEY_NAME = "app"
OPEN_PATHS = {"/favicon.ico", "/oauth/callback"}
ENTRY_PATHS = {"/", "/index.html", "/onboarding"}
# scope `panel` — what an agent that only speaks to the panel may touch
PANEL_GET = {"/api/state", "/api/agent_queue", "/api/attachment", "/api/completed"}
PANEL_POST = {"/api/agent_propose", "/api/agent_done", "/api/agent_take"}
_LAST_USED_EVERY = 60          # seconds between last_used_at writes per key (a poll every 20 s must not write each time)
_last_used_mem = {}
_mem_app_key = ""              # first run (no DB yet): the app key lives here until /api/init creates the DB
DEV_KEY = (os.environ.get("TODOISTER_DEV_KEY") or "").strip()   # dev / test servers only: a full key set by the process itself


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _log(line):
    try:
        from store import log_action     # lazy: store imports this module
        log_action(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] keys: {line}")
    except Exception:
        pass


# ---------------------------------------------------------------- schema + migration
def ensure_schema(conn):
    """Idempotent. Called from store.ensure_schema()."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS api_keys (
            name         TEXT PRIMARY KEY,
            key          TEXT NOT NULL UNIQUE,
            scope        TEXT NOT NULL DEFAULT 'full',    -- full | panel
            created_at   TEXT,
            last_used_at TEXT
        )
    """)
    global _mem_app_key
    if _mem_app_key:
        # the DB was just created (first run) — persist the window's key so its cookie keeps working
        conn.execute(
            "INSERT INTO api_keys(name, key, scope, created_at) VALUES(?,?,?,?) "
            "ON CONFLICT(name) DO UPDATE SET key=excluded.key, scope=excluded.scope, created_at=excluded.created_at",
            (APP_KEY_NAME, _mem_app_key, "full", _now()),
        )
    # migration (once): the agent that already talks to the panel gets a `full` key + file, so it
    # only has to read the file after this restart (no copy-paste for Lasha)
    row = conn.execute("SELECT value FROM app_settings WHERE key='agent_name'").fetchone()
    known = (row["value"] if row and row["value"] else "").strip()
    if known and known != APP_KEY_NAME and not conn.execute(
        "SELECT 1 FROM api_keys WHERE name=?", (known,)
    ).fetchone():
        make_key(conn, known, "full")
        _log(f"migration: key for known agent '{known}' created → {key_file(known)}")


# ---------------------------------------------------------------- keys
def key_file(name):
    return os.path.join(KEYS_DIR, f"{name}.key")


def _safe_name(name):
    name = (name or "").strip()
    return name if name and len(name) <= 32 and all(c.isalnum() or c in "-_." for c in name) else ""


def make_key(conn, name, scope="full", write_file=True):
    """Create or replace (= rotate) the key of `name`. Returns the plain key. Agent keys are also
    written to DATA_DIR/agent-keys/<name>.key (user-readable file — the agent reads it there)."""
    name = _safe_name(name)
    if not name:
        raise ValueError("bad key name")
    if scope not in SCOPES:
        scope = "full"
    key = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO api_keys(name, key, scope, created_at, last_used_at) VALUES(?,?,?,?,NULL) "
        "ON CONFLICT(name) DO UPDATE SET key=excluded.key, scope=excluded.scope, "
        "created_at=excluded.created_at, last_used_at=NULL",
        (name, key, scope, _now()),
    )
    _last_used_mem.pop(name, None)
    if write_file and name != APP_KEY_NAME:
        try:
            os.makedirs(KEYS_DIR, exist_ok=True)
            with open(key_file(name), "w", encoding="utf-8") as f:
                f.write(key + "\n")
        except Exception as e:
            _log(f"could not write {key_file(name)}: {e}")
    return key


def revoke_key(conn, name):
    name = _safe_name(name)
    if not name or name == APP_KEY_NAME:
        return False
    n = conn.execute("DELETE FROM api_keys WHERE name=?", (name,)).rowcount
    _last_used_mem.pop(name, None)
    try:
        if os.path.exists(key_file(name)):
            os.remove(key_file(name))
    except Exception as e:
        _log(f"could not remove {key_file(name)}: {e}")
    return n > 0


def list_keys(conn):
    """For the app's key dialog: never the key itself — name, scope, dates, where the file is."""
    out = []
    for r in conn.execute(
        "SELECT name, scope, created_at, last_used_at FROM api_keys WHERE name!=? ORDER BY created_at",
        (APP_KEY_NAME,),
    ).fetchall():
        out.append({"name": r["name"], "scope": r["scope"], "created_at": r["created_at"] or "",
                    "last_used_at": r["last_used_at"] or "", "file": key_file(r["name"]),
                    "file_exists": os.path.exists(key_file(r["name"]))})
    return out


def read_key(name):
    """The plain key from the file (for the dialog's copy button). '' when the file is gone."""
    try:
        with open(key_file(_safe_name(name)), encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def new_app_key(conn):
    """app.py, every start: a fresh key for the window itself (scope full, no file). conn=None on
    the very first run (no DB yet) → kept in memory; ensure_schema() persists it once the DB exists."""
    global _mem_app_key
    if conn is None:
        _mem_app_key = secrets.token_urlsafe(32)
        return _mem_app_key
    _mem_app_key = ""
    return make_key(conn, APP_KEY_NAME, "full", write_file=False)


# ---------------------------------------------------------------- request → identity
def _touch(conn, name):
    if conn is None:
        return
    t = time.time()
    if t - _last_used_mem.get(name, 0) < _LAST_USED_EVERY:
        return
    _last_used_mem[name] = t
    try:
        conn.execute("UPDATE api_keys SET last_used_at=? WHERE name=?", (_now(), name))
    except Exception:
        pass


def _lookup(conn, key):
    if not key:
        return None
    if _mem_app_key and key == _mem_app_key:
        return {"name": APP_KEY_NAME, "scope": "full"}
    if DEV_KEY and key == DEV_KEY:
        return {"name": "dev", "scope": "full"}
    if conn is None:
        return None
    r = conn.execute("SELECT name, scope FROM api_keys WHERE key=?", (key,)).fetchone()
    return {"name": r["name"], "scope": r["scope"]} if r else None


def identify(conn, headers, query):
    """Bearer header → ?token= → cookie. Returns {name, scope, via} or None."""
    auth = (headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        ident = _lookup(conn, auth[7:].strip())
        if ident:
            ident["via"] = "bearer"
            _touch(conn, ident["name"])
            return ident
        return None
    tok = (query.get("token") or [""])[0].strip()
    if tok:
        ident = _lookup(conn, tok)
        if ident:
            ident["via"] = "query"
            _touch(conn, ident["name"])
            return ident
        return None
    raw = headers.get("Cookie") or ""
    if raw:
        try:
            c = _cookies.SimpleCookie()
            c.load(raw)
            if COOKIE in c:
                ident = _lookup(conn, c[COOKIE].value)
                if ident:
                    ident["via"] = "cookie"
                    _touch(conn, ident["name"])
                    return ident
        except Exception:
            pass
    return None


def entry_key(conn, query):
    """`/?t=<key>` on an entry page → identity to be set as the cookie (or None)."""
    t = (query.get("t") or [""])[0].strip()
    ident = _lookup(conn, t) if t else None
    if ident:
        ident["via"] = "entry"
        ident["key"] = t
    return ident


def allowed(ident, method, path):
    if not ident:
        return False
    if ident["scope"] == "full":
        return True
    if ident["scope"] == "panel":
        return path in (PANEL_GET if method == "GET" else PANEL_POST)
    return False


def cookie_header(key):
    # HttpOnly: page scripts don't need it (the browser sends it by itself); SameSite=Strict:
    # a page on another site cannot make the browser send it — the real gain against web pages.
    return f"{COOKIE}={key}; Path=/; HttpOnly; SameSite=Strict"


def is_agent(ident):
    """An identity that came through an agent key (not the app's own window)."""
    return bool(ident) and ident.get("name") != APP_KEY_NAME and ident.get("via") in ("bearer", "query")


ENTRY_PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Todoister</title>
<style>body{margin:0;background:#1e1e1e;color:#ddd;font:16px/1.5 Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
div{max-width:520px;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 12px}p{margin:0;color:#aaa}</style></head>
<body><div><h1>Todoister</h1><p>გახსენით ტოდოისტერი აპიდან — ეს მისამართი გასაღების გარეშე არ იხსნება.</p>
<p>Open Todoister from the app — this address needs the app's key.</p></div></body></html>"""
