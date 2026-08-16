"""
agent_panel.py — "AI აგენტის პანელი" (AI Agent Panel): the bridge between Todoister and an
AI agent (v1 = კიკი; the contract is generic — any agent that can speak HTTP JSON to
localhost can plug in). Spec: Kiki/_work/triage-handover/SPEC.md v0.2 + Lasha's decisions
of 2026-08-16 (see AGENT-API.md next to this file for the public contract).

Kept in one module on purpose: store.py / server.py only get one-line hooks, so this
feature never collides with parallel work in those files.

What lives here
  - schema:  task_local.agent_proposal / agent_status / agent_decided_at,
             tables agent_queue (what the user sent to the agent) and agent_log
             (append-only: what the user decided — the agent reads it and learns)
  - state:   decorate_state()  → per-task agent fields + global state["agent"]
  - GET      /api/agent_queue  → the agent's poll (= heartbeat = "connected")
  - POST     /api/agent_propose · agent_status · agent_queue · agent_done · agent_trigger

Presence: connected = the agent polled GET /api/agent_queue within CONNECT_TTL seconds.
busy = there is an open (not done) batch AND the agent is connected — the panel is locked
while the agent works; if the agent drops, the panel is disabled and the queue simply waits
in the DB until the agent's next poll (Lasha, 2026-08-16).
"""
import datetime
import json
import re
import uuid

CONNECT_TTL = 60          # seconds since the last agent poll → still "connected"
LABEL_POSTPONE_RE = re.compile(r"^\(\+(\d+)\)$")   # Todoist label "(+3)" → postpone_count 3
STATUSES = ("", "proposed", "accepted", "changed", "rejected", "split", "queued", "done")


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _log(line):
    try:
        from store import log_action     # lazy: store imports this module
        log_action(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] agent: {line}")
    except Exception:
        pass


def _setting(conn, key, default=""):
    row = conn.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row and row["value"] is not None else default


def _set(conn, key, value):
    conn.execute(
        "INSERT INTO app_settings(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, "" if value is None else str(value)),
    )


# ---------------------------------------------------------------- schema
def ensure_agent_schema(conn):
    """Idempotent. Called from store.ensure_schema()."""
    for col in ("agent_proposal TEXT", "agent_status TEXT DEFAULT ''", "agent_decided_at TEXT"):
        try:
            conn.execute("ALTER TABLE task_local ADD COLUMN " + col)
        except Exception:
            pass
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_queue (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id   TEXT NOT NULL,
            agent      TEXT DEFAULT '',
            task_id    TEXT,
            tab        TEXT,                    -- active | triage
            payload    TEXT,                    -- JSON item exactly as the panel sent it
            status     TEXT DEFAULT 'queued',   -- queued | waiting | done
            created_at TEXT,
            done_at    TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_queue_status ON agent_queue(status)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_log (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            at      TEXT,
            task_id TEXT,
            event   TEXT,                       -- accepted | changed | rejected | undo | queue | done | trigger
            data    TEXT                        -- JSON
        )
    """)


def _log_event(conn, task_id, event, data=None):
    conn.execute(
        "INSERT INTO agent_log(at, task_id, event, data) VALUES(?,?,?,?)",
        (_now(), task_id or "", event, json.dumps(data or {}, ensure_ascii=False)),
    )


# ---------------------------------------------------------------- presence / state
def _seconds_since(iso):
    if not iso:
        return None
    try:
        return (datetime.datetime.now() - datetime.datetime.fromisoformat(iso)).total_seconds()
    except Exception:
        return None


def agent_state(conn):
    last_seen = _setting(conn, "agent_last_seen", "")
    age = _seconds_since(last_seen)
    connected = age is not None and age <= CONNECT_TTL
    open_batches = [r["batch_id"] for r in conn.execute(
        "SELECT DISTINCT batch_id FROM agent_queue WHERE status!='done' ORDER BY id"
    ).fetchall()]
    return {
        "connected": connected,
        "busy": connected and bool(open_batches),
        "name": _setting(conn, "agent_name", ""),
        "last_seen": last_seen,
        "last_analysis": _setting(conn, "agent_last_analysis", ""),
        "open_batches": open_batches,
        "queued": conn.execute(
            "SELECT COUNT(*) c FROM agent_queue WHERE status!='done'"
        ).fetchone()["c"],
    }


def postpone_count(labels):
    """Postpone counter lives in a Todoist label "(+n)" (Lasha wants it on the phone too)."""
    n = 0
    for l in labels or []:
        m = LABEL_POSTPONE_RE.match(l or "")
        if m:
            n = max(n, int(m.group(1)))
    return n


def decorate_state(conn, state):
    """Add per-task agent fields + global state["agent"]. Called at the end of
    store.load_state_dict(). Cheap: one query over task_local rows that carry agent data."""
    rows = {}
    try:
        for r in conn.execute(
            "SELECT task_id, agent_proposal, agent_status, agent_decided_at FROM task_local "
            "WHERE (agent_status IS NOT NULL AND agent_status!='') OR agent_proposal IS NOT NULL"
        ).fetchall():
            rows[r["task_id"]] = r
    except Exception:
        rows = {}
    for t in state.get("tasks", []):
        r = rows.get(t["id"])
        prop = None
        if r and r["agent_proposal"]:
            try:
                prop = json.loads(r["agent_proposal"])
            except Exception:
                prop = None
        t["agent_status"] = (r["agent_status"] or "") if r else ""
        t["agent_proposal"] = prop
        t["agent_decided_at"] = (r["agent_decided_at"] or "") if r else ""
        t["postpone_count"] = postpone_count(t.get("chosen_labels"))
    state["agent"] = agent_state(conn)
    return state


def _upsert_local(conn, task_id, **cols):
    keys = list(cols.keys())
    conn.execute(
        f"INSERT INTO task_local(task_id, {', '.join(keys)}) VALUES(?, {', '.join('?' * len(keys))}) "
        f"ON CONFLICT(task_id) DO UPDATE SET " + ", ".join(f"{k}=excluded.{k}" for k in keys),
        (task_id, *[cols[k] for k in keys]),
    )


# ---------------------------------------------------------------- GET /api/agent_queue
def get_queue(conn, params):
    """The agent's poll. Also the heartbeat: every call refreshes agent_last_seen.
    params: agent (name), status (queued|waiting|all; default = not done), since (ISO — log
    entries after this moment). Returns queue rows, open batches, log, and a pending trigger
    (consumed once)."""
    agent = (params.get("agent") or "").strip()
    _set(conn, "agent_last_seen", _now())
    if agent:
        _set(conn, "agent_name", agent)
    status = (params.get("status") or "").strip()
    if status in ("queued", "waiting", "done"):
        rows = conn.execute(
            "SELECT * FROM agent_queue WHERE status=? ORDER BY id", (status,)
        ).fetchall()
    elif status == "all":
        rows = conn.execute("SELECT * FROM agent_queue ORDER BY id").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM agent_queue WHERE status!='done' ORDER BY id"
        ).fetchall()
    queue = []
    for r in rows:
        try:
            item = json.loads(r["payload"] or "{}")
        except Exception:
            item = {}
        queue.append({
            "id": r["id"], "batch_id": r["batch_id"], "agent": r["agent"] or "",
            "task_id": r["task_id"], "tab": r["tab"], "status": r["status"],
            "created_at": r["created_at"], "done_at": r["done_at"], "item": item,
        })
    since = (params.get("since") or "").strip()
    log_rows = conn.execute(
        "SELECT * FROM agent_log WHERE at>? ORDER BY id LIMIT 500", (since,)
    ).fetchall() if since else conn.execute(
        "SELECT * FROM agent_log ORDER BY id DESC LIMIT 100"
    ).fetchall()[::-1]
    log = []
    for r in log_rows:
        try:
            data = json.loads(r["data"] or "{}")
        except Exception:
            data = {}
        log.append({"id": r["id"], "at": r["at"], "task_id": r["task_id"], "event": r["event"], "data": data})
    trigger_at = _setting(conn, "agent_trigger_at", "")
    if trigger_at:
        _set(conn, "agent_trigger_at", "")     # consumed once
    st = agent_state(conn)
    return {
        "ok": True,
        "server_time": _now(),
        "agent": st,
        "queue": queue,
        "open_batches": st["open_batches"],
        "log": log,
        "trigger_at": trigger_at,
    }


# ---------------------------------------------------------------- POST /api/agent_*
def handle_post(conn, path, body):
    """Returns True (ok), a dict (ok + extra keys merged into the response), or False (unknown)."""
    if path == "/api/agent_propose":
        return _propose(conn, body)
    if path == "/api/agent_status":
        return _status(conn, body)
    if path == "/api/agent_queue":
        return _enqueue(conn, body)
    if path == "/api/agent_done":
        return _done(conn, body)
    if path == "/api/agent_trigger":
        _set(conn, "agent_trigger_at", _now())
        _log_event(conn, "", "trigger", {})
        _log("trigger (re-analyse) requested")
        return True
    return False


def _propose(conn, body):
    """Agent → task: {id, proposal} or {proposals:[{id, proposal}, …]}. Sets agent_status=proposed."""
    items = body.get("proposals")
    if not isinstance(items, list):
        items = [{"id": body.get("id"), "proposal": body.get("proposal")}]
    agent = (body.get("agent") or "").strip()
    n = 0
    for it in items:
        tid = (it or {}).get("id")
        prop = (it or {}).get("proposal")
        if not tid or not isinstance(prop, dict):
            continue
        if not conn.execute("SELECT 1 FROM tasks WHERE id=?", (tid,)).fetchone():
            continue
        prop.setdefault("made_at", _now())
        _upsert_local(conn, tid, agent_proposal=json.dumps(prop, ensure_ascii=False),
                      agent_status="proposed", agent_decided_at=None)
        n += 1
    if n:
        _set(conn, "agent_last_analysis", _now())
        _set(conn, "agent_last_seen", _now())
        if agent:
            _set(conn, "agent_name", agent)
    _log(f"{n} proposal(s) written")
    return {"proposed": n}


def _status(conn, body):
    """Panel → after a standard action: {id, status, changes?, verdict?}. status "" or
    "proposed" = undo. Everything is logged for the agent."""
    tid = body.get("id")
    status = body.get("status") or ""
    if not tid or status not in STATUSES:
        return False
    _upsert_local(conn, tid, agent_status=status,
                  agent_decided_at=_now() if status not in ("", "proposed") else None)
    ev = status if status in ("accepted", "changed", "rejected", "split") else "undo"
    _log_event(conn, tid, ev, {
        "status": status,
        "changes": body.get("changes") or None,
        "verdict": body.get("verdict") or "",
        "tab": body.get("tab") or "",
    })
    _log(f"{tid} → {status or 'cleared'}")
    return True


def _enqueue(conn, body):
    """Panel → agent: {active:[…], triage:[…], agent?}. One batch; every task gets
    agent_status=queued. The agent picks it up on its next poll."""
    batch_id = uuid.uuid4().hex[:12]
    agent = (body.get("agent") or _setting(conn, "agent_name", "")).strip()
    n = 0
    for tab in ("active", "triage"):
        for it in body.get(tab) or []:
            tid = (it or {}).get("task_id")
            if not tid:
                continue
            conn.execute(
                "INSERT INTO agent_queue(batch_id, agent, task_id, tab, payload, status, created_at) "
                "VALUES(?,?,?,?,?,'queued',?)",
                (batch_id, agent, tid, tab, json.dumps(it, ensure_ascii=False), _now()),
            )
            _upsert_local(conn, tid, agent_status="queued", agent_decided_at=_now())
            n += 1
    if not n:
        return {"batch_id": "", "queued": 0}
    _log_event(conn, "", "queue", {"batch_id": batch_id, "n": n})
    _log(f"batch {batch_id}: {n} item(s) queued")
    return {"batch_id": batch_id, "queued": n}


def _done(conn, body):
    """Agent → panel: {batch_id} (or {batch_id:"all"}) — the batch is finished; the panel
    unlocks. Tasks still 'queued' become 'done' (a fresh proposal posted meanwhile stays)."""
    batch_id = (body.get("batch_id") or "").strip()
    if not batch_id:
        return False
    if batch_id == "all":
        rows = conn.execute("SELECT id, task_id FROM agent_queue WHERE status!='done'").fetchall()
    else:
        rows = conn.execute(
            "SELECT id, task_id FROM agent_queue WHERE batch_id=? AND status!='done'", (batch_id,)
        ).fetchall()
    ts = _now()
    for r in rows:
        conn.execute("UPDATE agent_queue SET status='done', done_at=? WHERE id=?", (ts, r["id"]))
        conn.execute(
            "UPDATE task_local SET agent_status='done', agent_decided_at=? "
            "WHERE task_id=? AND agent_status='queued'", (ts, r["task_id"]),
        )
    _set(conn, "agent_last_seen", ts)
    _log_event(conn, "", "done", {"batch_id": batch_id, "n": len(rows)})
    _log(f"batch {batch_id} done ({len(rows)} item(s))")
    return {"done": len(rows)}
