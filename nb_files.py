"""Notebook page file sync — the JSON half of the dual storage.

A notebook page is a Todoist task: description = plain Markdown (Todoist renders it,
editable on any device), full BlockNote document = JSON envelope {v, md_hash, blocks}
kept locally in task_local.body_json AND attached to the task as a comment file
`Todoister-page.json`, so the rich version travels with the task (reinstall / 2nd PC).

Flow:
  page saved (server `nb_body`) → body_json + nb_file_dirty=1 + nb_file_dirty_at=now
      → schedule_flush(NB_FILE_IDLE)                        (debounced, restarts on every save)
  flush_due()  → for every dirty page idle ≥ NB_FILE_IDLE (or forced by /api/nb_flush on page
      leave): upload the JSON to Todoist /uploads → replace the previous page-file comment
      (cancel pending note_add / queue note_delete) → insert new comment row + queue note_add
      with the file → clear dirty. Upload failed (offline) → stays dirty, retried later
      (bg-sync tick calls flush_due too).
The page-file comment is hidden from the app's state (store.load_state_dict) — the user
never sees it in Todoister and cannot delete it there; Todoist shows it in the task's
comments with an explanatory text. Todoist file limits: Free 5 MB per file — an envelope is
far below that.
"""

import json
import hashlib
import threading
import datetime
import urllib.request
import urllib.error
import uuid

import sync as sync_mod
from store import db, _lock, log_action, now, now_iso, queue_cmd

NB_FILE_NAME = "Todoister-page.json"
NB_FILE_NOTE = "Todoister page data — do not delete this file"
NB_FILE_IDLE = 10.0          # seconds of no saves before the JSON is (re)uploaded
NB_FILE_RETRY = 60.0         # retry delay after a failed upload (offline / Todoist error)

_timer_lock = threading.Lock()
_timer = None
_flush_lock = threading.Lock()   # one flush at a time (timer + bg-sync + /api/nb_flush)


def todoist_upload(file_data, filename, ctype):
    """Upload bytes to Todoist's /uploads endpoint, returning the file_attachment
    metadata. Raises RuntimeError(code, msg) on failure."""
    boundary = uuid.uuid4().hex
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {ctype}\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    payload = head + file_data + tail

    req = urllib.request.Request(
        "https://api.todoist.com/api/v1/uploads/",
        data=payload,
        headers={
            "Authorization": f"Bearer {sync_mod.TOKEN}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            metadata = json.loads(r.read().decode("utf-8"))
        log_action(f"[{now()}] upload OK: {filename} ({len(file_data)} bytes)")
        return metadata
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            err_body = ""
        log_action(f"[{now()}] upload HTTP {e.code}: {err_body}")
        msg = f"Todoist HTTP {e.code}"
        if e.code == 400 and len(file_data) > 5 * 1024 * 1024:
            msg = "Todoist Free Tier: max 5 MB per file"
        elif err_body:
            msg = f"Todoist {e.code}: {err_body}"
        raise RuntimeError(e.code, msg)
    except Exception as e:
        log_action(f"[{now()}] upload ERROR: {e}")
        raise RuntimeError(502, str(e))


def is_page_file_comment(att):
    """att = parsed file_attachment dict (or None)."""
    return bool(att) and (att.get("file_name") or "") == NB_FILE_NAME


def delete_comment(conn, cid):
    """Soft-delete a comment locally and undo/queue it on Todoist (same rule as
    /api/comment_delete: a still-pending note_add is cancelled instead of deleted)."""
    conn.execute("UPDATE comments SET is_deleted=1 WHERE id=?", (cid,))
    pending_add = conn.execute(
        "SELECT 1 FROM pending_ops "
        "WHERE command_type='note_add' AND json_extract(args_json,'$.temp_id')=?",
        (cid,),
    ).fetchone()
    if pending_add:
        conn.execute(
            "DELETE FROM pending_ops "
            "WHERE json_extract(args_json,'$.id')=? OR json_extract(args_json,'$.temp_id')=?",
            (cid, cid),
        )
    else:
        queue_cmd(conn, "note_delete", {"id": cid})


def _page_file_comment_ids(conn, tid):
    ids = []
    for c in conn.execute(
        "SELECT id, file_attachment FROM comments WHERE task_id=? AND is_deleted=0", (tid,)
    ).fetchall():
        try:
            att = json.loads(c["file_attachment"]) if c["file_attachment"] else None
        except Exception:
            att = None
        if is_page_file_comment(att):
            ids.append(c["id"])
    return ids


def mark_dirty(conn, tid):
    conn.execute(
        "INSERT INTO task_local(task_id, nb_file_dirty, nb_file_dirty_at) VALUES(?, 1, ?) "
        "ON CONFLICT(task_id) DO UPDATE SET nb_file_dirty=1, nb_file_dirty_at=excluded.nb_file_dirty_at",
        (tid, now_iso()),
    )


def schedule_flush(delay=NB_FILE_IDLE):
    """(Re)start the idle timer; every save pushes the upload further out."""
    global _timer
    with _timer_lock:
        if _timer is not None:
            _timer.cancel()
        _timer = threading.Timer(delay, flush_due)
        _timer.daemon = True
        _timer.start()


def flush_due(force_id=None):
    """Upload every dirty page whose last save is ≥ NB_FILE_IDLE ago (or the forced page,
    regardless of idle). Network happens outside the DB lock. Returns count uploaded."""
    if not _flush_lock.acquire(blocking=False):
        return 0
    try:
        return _flush_due_locked(force_id)
    except Exception as e:
        log_action(f"[{now()}] nb-file flush error: {e}")
        return 0
    finally:
        _flush_lock.release()


def _flush_due_locked(force_id):
    if not sync_mod.TOKEN:
        return 0
    # same clock/format as store.now_iso() (local naive, seconds) so the strings compare
    cutoff = (datetime.datetime.now() - datetime.timedelta(seconds=NB_FILE_IDLE)).isoformat(timespec="seconds")
    with _lock:
        with db() as conn:
            rows = conn.execute(
                "SELECT task_id, body_json, nb_file_dirty_at, nb_file_sha FROM task_local "
                "WHERE nb_file_dirty=1 AND body_json IS NOT NULL AND body_json != ''"
            ).fetchall()
    due, later = [], 0
    for r in rows:
        if force_id and r["task_id"] == force_id:
            due.append(r)
        elif (r["nb_file_dirty_at"] or "") <= cutoff:
            due.append(r)
        else:
            later += 1
    done = 0
    failed = False
    for r in due:
        tid = r["task_id"]
        data = r["body_json"].encode("utf-8")
        sha = hashlib.sha1(data).hexdigest()
        if sha == (r["nb_file_sha"] or ""):
            # Same bytes already attached — nothing to upload, just clear the flag.
            with _lock:
                with db() as conn:
                    conn.execute("UPDATE task_local SET nb_file_dirty=0 WHERE task_id=?", (tid,))
                    conn.commit()
            continue
        try:
            meta = todoist_upload(data, NB_FILE_NAME, "application/json")
        except RuntimeError as e:
            failed = True
            log_action(f"[{now()}] {tid} → page file upload failed, will retry: {e.args[-1]}")
            continue
        with _lock:
            with db() as conn:
                # Still the same content? (a save may have landed during the upload)
                cur = conn.execute("SELECT body_json FROM task_local WHERE task_id=?", (tid,)).fetchone()
                still = cur and hashlib.sha1((cur["body_json"] or "").encode("utf-8")).hexdigest() == sha
                for cid in _page_file_comment_ids(conn, tid):
                    delete_comment(conn, cid)
                new_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO comments(id,task_id,content,posted_at,file_attachment) VALUES(?,?,?,?,?)",
                    (new_id, tid, NB_FILE_NOTE, now_iso(), json.dumps(meta, ensure_ascii=False)),
                )
                queue_cmd(conn, "note_add", {
                    "temp_id": new_id, "item_id": tid, "content": NB_FILE_NOTE,
                    "file_attachment": meta,
                })
                conn.execute(
                    "UPDATE task_local SET nb_file_sha=?, nb_file_dirty=? WHERE task_id=?",
                    (sha, 0 if still else 1, tid),
                )
                conn.commit()
        log_action(f"[{now()}] {tid} → page file attached ({len(data)} bytes)")
        done += 1
    if failed:
        schedule_flush(NB_FILE_RETRY)
    elif later:
        schedule_flush(NB_FILE_IDLE)
    return done
