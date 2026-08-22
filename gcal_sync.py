# -*- coding: utf-8 -*-
"""
Todoister — Google Calendar full sync (Stage B2): OAuth token refresh and
the one-way task->event reconcile pass.
Split out of server.py 2026-07-08 (mechanical move, no behavior change).
"""
import hashlib
import json
import datetime
import threading
import time
import urllib.error

import gcal_api

from store import _lock, db, get_setting, set_setting, log_action, now, split_due


def _err(e):
    """Google puts the real reason in the response body; HTTPError's str() is
    just "HTTP Error 400: Bad Request", which is undiagnosable in a log. Read
    the body once and append it (trimmed — a stack of these must not flood
    app.log). Never raises: diagnostics must not break the sync pass."""
    if not isinstance(e, urllib.error.HTTPError):
        return str(e)
    try:
        body = e.read().decode("utf-8", "replace").strip()
    except Exception:
        body = ""
    try:                                   # {"error": {"message": "..."}}
        msg = json.loads(body)["error"]["message"]
    except Exception:
        msg = body[:400]
    return f"{e} — {msg}" if msg else str(e)


def gcal_access_token(conn):
    """Valid access token for the Calendar API, refreshing when stale.
    Returns None when full sync is not authorized."""
    tok = get_setting(conn, "gcal_access_token", "")
    try:
        exp = float(get_setting(conn, "gcal_access_expiry", "0") or 0)
    except ValueError:
        exp = 0
    if tok and time.time() < exp - 60:
        return tok
    rt = get_setting(conn, "gcal_refresh_token", "")
    cid = get_setting(conn, "gcal_client_id", "")
    cs = get_setting(conn, "gcal_client_secret", "")
    if not (rt and cid and cs):
        return None
    d = gcal_api.refresh_access(cid, cs, rt)
    tok = d.get("access_token", "")
    if tok:
        set_setting(conn, "gcal_access_token", tok)
        set_setting(conn, "gcal_access_expiry", str(time.time() + int(d.get("expires_in", 3600))))
    return tok or None


# ---------------- Google Calendar full sync (Stage B2) ----------------
# One-way push: every open task with a timed due gets an event on the user's
# primary calendar. Diff-based — task_local.gcal_sig remembers what we last
# sent, so a pass with no changes costs one SQL query and zero API calls.
# A task that is completed, deleted or loses its time takes its event with it.
# Recurring tasks sync their current occurrence; completion advances the due,
# the signature changes, and the event is patched forward.

GCAL_DOUBLE_PRIO = (3, 4)            # Todoist priority: 4=P1, 3=P2
GCAL_DOUBLE_MINUTES = (1440, 60)     # P1/P2: popup 1 day + 1 hour before

_gcal_run_lock = threading.Lock()    # one reconcile pass at a time
_gcal_timer_lock = threading.Lock()
_gcal_timer = None


def gcal_event_payload(row, date_s, time_s):
    """Google event body for a timed task row (start/end in local time)."""
    start_dt = datetime.datetime.fromisoformat(date_s + "T" + time_s).astimezone()
    dur = 60
    if row["duration_amount"]:
        try:
            dur = int(row["duration_amount"]) * (1440 if (row["duration_unit"] or "") == "day" else 1)
        except Exception:
            dur = 60
    end_dt = start_dt + datetime.timedelta(minutes=max(15, dur))
    if row["priority"] in GCAL_DOUBLE_PRIO:
        reminders = {"useDefault": False, "overrides": [
            {"method": "popup", "minutes": m} for m in GCAL_DOUBLE_MINUTES]}
    else:
        # ❗ The empty list is load-bearing. We PATCH, so anything we leave out
        # keeps its old value — and an event that was P1/P2 when it was created
        # already carries our two overrides. Sending {"useDefault": True} alone
        # merges into "default reminders AND overrides", which Google rejects
        # with a 400, the signature is never stored, and the task retries every
        # 30 s for ever. The empty list is how you clear them.
        reminders = {"useDefault": True, "overrides": []}
    return {
        "summary": row["content"],
        "description": row["description"] or "",
        "start": {"dateTime": start_dt.isoformat()},
        "end": {"dateTime": end_dt.isoformat()},
        "reminders": reminders,
        "extendedProperties": {"private": {"todoister": row["id"]}},
    }


def gcal_reconcile():
    """One diff pass: insert/patch events for changed timed tasks, delete
    events for tasks gone ineligible. Runs on a background thread; never
    raises. Failed items keep their old signature and retry next pass."""
    with _gcal_run_lock:
        try:
            ops_del, ops_upsert = [], []
            with _lock:
                with db() as conn:
                    if not get_setting(conn, "gcal_refresh_token", ""):
                        return
                    rows = conn.execute(
                        "SELECT t.id, t.content, t.description, t.priority, t.due_date, "
                        "t.due_datetime, t.duration_amount, t.duration_unit, t.checked, "
                        "t.is_deleted, tl.gcal_event_id, tl.gcal_sig "
                        "FROM tasks t LEFT JOIN task_local tl ON tl.task_id = t.id "
                        "WHERE (tl.gcal_event_id IS NOT NULL AND tl.gcal_event_id != '') "
                        "   OR (t.is_deleted=0 AND t.checked=0 AND t.due_date IS NOT NULL)"
                    ).fetchall()
                    for r in rows:
                        date_s, time_s = split_due(r["due_date"], r["due_datetime"])
                        eligible = (not r["is_deleted"]) and (not r["checked"]) and date_s and time_s
                        eid = r["gcal_event_id"] or ""
                        if not eligible:
                            if eid:
                                ops_del.append((r["id"], eid))
                            continue
                        payload = gcal_event_payload(r, date_s, time_s)
                        sig = hashlib.sha1(
                            json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
                        if not eid or sig != (r["gcal_sig"] or ""):
                            ops_upsert.append((r["id"], eid, payload, sig))
                    # mappings whose task row vanished entirely (hard purge)
                    for o in conn.execute(
                        "SELECT tl.task_id, tl.gcal_event_id FROM task_local tl "
                        "LEFT JOIN tasks t ON t.id = tl.task_id "
                        "WHERE tl.gcal_event_id IS NOT NULL AND tl.gcal_event_id != '' "
                        "AND t.id IS NULL"
                    ).fetchall():
                        ops_del.append((o["task_id"], o["gcal_event_id"]))
            if not ops_del and not ops_upsert:
                return
            with _lock:
                with db() as conn:
                    token = gcal_access_token(conn)   # may refresh (network, ~1/hour)
                    conn.commit()
            if not token:
                return
            done_del, done_upsert = [], []
            for tid, eid in ops_del:
                try:
                    gcal_api.delete_event(token, eid)
                    done_del.append(tid)
                except Exception as e:
                    log_action(f"[{now()}] gcal event delete failed ({tid}): {_err(e)}")
            for tid, eid, payload, sig in ops_upsert:
                try:
                    if eid:
                        try:
                            gcal_api.update_event(token, eid, payload)
                        except urllib.error.HTTPError as e:
                            if e.code in (404, 410):   # deleted on Google's side → recreate
                                eid = ""
                            else:
                                raise
                    if not eid:
                        eid = gcal_api.insert_event(token, payload).get("id", "")
                    if eid:
                        done_upsert.append((tid, eid, sig))
                except Exception as e:
                    log_action(f"[{now()}] gcal event push failed ({tid}): {_err(e)}")
            if not done_del and not done_upsert:
                return
            with _lock:
                with db() as conn:
                    for tid in done_del:
                        conn.execute(
                            "UPDATE task_local SET gcal_event_id=NULL, gcal_sig=NULL "
                            "WHERE task_id=?", (tid,))
                    for tid, eid, sig in done_upsert:
                        conn.execute(
                            "INSERT INTO task_local(task_id, gcal_event_id, gcal_sig) "
                            "VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET "
                            "gcal_event_id=excluded.gcal_event_id, gcal_sig=excluded.gcal_sig",
                            (tid, eid, sig))
                    conn.commit()
            log_action(f"[{now()}] gcal sync: {len(done_upsert)} pushed, {len(done_del)} removed")
        except Exception as e:
            log_action(f"[{now()}] gcal reconcile error: {e}")


def gcal_schedule_reconcile(delay=2.0):
    """Debounced trigger: one reconcile pass ~delay s after the last mutation."""
    global _gcal_timer
    with _gcal_timer_lock:
        if _gcal_timer is not None:
            _gcal_timer.cancel()
        _gcal_timer = threading.Timer(delay, gcal_reconcile)
        _gcal_timer.daemon = True
        _gcal_timer.start()
