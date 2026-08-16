# -*- coding: utf-8 -*-
"""
Todoister Sync — Todoist Sync API v1 ↔ SQLite mirror.

Usage:
  python sync.py init      → triage.db schema + initial sync
  python sync.py pull      → incremental sync (delta)
  python sync.py status    → report (how many project/section/task locally)
"""
import os
import sys
import json
import sqlite3
import urllib.request
import urllib.parse
import datetime

# UTF-8 console
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

from paths import DATA_DIR
BASE = DATA_DIR  # writable user data (triage.db, .env)
DB = os.path.join(BASE, "triage.db")

API = "https://api.todoist.com/api/v1/sync"


ENV_PATH = os.path.join(BASE, ".env")


def _load_token():
    """Returns token or empty string if not configured. Does not raise."""
    tok = os.environ.get("TODOIST_TOKEN")
    if tok:
        return tok.strip()
    if os.path.exists(ENV_PATH):
        try:
            with open(ENV_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    if k.strip() == "TODOIST_TOKEN":
                        return v.strip().strip('"').strip("'")
        except Exception as e:
            print(f"[warn] .env read failed: {e}", flush=True)
    return ""


def reload_token():
    """Re-read token from env/.env. Used after onboarding writes a new .env."""
    global TOKEN
    TOKEN = _load_token()
    return TOKEN


def clear_env_token():
    """Remove the TODOIST_TOKEN line from .env and reload (disconnect)."""
    global TOKEN
    if os.path.exists(ENV_PATH):
        lines = []
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("TODOIST_TOKEN"):
                    continue
                lines.append(line)
        with open(ENV_PATH, "w", encoding="utf-8") as f:
            f.writelines(lines)
    os.environ.pop("TODOIST_TOKEN", None)
    TOKEN = ""


def write_env_token(token):
    """Write/overwrite TODOIST_TOKEN in .env file."""
    token = (token or "").strip()
    if not token:
        raise ValueError("token is empty")
    # Read existing .env, replace TODOIST_TOKEN line if present
    lines = []
    found = False
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("TODOIST_TOKEN"):
                    lines.append(f"TODOIST_TOKEN={token}\n")
                    found = True
                else:
                    lines.append(line)
    if not found:
        lines.append(f"TODOIST_TOKEN={token}\n")
    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.writelines(lines)


TOKEN = _load_token()
RESOURCE_TYPES = ["projects", "sections", "items", "labels", "notes", "reminders", "filters", "user"]


# ============ SCHEMA ============

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    color         TEXT,
    parent_id     TEXT,
    is_favorite   INTEGER DEFAULT 0,
    is_inbox      INTEGER DEFAULT 0,
    is_archived   INTEGER DEFAULT 0,
    is_deleted    INTEGER DEFAULT 0,
    view_style    TEXT,
    child_order   INTEGER DEFAULT 0,
    is_collapsed  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sections (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL,
    name          TEXT NOT NULL,
    section_order INTEGER DEFAULT 0,
    is_collapsed  INTEGER DEFAULT 0,
    is_archived   INTEGER DEFAULT 0,
    is_deleted    INTEGER DEFAULT 0,
    added_at      TEXT,
    updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sections_project ON sections(project_id);

CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    section_id      TEXT,
    parent_id       TEXT,
    content         TEXT NOT NULL,
    description     TEXT DEFAULT '',
    priority        INTEGER DEFAULT 1,        -- Todoist: 1=normal … 4=urgent
    labels_json     TEXT DEFAULT '[]',        -- list of label names
    due_date        TEXT,                     -- YYYY-MM-DD (or NULL)
    due_datetime    TEXT,                     -- ISO timestamp (or NULL)
    due_string      TEXT,                     -- natural language: "every Friday"
    due_is_recurring INTEGER DEFAULT 0,
    due_timezone    TEXT,
    due_lang        TEXT,
    deadline_date   TEXT,                     -- Pro feature
    deadline_lang   TEXT,
    duration_amount INTEGER,
    duration_unit   TEXT,
    checked         INTEGER DEFAULT 0,
    is_deleted      INTEGER DEFAULT 0,
    is_collapsed    INTEGER DEFAULT 0,
    added_at        TEXT,
    updated_at      TEXT,
    completed_at    TEXT,
    child_order     INTEGER DEFAULT 0,
    day_order       INTEGER DEFAULT -1,
    note_count      INTEGER DEFAULT 0,
    added_by_uid    TEXT,
    user_id         TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_section ON tasks(section_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent  ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due     ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_checked ON tasks(checked);

CREATE TABLE IF NOT EXISTS labels (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT,
    item_order  INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    is_deleted  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
    id              TEXT PRIMARY KEY,
    task_id         TEXT,                -- = Todoist item_id
    project_id      TEXT,                -- for project-level notes (we mostly use task_id)
    content         TEXT,
    posted_at       TEXT,
    posted_uid      TEXT,
    file_attachment TEXT,                -- JSON
    is_deleted      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);

CREATE TABLE IF NOT EXISTS reminders (
    id               TEXT PRIMARY KEY,
    notify_uid       TEXT,
    item_id          TEXT,                -- = task id
    type             TEXT,                -- "relative" | "absolute" | "location"
    due_date         TEXT,
    due_datetime     TEXT,
    due_string       TEXT,
    due_is_recurring INTEGER DEFAULT 0,
    mm_offset        INTEGER,             -- minutes before due (for relative)
    is_deleted       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reminders_item ON reminders(item_id);

-- Filters (saved query views). Phase 1: local-only (id = local uuid, is_synced=0).
-- Phase 2 will sync up to the Free limit of 3 to Todoist via filter_add/update/delete.
CREATE TABLE IF NOT EXISTS filters (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    query       TEXT NOT NULL DEFAULT '',
    color       TEXT DEFAULT 'charcoal',
    item_order  INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    is_synced   INTEGER DEFAULT 0,           -- 1 = mirrored to Todoist (Phase 2)
    is_deleted  INTEGER DEFAULT 0
);

-- Sync state (key-value)
CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Local-only Todoister fields (not synced to Todoist)
CREATE TABLE IF NOT EXISTS task_local (
    task_id          TEXT PRIMARY KEY,
    interpretation   TEXT DEFAULT '',
    review_status    TEXT DEFAULT '',          -- "" | ok | help | leave
    suggested_label  TEXT DEFAULT ''
);

-- Pending writes queue (for offline / batched push later)
CREATE TABLE IF NOT EXISTS pending_ops (
    uuid         TEXT PRIMARY KEY,
    command_type TEXT NOT NULL,
    args_json    TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    attempts     INTEGER DEFAULT 0,
    last_error   TEXT
);
"""


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with db() as conn:
        conn.executescript(SCHEMA)
    print(f"[init] schema ready → {DB}")


# ============ STATE HELPERS ============

def get_state(conn, key, default=None):
    row = conn.execute("SELECT value FROM sync_state WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_state(conn, key, value):
    conn.execute(
        "INSERT INTO sync_state(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


# ============ API CALL ============

def call_sync(sync_token="*", resource_types=None, commands=None):
    if not TOKEN:
        raise RuntimeError("TODOIST_TOKEN not configured — run onboarding first")
    payload = {"sync_token": sync_token, "resource_types": json.dumps(resource_types or RESOURCE_TYPES)}
    if commands:
        payload["commands"] = json.dumps(commands)
    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(API, data=data, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


COMPLETED_API = "https://api.todoist.com/api/v1/tasks/completed/by_completion_date"

def fetch_completed(since, until, cursor=None, limit=50):
    """Fetch completed tasks in the [since, until] window (ISO datetimes; the API
    caps the range at 3 months). Returns {"items": [...], "next_cursor": str|None}.
    Used by the Reporting view — these tasks are not part of the regular sync."""
    if not TOKEN:
        raise RuntimeError("TODOIST_TOKEN not configured — run onboarding first")
    params = {"since": since, "until": until, "limit": limit}
    if cursor:
        params["cursor"] = cursor
    url = COMPLETED_API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


# ============ UPSERT ============

def b(x):
    return 1 if x else 0


def upsert_project(conn, p):
    conn.execute(
        """INSERT INTO projects(id,name,color,parent_id,is_favorite,is_inbox,is_archived,
           is_deleted,view_style,child_order,is_collapsed)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, color=excluded.color, parent_id=excluded.parent_id,
             is_favorite=excluded.is_favorite, is_inbox=excluded.is_inbox,
             is_archived=excluded.is_archived, is_deleted=excluded.is_deleted,
             view_style=excluded.view_style, child_order=excluded.child_order,
             is_collapsed=excluded.is_collapsed""",
        (
            p["id"], p.get("name", ""), p.get("color"), p.get("parent_id"),
            b(p.get("is_favorite")), b(p.get("inbox_project") or p.get("is_inbox_project")),
            b(p.get("is_archived")), b(p.get("is_deleted")),
            p.get("view_style"), p.get("child_order", 0), b(p.get("is_collapsed")),
        ),
    )


def upsert_section(conn, s):
    conn.execute(
        """INSERT INTO sections(id,project_id,name,section_order,is_collapsed,is_archived,is_deleted,added_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             project_id=excluded.project_id, name=excluded.name,
             section_order=excluded.section_order, is_collapsed=excluded.is_collapsed,
             is_archived=excluded.is_archived, is_deleted=excluded.is_deleted,
             updated_at=excluded.updated_at""",
        (
            s["id"], s["project_id"], s.get("name", ""),
            s.get("section_order", 0), b(s.get("is_collapsed")),
            b(s.get("is_archived")), b(s.get("is_deleted")),
            s.get("added_at"), s.get("updated_at"),
        ),
    )


NOTEBOOK_PROJECT_NAME = "Notebook"   # mirrored in js NOTEBOOK_PROJECT / store.NOTEBOOK_PROJECT_NAME


def _flag_remote_delete(conn, t):
    """Todoist reports a task deleted that is still live locally (deleted from the phone /
    web, not from Todoister). For Notebook pages remember it in task_local
    (remote_deleted_at + the comment ids that were live at that moment) so the app can
    offer "restore" or "discard the local copy" — the page body stays in
    task_local.body_json until the user decides. Runs BEFORE the upsert, while the local
    row still says is_deleted=0. Anything else (normal tasks, already-deleted rows) → no-op."""
    if not t.get("is_deleted"):
        return
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (t["id"],)).fetchone()
        if not row or row["is_deleted"] or row["parent_id"]:
            return
        pr = conn.execute("SELECT name FROM projects WHERE id=?", (row["project_id"],)).fetchone()
        if not pr or (pr["name"] or "") != NOTEBOOK_PROJECT_NAME:
            return
        live = [c["id"] for c in conn.execute(
            "SELECT id FROM comments WHERE task_id=? AND is_deleted=0", (t["id"],)
        ).fetchall()]
        stamp = datetime.datetime.now().isoformat(timespec="seconds")
        # Todoist sends a deleted item as a stub (empty content, placeholder project_id) and
        # the upsert below overwrites the row with it — keep a snapshot of the real row.
        snap = json.dumps(dict(row), ensure_ascii=False)
        conn.execute(
            "INSERT INTO task_local(task_id, remote_deleted_at, remote_deleted_comments, remote_deleted_task) "
            "VALUES(?,?,?,?) "
            "ON CONFLICT(task_id) DO UPDATE SET remote_deleted_at=excluded.remote_deleted_at, "
            "remote_deleted_comments=excluded.remote_deleted_comments, "
            "remote_deleted_task=excluded.remote_deleted_task",
            (t["id"], stamp, json.dumps(live), snap),
        )
        print(f"[sync] notebook page deleted on Todoist: {t['id']} — kept locally for restore/discard")
    except sqlite3.OperationalError:
        pass   # columns not migrated yet (store.ensure_schema runs at app start)


def upsert_task(conn, t):
    _flag_remote_delete(conn, t)
    due = t.get("due") or {}
    deadline = t.get("deadline") or {}
    duration = t.get("duration") or {}
    conn.execute(
        """INSERT INTO tasks(id,project_id,section_id,parent_id,content,description,
            priority,labels_json,due_date,due_datetime,due_string,due_is_recurring,
            due_timezone,due_lang,deadline_date,deadline_lang,duration_amount,duration_unit,
            checked,is_deleted,is_collapsed,added_at,updated_at,completed_at,
            child_order,day_order,note_count,added_by_uid,user_id)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             project_id=excluded.project_id, section_id=excluded.section_id,
             parent_id=excluded.parent_id, content=excluded.content,
             description=excluded.description, priority=excluded.priority,
             labels_json=excluded.labels_json,
             due_date=excluded.due_date, due_datetime=excluded.due_datetime,
             due_string=excluded.due_string, due_is_recurring=excluded.due_is_recurring,
             due_timezone=excluded.due_timezone, due_lang=excluded.due_lang,
             deadline_date=excluded.deadline_date, deadline_lang=excluded.deadline_lang,
             duration_amount=excluded.duration_amount, duration_unit=excluded.duration_unit,
             checked=excluded.checked, is_deleted=excluded.is_deleted,
             is_collapsed=excluded.is_collapsed,
             updated_at=excluded.updated_at, completed_at=excluded.completed_at,
             child_order=excluded.child_order, day_order=excluded.day_order,
             note_count=excluded.note_count""",
        (
            t["id"], t["project_id"], t.get("section_id"), t.get("parent_id"),
            t.get("content", ""), t.get("description", ""),
            int(t.get("priority", 1)),
            json.dumps(t.get("labels", []), ensure_ascii=False),
            due.get("date"), due.get("datetime"), due.get("string"),
            b(due.get("is_recurring")), due.get("timezone"), due.get("lang"),
            deadline.get("date") if isinstance(deadline, dict) else None,
            deadline.get("lang") if isinstance(deadline, dict) else None,
            duration.get("amount") if isinstance(duration, dict) else None,
            duration.get("unit") if isinstance(duration, dict) else None,
            b(t.get("checked")), b(t.get("is_deleted")), b(t.get("is_collapsed")),
            t.get("added_at"), t.get("updated_at"), t.get("completed_at"),
            t.get("child_order", 0), t.get("day_order", -1), t.get("note_count", 0),
            t.get("added_by_uid"), t.get("user_id"),
        ),
    )


def upsert_label(conn, l):
    conn.execute(
        """INSERT INTO labels(id,name,color,item_order,is_favorite,is_deleted)
           VALUES(?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, color=excluded.color,
             item_order=excluded.item_order, is_favorite=excluded.is_favorite,
             is_deleted=excluded.is_deleted""",
        (
            l["id"], l.get("name", ""), l.get("color"),
            l.get("item_order", 0), b(l.get("is_favorite")), b(l.get("is_deleted")),
        ),
    )


def upsert_comment(conn, n):
    att = n.get("file_attachment")
    conn.execute(
        """INSERT INTO comments(id,task_id,project_id,content,posted_at,posted_uid,file_attachment,is_deleted)
           VALUES(?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             task_id=excluded.task_id, project_id=excluded.project_id,
             content=excluded.content, posted_at=excluded.posted_at,
             posted_uid=excluded.posted_uid, file_attachment=excluded.file_attachment,
             is_deleted=excluded.is_deleted""",
        (
            n["id"], n.get("item_id"), n.get("project_id"),
            n.get("content", ""), n.get("posted_at"), n.get("posted_uid"),
            json.dumps(att, ensure_ascii=False) if att else None,
            b(n.get("is_deleted")),
        ),
    )


def upsert_reminder(conn, rem):
    due = rem.get("due") or {}
    conn.execute(
        """INSERT INTO reminders(id,notify_uid,item_id,type,due_date,due_datetime,
            due_string,due_is_recurring,mm_offset,is_deleted)
           VALUES(?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             notify_uid=excluded.notify_uid, item_id=excluded.item_id,
             type=excluded.type, due_date=excluded.due_date,
             due_datetime=excluded.due_datetime, due_string=excluded.due_string,
             due_is_recurring=excluded.due_is_recurring,
             mm_offset=excluded.mm_offset, is_deleted=excluded.is_deleted""",
        (
            rem["id"], rem.get("notify_uid"), rem.get("item_id"),
            rem.get("type"),
            due.get("date"), due.get("datetime"), due.get("string"),
            b(due.get("is_recurring")),
            rem.get("mm_offset"),
            b(rem.get("is_deleted")),
        ),
    )


def upsert_filter(conn, f):
    """Upsert a Todoist-synced filter. Pulled filters are flagged is_synced=1."""
    conn.execute(
        """INSERT INTO filters(id,name,query,color,item_order,is_favorite,is_synced,is_deleted)
           VALUES(?,?,?,?,?,?,1,?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, query=excluded.query, color=excluded.color,
             item_order=excluded.item_order, is_favorite=excluded.is_favorite,
             is_synced=1, is_deleted=excluded.is_deleted""",
        (
            f["id"], f.get("name") or "", f.get("query") or "",
            f.get("color") or "charcoal", f.get("item_order") or 0,
            b(f.get("is_favorite")), b(f.get("is_deleted")),
        ),
    )


# ============ USER (account) ============

# Fields we keep from the Todoist `user` object for the account avatar/panel.
USER_FIELDS = ("id", "full_name", "email", "image_id",
               "avatar_big", "avatar_medium", "avatar_small")


def store_user(conn, user):
    """Cache the account's user object (name/email/avatar) into sync_state as JSON."""
    if not user:
        return
    keep = {k: user.get(k) for k in USER_FIELDS}
    set_state(conn, "user_json", json.dumps(keep))


def fetch_filters():
    """One-shot fetch of the account's filters (for the initial backfill of filters
    that existed before we started syncing them). Discards the returned sync_token."""
    try:
        resp = call_sync(sync_token="*", resource_types=["filters"])
        return resp.get("filters") or []
    except Exception as e:
        print(f"[warn] fetch_filters failed: {e}", flush=True)
        return []


def fetch_user():
    """One-shot fetch of the account's user object.

    Uses sync_token="*" with only the `user` resource. The returned sync_token
    is intentionally discarded so the main incremental sync token is untouched.
    Returns the user dict, or None on any failure."""
    try:
        resp = call_sync(sync_token="*", resource_types=["user"])
        return resp.get("user")
    except Exception as e:
        print(f"[warn] fetch_user failed: {e}", flush=True)
        return None


# ============ SYNC FLOWS ============

def apply_resp(conn, resp):
    counts = {"projects": 0, "sections": 0, "tasks": 0, "labels": 0, "comments": 0, "reminders": 0}
    for p in resp.get("projects", []) or []:
        upsert_project(conn, p); counts["projects"] += 1
    for s in resp.get("sections", []) or []:
        upsert_section(conn, s); counts["sections"] += 1
    for t in resp.get("items", []) or []:
        upsert_task(conn, t); counts["tasks"] += 1
    for l in resp.get("labels", []) or []:
        upsert_label(conn, l); counts["labels"] += 1
    for n in resp.get("notes", []) or []:
        upsert_comment(conn, n); counts["comments"] += 1
    for r in resp.get("reminders", []) or []:
        upsert_reminder(conn, r); counts["reminders"] += 1
    for f in resp.get("filters", []) or []:
        upsert_filter(conn, f)
    if resp.get("user"):
        store_user(conn, resp["user"])
    set_state(conn, "sync_token", resp.get("sync_token", ""))
    set_state(conn, "last_sync_at", datetime.datetime.now().isoformat(timespec="seconds"))
    set_state(conn, "last_full_sync", "1" if resp.get("full_sync") else "0")
    return counts


def initial_sync():
    print("[sync] initial full pull started…")
    resp = call_sync(sync_token="*")
    if not resp.get("full_sync"):
        print("[warn] expected full_sync=true; got:", resp.get("full_sync"))
    with db() as conn:
        counts = apply_resp(conn, resp)
    print(f"[sync] OK — projects:{counts['projects']} sections:{counts['sections']} "
          f"tasks:{counts['tasks']} labels:{counts['labels']} comments:{counts['comments']} reminders:{counts['reminders']}")
    return counts


def _set_error_state(kind, err):
    """Write last_<kind>_error + ts to sync_state. Empty err clears it."""
    with db() as conn:
        if err:
            set_state(conn, f"last_{kind}_error", str(err)[:300])
            set_state(conn, f"last_{kind}_error_at", datetime.datetime.now().isoformat(timespec="seconds"))
        else:
            set_state(conn, f"last_{kind}_error", "")
            set_state(conn, f"last_{kind}_error_at", "")
        conn.commit()


def incremental_sync(quiet=False):
    with db() as conn:
        tok = get_state(conn, "sync_token", "*")
    if not quiet:
        print(f"[sync] incremental ({tok[:16]}…)")
    try:
        resp = call_sync(sync_token=tok)
    except Exception as e:
        _set_error_state("pull", e)
        if not quiet:
            print(f"[sync] ERROR pull: {e}")
        raise
    with db() as conn:
        counts = apply_resp(conn, resp)
    _set_error_state("pull", "")
    total = sum(counts.values())
    if not quiet or total > 0:
        print(f"[sync] delta — projects:{counts['projects']} sections:{counts['sections']} "
              f"tasks:{counts['tasks']} labels:{counts['labels']} comments:{counts['comments']} reminders:{counts['reminders']}")
    return counts


# ============ PUSH (Phase 4) ============

def fetch_pending(conn, limit=100):
    return conn.execute(
        "SELECT uuid, command_type, args_json FROM pending_ops "
        "ORDER BY created_at LIMIT ?", (limit,)
    ).fetchall()


def build_commands(rows):
    """Convert pending_ops rows → Sync API command dicts."""
    commands = []
    for r in rows:
        args = json.loads(r["args_json"])
        temp_id = args.pop("temp_id", None)  # was stored inside args
        cmd = {"type": r["command_type"], "uuid": r["uuid"], "args": args}
        if temp_id:
            cmd["temp_id"] = temp_id
        commands.append(cmd)
    return commands


def apply_temp_id_mapping(conn, mapping):
    """Replace local UUIDs with real Todoist IDs everywhere."""
    if not mapping:
        return 0
    for temp_id, real_id in mapping.items():
        # tasks
        conn.execute("UPDATE tasks SET id=? WHERE id=?", (real_id, temp_id))
        conn.execute("UPDATE tasks SET parent_id=? WHERE parent_id=?", (real_id, temp_id))
        conn.execute("UPDATE tasks SET section_id=? WHERE section_id=?", (real_id, temp_id))
        # sections
        conn.execute("UPDATE sections SET id=? WHERE id=?", (real_id, temp_id))
        # projects
        conn.execute("UPDATE projects SET id=? WHERE id=?", (real_id, temp_id))
        conn.execute("UPDATE tasks SET project_id=? WHERE project_id=?", (real_id, temp_id))
        conn.execute("UPDATE sections SET project_id=? WHERE project_id=?", (real_id, temp_id))
        # task_local
        conn.execute("UPDATE task_local SET task_id=? WHERE task_id=?", (real_id, temp_id))
        # filters (local uuid -> real Todoist id once a synced filter is pushed)
        try:
            conn.execute("UPDATE filters SET id=? WHERE id=?", (real_id, temp_id))
        except sqlite3.OperationalError:
            pass
        # comments
        try:
            conn.execute("UPDATE comments SET id=? WHERE id=?", (real_id, temp_id))
            conn.execute("UPDATE comments SET task_id=? WHERE task_id=?", (real_id, temp_id))
        except sqlite3.OperationalError:
            pass
        # reminders
        try:
            conn.execute("UPDATE reminders SET id=? WHERE id=?", (real_id, temp_id))
            conn.execute("UPDATE reminders SET item_id=? WHERE item_id=?", (real_id, temp_id))
        except sqlite3.OperationalError:
            pass
        # any other pending commands that reference this temp_id (e.g. follow-up update)
        rows = conn.execute(
            "SELECT uuid, args_json FROM pending_ops WHERE args_json LIKE ?",
            (f'%"{temp_id}"%',)
        ).fetchall()
        for r in rows:
            new_json = r["args_json"].replace(f'"{temp_id}"', f'"{real_id}"')
            conn.execute(
                "UPDATE pending_ops SET args_json=? WHERE uuid=?",
                (new_json, r["uuid"])
            )
    return len(mapping)


def apply_sync_status(conn, status, rows):
    """Per-command: delete 'ok', mark errors (keep in queue)."""
    pushed = 0
    failed = 0
    for r in rows:
        st = status.get(r["uuid"])
        if st == "ok":
            conn.execute("DELETE FROM pending_ops WHERE uuid=?", (r["uuid"],))
            pushed += 1
        elif isinstance(st, dict):
            err = st.get("error", str(st))[:200]
            conn.execute(
                "UPDATE pending_ops SET attempts=attempts+1, last_error=? WHERE uuid=?",
                (err, r["uuid"])
            )
            failed += 1
        # if status missing → unknown, leave alone (will retry)
    return pushed, failed


def push_queue(verbose=True, quiet=False):
    if not os.path.exists(DB):
        print(f"[push] DB not found: {DB}")
        return
    total_pushed = 0
    total_failed = 0
    rounds = 0
    while True:
        rounds += 1
        with db() as conn:
            rows = fetch_pending(conn, limit=100)
            if not rows:
                break
            commands = build_commands(rows)
            tok = get_state(conn, "sync_token", "*")

        if not quiet:
            print(f"[push #{rounds}] sending {len(commands)} command(s)…")
        if verbose and not quiet:
            for c in commands[:5]:
                args_preview = json.dumps(c.get("args", {}), ensure_ascii=False)[:80]
                tid = f" temp_id={c['temp_id'][:8]}…" if c.get("temp_id") else ""
                print(f"   - {c['type']:<20}{tid} {args_preview}")
            if len(commands) > 5:
                print(f"   … +{len(commands)-5} more")

        try:
            resp = call_sync(sync_token=tok, commands=commands)
        except Exception as e:
            print(f"[push] ERROR network/API: {e}")
            _set_error_state("push", e)
            return

        with db() as conn:
            n_map = apply_temp_id_mapping(conn, resp.get("temp_id_mapping", {}))
            ok, fail = apply_sync_status(conn, resp.get("sync_status", {}), rows)
            # Pull-side: server returned changed items along with our response
            counts = apply_resp(conn, resp)
            conn.commit()
        _set_error_state("push", "")

        total_pushed += ok
        total_failed += fail
        if not quiet:
            print(f"[push] ok:{ok} failed:{fail} mapping:{n_map} pull-delta:"
                  f"P{counts['projects']}/S{counts['sections']}/T{counts['tasks']}/L{counts['labels']}/C{counts['comments']}/R{counts['reminders']}")

        if fail > 0:
            print(f"[push] ⚠ {fail} command(s) failed — check pending_ops.last_error; loop stops")
            break
        if ok == 0:
            if not quiet:
                print(f"[push] ⚠ 0 commands acknowledged — silent error; break")
            break

    if not quiet or total_pushed > 0 or total_failed > 0:
        print(f"[push] TOTAL: pushed:{total_pushed} failed:{total_failed} rounds:{rounds-1}")


def show_queue():
    if not os.path.exists(DB):
        print(f"[queue] DB not found")
        return
    with db() as conn:
        rows = conn.execute(
            "SELECT command_type, args_json, created_at, attempts, last_error "
            "FROM pending_ops ORDER BY created_at"
        ).fetchall()
        if not rows:
            print("Queue: empty ✓")
            return
        print(f"Queue: {len(rows)} command(s)")
        for r in rows:
            ar = r["args_json"][:80]
            err = f"   [err×{r['attempts']}: {r['last_error']}]" if r["last_error"] else ""
            print(f"  {(r['created_at'] or '?')[11:19]} {r['command_type']:<18} {ar}{err}")


# ============ STATUS ============

def status():
    if not os.path.exists(DB):
        print(f"[status] DB not found ({DB}). Run: python sync.py init")
        return
    with db() as conn:
        p  = conn.execute("SELECT COUNT(*) c FROM projects WHERE is_deleted=0").fetchone()["c"]
        s  = conn.execute("SELECT COUNT(*) c FROM sections WHERE is_deleted=0").fetchone()["c"]
        t  = conn.execute("SELECT COUNT(*) c FROM tasks WHERE is_deleted=0 AND checked=0").fetchone()["c"]
        tc = conn.execute("SELECT COUNT(*) c FROM tasks WHERE checked=1").fetchone()["c"]
        l  = conn.execute("SELECT COUNT(*) c FROM labels WHERE is_deleted=0").fetchone()["c"]
        tok = get_state(conn, "sync_token", "(none)")
        last = get_state(conn, "last_sync_at", "(never)")

        print(f"DB:           {DB}")
        print(f"Last sync:    {last}")
        print(f"Sync token:   {tok[:20]}…")
        print(f"")
        print(f"Projects:     {p}")
        print(f"Sections:     {s}")
        print(f"Tasks:        {t} active, {tc} completed")
        print(f"Labels:       {l}")
        print(f"")
        print("Projects breakdown:")
        for row in conn.execute(
            "SELECT p.name, COUNT(t.id) cnt FROM projects p "
            "LEFT JOIN tasks t ON t.project_id=p.id AND t.is_deleted=0 AND t.checked=0 "
            "WHERE p.is_deleted=0 GROUP BY p.id ORDER BY p.child_order, p.name"
        ):
            print(f"  {row['name']:<40} {row['cnt']:>4}")


# ============ MAIN ============

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "init":
        init_db()
        initial_sync()
        print()
        status()
    elif cmd == "pull":
        if not os.path.exists(DB):
            print("DB not found — run first: python sync.py init")
            sys.exit(1)
        incremental_sync()
        print()
        status()
    elif cmd == "push":
        if not os.path.exists(DB):
            print("DB not found — run first: python sync.py init")
            sys.exit(1)
        push_queue()
    elif cmd == "queue":
        show_queue()
    elif cmd == "status":
        status()
    elif cmd == "schema":
        init_db()
    else:
        print(f"Unknown command: {cmd}")
        print("Usage: python sync.py {init|pull|push|queue|status|schema}")
        sys.exit(2)


if __name__ == "__main__":
    main()
