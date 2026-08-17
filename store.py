# -*- coding: utf-8 -*-
"""
Todoister — shared config, SQLite access, state building and the Todoist
command queue. Split out of server.py 2026-07-08 (mechanical move, no
behavior change). server.py re-exports these names, so app.py and older
call sites keep working unchanged.
"""
import json
import os
import re
import sqlite3
import datetime
import threading
import uuid

import sync as sync_mod
import agent_panel
# Access via sync_mod.TOKEN so reload_token() takes effect at runtime

from paths import RES_DIR, DATA_DIR
BASE = RES_DIR                                     # bundled read-only resources
DB_PATH = os.path.join(DATA_DIR, "triage.db")      # writable user data
ONBOARDING_HTML = os.path.join(BASE, "onboarding.html")
LOG = os.path.join(DATA_DIR, "triage.log")         # writable user data
HTML = os.path.join(BASE, "index.html")
PORT = 8765
SYNC_INTERVAL = 30  # seconds between background sync rounds (shown in the sync panel)
FILTER_SYNC_LIMIT = 3  # Todoist Free tier: max 3 filters mirrored to the account
_lock = threading.Lock()
NB_PAGE_FILE_NAME = "Todoister-page.json"   # mirrored in nb_files.NB_FILE_NAME (store must not import it)
NOTEBOOK_PROJECT_NAME = sync_mod.NOTEBOOK_PROJECT_NAME   # "Notebook" — recognised by exact name

# Todoist avatar CDN (public images, no auth needed).
AVATAR_CDN = "https://dcff1xvirvpfp.cloudfront.net"
# Where the user copies their API token (opened in the system browser from onboarding).
TODOIST_DEV_URL = "https://app.todoist.com/app/settings/integrations/developer"
# "Tips and tricks for creating filters" link (English help article).
FILTERS_HELP_URL = "https://www.todoist.com/help/articles/introduction-to-filters-V98wIH"
TZ_HELP_URL = "https://www.todoist.com/help"

PRIO_TD_TO_UI = {4: "P1", 3: "P2", 2: "P3", 1: "P4"}
PRIO_UI_TO_TD = {"P1": 4, "P2": 3, "P3": 2, "P4": 1}


def now():
    return datetime.datetime.now().strftime("%H:%M:%S")


def build_account(user_json):
    """Turn the cached user JSON into the account shape the sidebar avatar uses.
    Returns {name, email, avatar_url} — avatar_url is "" when no picture is set."""
    if not user_json:
        return {"name": "", "email": "", "avatar_url": ""}
    try:
        u = json.loads(user_json)
    except Exception:
        return {"name": "", "email": "", "avatar_url": ""}
    avatar = u.get("avatar_big") or ""
    if not avatar and u.get("image_id"):
        avatar = f"{AVATAR_CDN}/{u['image_id']}_big.jpg"
    return {
        "name": u.get("full_name") or "",
        "email": u.get("email") or "",
        "avatar_url": avatar,
    }


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema():
    """Idempotent migrations for existing DBs."""
    with db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS comments (
                id              TEXT PRIMARY KEY,
                task_id         TEXT,
                project_id      TEXT,
                content         TEXT,
                posted_at       TEXT,
                posted_uid      TEXT,
                file_attachment TEXT,
                is_deleted      INTEGER DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id               TEXT PRIMARY KEY,
                notify_uid       TEXT,
                item_id          TEXT,
                type             TEXT,
                due_date         TEXT,
                due_datetime     TEXT,
                due_string       TEXT,
                due_is_recurring INTEGER DEFAULT 0,
                mm_offset        INTEGER,
                is_deleted       INTEGER DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reminders_item ON reminders(item_id)")
        # filters — saved query views (local in Phase 1, sync planned for Phase 2)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS filters (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                query       TEXT NOT NULL DEFAULT '',
                color       TEXT DEFAULT 'charcoal',
                item_order  INTEGER DEFAULT 0,
                is_favorite INTEGER DEFAULT 0,
                is_synced   INTEGER DEFAULT 0,
                is_deleted  INTEGER DEFAULT 0
            )
        """)
        # app_settings — small local key/value store for UI preferences
        # (e.g. "don't remind me again" flags). Local only, never synced to Todoist.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        # task_local.pinned — local pin (Todoister local, not committed to Todoist)
        try:
            conn.execute("ALTER TABLE task_local ADD COLUMN pinned INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE task_local ADD COLUMN archived INTEGER DEFAULT 0")
        except Exception:
            pass
        # task_local.sticky — super-priority sticky note pinned to a corner (local only)
        try:
            conn.execute("ALTER TABLE task_local ADD COLUMN sticky INTEGER DEFAULT 0")
        except Exception:
            pass
        # task_local.body_json — notebook page: full BlockNote document (JSON envelope
        # {v, md_hash, blocks}); Todoist only gets the Markdown in tasks.description
        try:
            conn.execute("ALTER TABLE task_local ADD COLUMN body_json TEXT")
        except Exception:
            pass
        # nb_file_* — the attached-file copy of body_json (nb_files.py): dirty flag + when the
        # page was last saved (idle timer) + sha1 of the bytes last uploaded (skip no-op uploads)
        for col in ("nb_file_dirty INTEGER DEFAULT 0", "nb_file_dirty_at TEXT", "nb_file_sha TEXT"):
            try:
                conn.execute(f"ALTER TABLE task_local ADD COLUMN {col}")
            except Exception:
                pass
        # remote_deleted_* — a Notebook page deleted on Todoist (phone/web) while still live
        # here: when + which comments were live then (sync._flag_remote_delete). The page body
        # stays in body_json until the user restores or discards it (nb_files.resolve_remote_deleted)
        for col in ("remote_deleted_at TEXT", "remote_deleted_comments TEXT", "remote_deleted_task TEXT"):
            try:
                conn.execute("ALTER TABLE task_local ADD COLUMN " + col)
            except Exception:
                pass
        # task_local.gcal_event_id/gcal_sig — Google Calendar full sync (Stage B2):
        # the event this task maps to, and a signature of what we last pushed
        for col in ("gcal_event_id TEXT", "gcal_sig TEXT"):
            try:
                conn.execute("ALTER TABLE task_local ADD COLUMN " + col)
            except Exception:
                pass
        # pending_ops.dead — commands Todoist rejected DEAD_AFTER_ATTEMPTS times (sync.py)
        sync_mod.ensure_pending_ops_schema(conn)
        # AI agent panel (agent_panel.py): task_local.agent_* + agent_queue / agent_log
        agent_panel.ensure_agent_schema(conn)


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        "INSERT INTO app_settings(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)),
    )


def log_action(line):
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def split_due(due_date, due_datetime):
    """SQLite due_date/due_datetime → UI (due_date, due_time).

    Todoist puts a timed due straight into due.date as a datetime
    ("2026-05-08T17:00:00" or "...Z"), often with due_datetime empty — so check
    both. A timezone-aware value (trailing Z/offset) is converted to local time;
    a naive value is shown as-is. A date-only value returns an empty time."""
    raw = due_datetime or due_date or ""
    if raw and "T" in raw:
        try:
            dt = datetime.datetime.fromisoformat(raw.strip())
            if dt.tzinfo is not None:
                dt = dt.astimezone()  # aware (UTC/offset) → local wall-clock time
            return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")
        except Exception:
            return raw[:10], ""
    return (due_date or "")[:10], ""


def load_state_dict():
    """Return {tasks, projects, project_sections, labels} in UI shape."""
    with db() as conn:
        proj_rows = conn.execute(
            "SELECT id, name, color, is_favorite, is_inbox FROM projects "
            "WHERE is_deleted=0 AND is_archived=0 "
            "ORDER BY (CASE WHEN is_inbox=1 THEN 0 ELSE 1 END), child_order, name"
        ).fetchall()
        projects = [r["name"] for r in proj_rows]
        proj_id_to_name = {r["id"]: r["name"] for r in proj_rows}
        # name -> {id, color, is_favorite, is_inbox}: drives the sidebar # color + edit dialog
        project_meta = {
            r["name"]: {
                "id": r["id"],
                "color": r["color"] or "charcoal",
                "is_favorite": bool(r["is_favorite"]),
                "is_inbox": bool(r["is_inbox"]),
            }
            for r in proj_rows
        }
        # Archived projects (hidden from the sidebar; shown on the "My Projects" page)
        arch_rows = conn.execute(
            "SELECT id, name, color FROM projects "
            "WHERE is_deleted=0 AND is_archived=1 AND is_inbox=0 ORDER BY child_order, name"
        ).fetchall()
        arch_count = {
            r["project_id"]: r["c"]
            for r in conn.execute(
                "SELECT project_id, COUNT(*) c FROM tasks "
                "WHERE is_deleted=0 AND checked=0 AND parent_id IS NULL GROUP BY project_id"
            ).fetchall()
        }
        archived_projects = [
            {"name": r["name"], "color": r["color"] or "charcoal", "count": arch_count.get(r["id"], 0)}
            for r in arch_rows
        ]

        section_rows = conn.execute(
            "SELECT id, project_id, name FROM sections WHERE is_deleted=0 "
            "ORDER BY project_id, section_order"
        ).fetchall()
        project_sections = {n: [] for n in projects}
        sec_id_to_name = {}
        for s in section_rows:
            pn = proj_id_to_name.get(s["project_id"])
            if pn:
                project_sections[pn].append(s["name"])
                sec_id_to_name[s["id"]] = s["name"]

        # Synced Todoist labels (name + color) — drives the label picker in the UI
        label_rows = conn.execute(
            "SELECT name, color FROM labels WHERE is_deleted=0 ORDER BY item_order, name"
        ).fetchall()
        label_list = [{"name": l["name"], "color": l["color"] or ""} for l in label_rows]

        # Saved filters (local for now) — drive the Filters & Labels page
        filter_rows = conn.execute(
            "SELECT id, name, query, color, is_favorite, is_synced FROM filters "
            "WHERE is_deleted=0 ORDER BY item_order, name"
        ).fetchall()
        filter_list = [{
            "id": f["id"], "name": f["name"], "query": f["query"] or "",
            "color": f["color"] or "charcoal",
            "is_favorite": bool(f["is_favorite"]), "is_synced": bool(f["is_synced"]),
        } for f in filter_rows]

        task_rows = conn.execute(
            "SELECT t.*, tl.interpretation, tl.review_status, tl.suggested_label, tl.pinned, tl.archived, tl.sticky, tl.body_json "
            "FROM tasks t "
            "LEFT JOIN task_local tl ON tl.task_id = t.id "
            "WHERE t.is_deleted=0 "
            "ORDER BY t.project_id, t.section_id, t.child_order"
        ).fetchall()

        # Children map (subtasks via parent_id)
        children = {}
        for r in task_rows:
            if r["parent_id"]:
                children.setdefault(r["parent_id"], []).append(r)

        # Comments per task (only top-level tasks)
        comments_by_task = {}
        nb_file_by_task = {}   # task_id → file_url of the hidden Todoister-page.json comment
        try:
            comm_rows = conn.execute(
                "SELECT id, task_id, content, posted_at, file_attachment "
                "FROM comments WHERE is_deleted=0 ORDER BY posted_at"
            ).fetchall()
            for c in comm_rows:
                att = None
                if c["file_attachment"]:
                    try: att = json.loads(c["file_attachment"])
                    except Exception: att = None
                # The notebook page-file comment (nb_files.py) is app-internal: hidden from the
                # UI (no Files-strip chip, no delete), only its URL is exposed for cache misses.
                if att and (att.get("file_name") or "") == NB_PAGE_FILE_NAME:
                    if att.get("file_url"):
                        nb_file_by_task[c["task_id"]] = att["file_url"]   # latest wins (ordered by posted_at)
                    continue
                comments_by_task.setdefault(c["task_id"], []).append({
                    "id": c["id"],
                    "content": c["content"] or "",
                    "posted_at": c["posted_at"] or "",
                    "attachment": att,
                })
        except sqlite3.OperationalError:
            pass

        # Reminders per task
        reminders_by_task = {}
        try:
            rem_rows = conn.execute(
                "SELECT id, item_id, type, due_date, due_datetime, due_string, mm_offset "
                "FROM reminders WHERE is_deleted=0"
            ).fetchall()
            for rm in rem_rows:
                rdd, rdt = split_due(rm["due_date"], rm["due_datetime"])
                reminders_by_task.setdefault(rm["item_id"], []).append({
                    "id": rm["id"],
                    "type": rm["type"] or "",
                    "due_date": rdd,
                    "due_time": rdt,
                    "due_string": rm["due_string"] or "",
                    "mm_offset": rm["mm_offset"],
                })
        except sqlite3.OperationalError:
            pass

        tasks = []
        for r in task_rows:
            if r["parent_id"]:
                continue
            project_name = proj_id_to_name.get(r["project_id"], "")
            section_name = sec_id_to_name.get(r["section_id"], "") if r["section_id"] else ""
            due_date, due_time = split_due(r["due_date"], r["due_datetime"])
            subs = sorted(children.get(r["id"], []), key=lambda x: x["child_order"] or 0)
            subtasks = []
            for c in subs:
                if c["is_deleted"]:
                    continue
                sub_dd, sub_dt = split_due(c["due_date"], c["due_datetime"])
                try:
                    sub_labels = json.loads(c["labels_json"] or "[]")
                except Exception:
                    sub_labels = []
                subtasks.append({
                    "id": c["id"],
                    "text": c["content"] or "",
                    "done": bool(c["checked"]),
                    "priority": PRIO_TD_TO_UI.get(c["priority"], "P4"),
                    "due_date": sub_dd,
                    "due_time": sub_dt,
                    "due_string": c["due_string"] or "",
                    "due_is_recurring": bool(c["due_is_recurring"]),
                    "chosen_labels": sub_labels,
                    "description": c["description"] or "",
                })
            try:
                labels = json.loads(r["labels_json"] or "[]")
            except Exception:
                labels = []
            tasks.append({
                "id": r["id"],
                "text": r["content"] or "",
                "project": project_name,
                "section": section_name,
                "completed": bool(r["checked"]),
                "completed_at": r["completed_at"] or "",
                "priority": PRIO_TD_TO_UI.get(r["priority"], "P4"),
                "due_date": due_date,
                "due_time": due_time,
                "due_string": r["due_string"] or "",
                "due_is_recurring": bool(r["due_is_recurring"]),
                "due_timezone": r["due_timezone"] or "",
                "deadline_date": r["deadline_date"] or "",
                "chosen_labels": labels,
                "subtasks": subtasks,
                "description": r["description"] or "",
                "interpretation": r["interpretation"] or "",
                "review_status": r["review_status"] or "",
                "pinned": bool(r["pinned"]) if "pinned" in r.keys() else False,
                "archived": bool(r["archived"]) if "archived" in r.keys() else False,
                "sticky": bool(r["sticky"]) if "sticky" in r.keys() else False,
                "body_json": (r["body_json"] or "") if "body_json" in r.keys() else "",
                "nb_file_url": nb_file_by_task.get(r["id"], ""),
                "comments": comments_by_task.get(r["id"], []),
                "reminders": reminders_by_task.get(r["id"], []),
            })

        # Notebook pages deleted on Todoist but still held locally — the app asks the user
        # (restore / discard). Only while the Notebook project itself is alive.
        # (Todoist sends the deleted task as a stub — title comes from the snapshot taken at
        # detection time; only while the Notebook project itself is alive.)
        nb_deleted_pending = []
        try:
            nb_alive = conn.execute(
                "SELECT 1 FROM projects WHERE name=? AND is_deleted=0", (NOTEBOOK_PROJECT_NAME,)
            ).fetchone() is not None
            for r in (conn.execute(
                "SELECT t.id, t.content, tl.remote_deleted_at, tl.remote_deleted_comments, tl.remote_deleted_task "
                "FROM tasks t JOIN task_local tl ON tl.task_id=t.id "
                "WHERE t.is_deleted=1 AND tl.remote_deleted_at IS NOT NULL "
                "ORDER BY tl.remote_deleted_at DESC",
            ).fetchall() if nb_alive else []):
                try:
                    snap = json.loads(r["remote_deleted_task"] or "{}")
                except Exception:
                    snap = {}
                try:
                    cids = json.loads(r["remote_deleted_comments"] or "[]")
                except Exception:
                    cids = []
                files = 0
                if cids:
                    q = ",".join("?" * len(cids))
                    for c in conn.execute(
                        f"SELECT file_attachment FROM comments WHERE id IN ({q})", cids
                    ).fetchall():
                        try:
                            att = json.loads(c["file_attachment"]) if c["file_attachment"] else None
                        except Exception:
                            att = None
                        if att and (att.get("file_name") or "") != NB_PAGE_FILE_NAME:
                            files += 1
                nb_deleted_pending.append({
                    "id": r["id"], "title": snap.get("content") or r["content"] or "",
                    "deleted_at": r["remote_deleted_at"] or "", "files": files,
                })
        except sqlite3.OperationalError:
            pass

        pending = conn.execute("SELECT COUNT(*) c FROM pending_ops WHERE dead=0").fetchone()["c"]
        # Commands Todoist rejected for good (sync.apply_sync_status): shown as "rejected"
        # in the header pill; the user drops them via /api/sync_discard_dead.
        dead_rows = conn.execute(
            "SELECT command_type, last_error FROM pending_ops WHERE dead=1 ORDER BY created_at"
        ).fetchall()
        dead_errors = []
        for r in dead_rows:
            e = (r["last_error"] or "").strip()
            if e and e not in dead_errors:
                dead_errors.append(e)
        state_rows = conn.execute(
            "SELECT key, value FROM sync_state WHERE key IN "
            "('last_push_error','last_push_error_at','last_pull_error','last_pull_error_at',"
            "'last_sync_at','user_json')"
        ).fetchall()
        sync_state = {r["key"]: r["value"] for r in state_rows}
        account = build_account(sync_state.get("user_json"))
        return agent_panel.decorate_state(conn, {
            "account": account,
            "connected": bool(sync_mod.TOKEN),
            "sync_interval": SYNC_INTERVAL,
            "tasks": tasks,
            "projects": projects,
            "project_meta": project_meta,
            "archived_projects": archived_projects,
            "project_sections": project_sections,
            "labels": label_list,
            "filters": filter_list,
            "pending_count": pending,
            "nb_deleted_pending": nb_deleted_pending,
            "prefs": {
                "nb_fav_dismissed": get_setting(conn, "nb_fav_dismissed", "0") == "1",
            },
            "gcal": {
                "connected": bool(get_setting(conn, "gcal_ics_url", "")),
                "name": get_setting(conn, "gcal_name", "") or "",
                "sync_ready": bool(get_setting(conn, "gcal_refresh_token", "")),
            },
            "sync_state": {
                "last_push_error": sync_state.get("last_push_error", "") or "",
                "last_push_error_at": sync_state.get("last_push_error_at", "") or "",
                "last_pull_error": sync_state.get("last_pull_error", "") or "",
                "last_pull_error_at": sync_state.get("last_pull_error_at", "") or "",
                "last_sync_at": sync_state.get("last_sync_at", "") or "",
                "dead_count": len(dead_rows),
                "dead_errors": dead_errors[:3],
            },
        })


def build_completed(cursor=None):
    """Fetch a page of completed tasks from Todoist (Reporting view) and enrich
    each with its project name/color and a "by_me" flag. Window = last 3 months;
    older history is reached by following next_cursor."""
    # The API reads since/until in the account's local timezone, not UTC, so pad
    # "until" one day into the future — otherwise today's completions get cut off
    # for users ahead of UTC. since/until stay within the API's 3-month cap.
    until = datetime.datetime.utcnow() + datetime.timedelta(days=1)
    since = until - datetime.timedelta(days=89)
    resp = sync_mod.fetch_completed(
        since.strftime("%Y-%m-%dT%H:%M:%S"),
        until.strftime("%Y-%m-%dT%H:%M:%S"),
        cursor=cursor, limit=50,
    )
    raw = resp.get("items", []) or []
    with db() as conn:
        # Mirror the fetched completed tasks into the local DB (checked=1) so the
        # task modal can open them by id, just like active tasks. They stay hidden
        # from normal views (the frontend filters out completed tasks).
        for t in raw:
            try:
                sync_mod.upsert_task(conn, t)
            except Exception as e:
                log_action(f"[{now()}] completed upsert failed for {t.get('id')}: {e}")
        proj_map = {
            r["id"]: {"name": r["name"], "color": r["color"]}
            for r in conn.execute("SELECT id, name, color FROM projects WHERE is_deleted=0")
        }
        sec_map = {
            r["id"]: r["name"]
            for r in conn.execute("SELECT id, name FROM sections WHERE is_deleted=0")
        }
        uj = conn.execute(
            "SELECT value FROM sync_state WHERE key='user_json'"
        ).fetchone()
    own_uid = ""
    if uj and uj["value"]:
        try:
            own_uid = str(json.loads(uj["value"]).get("id") or "")
        except Exception:
            own_uid = ""
    items = []
    for t in raw:
        pm = proj_map.get(t.get("project_id"), {})
        cby = t.get("completed_by_uid")
        items.append({
            "id": t.get("id"),
            "content": t.get("content") or "",
            "description": t.get("description") or "",
            "project": pm.get("name", ""),
            "project_color": pm.get("color", ""),
            "section": sec_map.get(t.get("section_id"), ""),
            "completed_at": t.get("completed_at") or "",
            "priority": PRIO_TD_TO_UI.get(t.get("priority"), "P4"),
            "labels": t.get("labels") or [],
            "by_me": (str(cby) == own_uid) if own_uid else True,
        })
    return {"items": items, "next_cursor": resp.get("next_cursor")}


def lookup_project_id(conn, name):
    row = conn.execute(
        "SELECT id FROM projects WHERE name=? AND is_deleted=0", (name,)
    ).fetchone()
    return row["id"] if row else None


def lookup_section_id(conn, project_id, name):
    if not project_id or not name:
        return None
    row = conn.execute(
        "SELECT id FROM sections WHERE project_id=? AND name=? AND is_deleted=0",
        (project_id, name),
    ).fetchone()
    return row["id"] if row else None


def short_title(conn, tid):
    row = conn.execute("SELECT content FROM tasks WHERE id=?", (tid,)).fetchone()
    return (row["content"] or "")[:30] if row else ""


def now_iso():
    return datetime.datetime.now().isoformat(timespec="seconds")


END_CLAUSE_RE = re.compile(r"\s+(?:ending|until)\s+(\d{4}-\d{2}-\d{2})", re.I)

def recurrence_end_date(due_string):
    """The 'ending <date>' / 'until <date>' cap inside a recurrence string, or None."""
    m = END_CLAUSE_RE.search(due_string or "")
    return m.group(1) if m else None

def task_due_obj(conn, tid):
    """Return Todoist 'due' object for the task (or None)."""
    r = conn.execute(
        "SELECT due_date, due_datetime, due_string, due_is_recurring, due_timezone, due_lang "
        "FROM tasks WHERE id=?", (tid,)
    ).fetchone()
    if not r or (not r["due_date"] and not r["due_datetime"] and not r["due_string"]):
        return None
    obj = {}
    # Todoist API v1 carries a timed due in due.date ("2026-07-06T14:30:00");
    # a separate "datetime" key is IGNORED on write — observed live 2026-07-06:
    # item_add with due={"datetime": ...} created the task with no due at all,
    # and the push response then wiped the local date/time too.
    if r["due_datetime"]:
        obj["date"] = r["due_datetime"]
    elif r["due_date"]:
        obj["date"] = r["due_date"]                # may already embed the time

    if r["due_string"]:
        s = r["due_string"]
        # Only send the string for an actual recurrence. Todoist's due.string is
        # authoritative: for a recurring task it carries the pattern + time
        # ("every Friday at 17:00"); for a plain dated task Todoist echoes the date
        # back as the string ("2026-06-06"). Re-sending that stale date-string would
        # override our date/datetime and drop the time — so omit it when not recurring.
        is_rec = r["due_is_recurring"] or s.lower().startswith("every")
        if is_rec:
            # Embed the time into the recurrence string, else Todoist re-derives the
            # due from the (timeless) string and drops the time. Insert it before any
            # "ending/until" clause so the grammar stays "every … at HH:MM ending DATE".
            if " at " not in s.lower():
                raw = r["due_datetime"] or (r["due_date"] or "")
                if raw and "T" in raw:
                    tm = raw[11:16]
                    if tm and tm != "00:00":
                        low = s.lower()
                        cut = len(s)
                        for kw in (" ending ", " until "):
                            idx = low.find(kw)
                            if idx != -1:
                                cut = min(cut, idx)
                        s = s[:cut] + f" at {tm}" + s[cut:]
            obj["string"] = s
    if r["due_is_recurring"]:
        obj["is_recurring"] = True
    if r["due_timezone"]:
        obj["timezone"] = r["due_timezone"]
    if r["due_lang"]:
        obj["lang"] = r["due_lang"]
    return obj


def queue_cmd(conn, command_type, args, coalesce_id=None):
    """Queue a Todoist Sync API command for later push.

    coalesce_id (str): if set + command_type=item_update, merge args into existing
    queued update for that id (avoids 10 updates for 10 quick edits)."""
    if coalesce_id and command_type == "item_update":
        existing = conn.execute(
            "SELECT uuid, args_json FROM pending_ops "
            "WHERE command_type='item_update' "
            "AND json_extract(args_json,'$.id')=?",
            (coalesce_id,)
        ).fetchone()
        if existing:
            merged = json.loads(existing["args_json"])
            merged.update(args)
            conn.execute(
                "UPDATE pending_ops SET args_json=? WHERE uuid=?",
                (json.dumps(merged, ensure_ascii=False), existing["uuid"]),
            )
            return
    cmd_uuid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO pending_ops(uuid, command_type, args_json, created_at) "
        "VALUES(?,?,?,?)",
        (cmd_uuid, command_type, json.dumps(args, ensure_ascii=False), now_iso()),
    )


def cancel_pending_for(conn, tid):
    """Drop all pending commands referencing this task id (or temp_id)."""
    conn.execute(
        "DELETE FROM pending_ops "
        "WHERE json_extract(args_json,'$.id')=? "
        "OR json_extract(args_json,'$.temp_id')=?",
        (tid, tid),
    )


def has_pending_add(conn, tid):
    """True if there's an unsent item_add with this temp_id (= local-only task)."""
    return conn.execute(
        "SELECT 1 FROM pending_ops "
        "WHERE command_type='item_add' AND json_extract(args_json,'$.temp_id')=?",
        (tid,)
    ).fetchone() is not None


def build_item_add_args(conn, row):
    """Build an item_add command from a task row (used to recreate a restored task
    on Todoist when its delete was already pushed). temp_id = the local id, so
    apply_temp_id_mapping remaps the row + all references to the new Todoist id."""
    args = {
        "temp_id": row["id"],
        "content": row["content"] or "",
        "project_id": row["project_id"],
        "priority": row["priority"] or 1,
    }
    if row["section_id"]: args["section_id"] = row["section_id"]
    if row["parent_id"]:  args["parent_id"] = row["parent_id"]
    if row["description"]: args["description"] = row["description"]
    due = task_due_obj(conn, row["id"])
    if due: args["due"] = due
    try:
        labels = json.loads(row["labels_json"] or "[]")
        if labels: args["labels"] = labels
    except Exception: pass
    return args


def has_pending_reminder_add(conn, rid):
    """True if there's an unsent reminder_add with this temp_id."""
    return conn.execute(
        "SELECT 1 FROM pending_ops "
        "WHERE command_type='reminder_add' AND json_extract(args_json,'$.temp_id')=?",
        (rid,)
    ).fetchone() is not None


def cancel_pending_reminder_for(conn, rid):
    """Drop pending reminder commands for this temp_id."""
    conn.execute(
        "DELETE FROM pending_ops "
        "WHERE command_type IN ('reminder_add','reminder_update','reminder_delete') "
        "AND (json_extract(args_json,'$.id')=? OR json_extract(args_json,'$.temp_id')=?)",
        (rid, rid),
    )
