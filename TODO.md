# TODO — Todoister roadmap

The core app is complete: a full Todoist Free-tier clone with bidirectional
sync, a native window, the Notebook (BlockNote) layer, i18n (en/ka), and
Free-first behaviour. This file tracks what's next.

---

## Planned

### Onboarding: guided feature setup (incl. notes)
On first launch, help the user turn on the optional features rather than leaving
them hidden. The Notebook (notes) is a real Todoist project, so it costs one of
the 5 Free-tier slots — onboarding should explain this and let the user opt in.
- Notes opt-in already exists in the sidebar ("Enable notes" → creates the
  Notebook project, blocked when 5 slots are full). Onboarding should surface the
  same choice up front, alongside any other optional setup.
- Open question: what else belongs in the first-run flow (Buddy, calendar, etc.).

### Google Calendar integration (important)
Push tasks that have a date **and** a specific time into Google Calendar.
- Tasks with date + time → a calendar event.
- Reminder logic by priority (e.g. P1/P2 → earlier/double reminder; P3/P4 → default).
- Two-way: ideally reflect calendar changes back, or at least one-way push first.
- Open questions: which Google account, auth flow, conflict handling.

### Georgian translation polish
The default language is English; `lang/ka.json` is our own translation (Todoist
has no Georgian). Review the Georgian strings for quality and consistency.

---

## Possible later

- External pull / launcher convenience (notebooks: changes made on the phone
  don't auto-pull into an idle window faster than the 30s cycle).

- **Notebook media: account-aware upload limit (Free vs Pro).** Uploads
  (image/video/file) are hard-capped at **5 MB** (Todoist Free), enforced in
  `server.py` and shown as a "max 5 MB" hint on the native upload block. To
  support Pro (100 MB):
  1. Store `is_premium` from the synced `user` object — add it to `USER_FIELDS`
     in `sync.py` (currently dropped by `store_user`).
  2. Make the server upload cap dynamic (5 MB Free / 100 MB Pro) instead of the
     hard-coded `5 * 1024 * 1024` checks.
  3. Frontend reads the plan, then shows + checks the matching limit
     (`MAX_UPLOAD` in `main.jsx`, the `nb.upload_limit` string, and the
     `--nb-size-hint` CSS var).
  Deferred 2026-06-20 to keep it simple — Free-only (5 MB) for now.

---

## Done (summary)

Phases 1–11 are complete:
- **1–5** Foundation, read/write paths, push, background auto-sync (SQLite + Sync API).
- **6–7** Pro-feature display (recurring, comments, attachments, reminders/deadline read-only); UI polish (drag&drop, search, completed view, view toggle).
- **8** Token `.env` + onboarding + network-error UI.
- **9** Deadline + Reminders editing (now disabled under Free-first).
- **10** Section reorder + expanded search (text, description, labels, project, section, subtasks, comments).
- **11** i18n (en/ka), Todoist fidelity audit, Free-first, Reschedule.
- **12** Reporting (completed-task history from `tasks/completed/by_completion_date`,
  date-grouped, open/reopen from the modal); task-detail side panel rebuilt as a
  faithful Todoist copy (rows + popovers, gold Pro crowns, Megi additions removed);
  compact date scheduler with natural-language "Type a date" (en/ka); **Time**
  (time + duration-Pro + time-zone picker) with timezone-safe `split_due`.
- **13** **Repeat** (recurring due dates): scheduler-footer Repeat button with
  presets (every day / week / weekday / month / year) + a **Custom** dialog
  (Based on: scheduled vs `every!` completed · Every N day/week/month/year ·
  Ends: never / on date). Maps to `due.string`; `task_due_obj` sends the string
  **only for real recurrences** and embeds the time (`every day at 15:00`) — both
  verified live against the Sync API, incl. `ending <date>`, which caps the
  recurrence. Guards: end date can't precede the task date; moving the task date
  past the end date drops the end clause. Time picker reworked into a 15-minute
  scroll list (prefilled to now, rounded). Calendar now seeds + highlights the
  task's own date. undo labels for repeat / timezone.

- **14** **Sticky notes** — pin up to 2 tasks as super-priority cards fixed at the
  top of the window, visible in every view until completed (`task_local.sticky`,
  local-only; marked from the task ⋯ menu). **Completion toast** reworked
  (congratulatory two-line toast, with the next-occurrence pattern for recurring
  tasks; per-edit undo toasts dropped — undo stays on the buttons + Ctrl+Z/Y).
  **Notebook polish**: card ⋯ menu on lucide icons, save check/loader icons, wider
  editor padding (block side-menu fits), bottom-bar redesign (drop ⋯; date · colour ·
  labels · file | pin · move · duplicate · archive | delete) with **file attach** and
  **due time**, loose pages shown in a faint band.

- **15** **Undoable delete** (`/api/task_restore`: un-hide task + subtasks; cancels a
  still-pending delete, else re-creates via `item_add`; delete now records an undo step).
  **Notebook content pass**: comments panel → **Files strip** (attachments only, above the
  bottom bar, shown only when present; sidebar card gets a paperclip badge); bottom bar
  compacted, **export moved into it**; **markdown-import button removed** (Ctrl+V pastes
  markdown); paperclip attaches straight to the Files strip; **⋯ → Section** can create a
  new section and move the page into it; opening a page parks the cursor in the first text
  block so a leading/only image isn't auto-selected; sidebar top = **new-page / new-section
  icon buttons** (green-circle `+` badge). **React source moved into the repo**
  (`triage/notebooks/app/`; `node_modules` gitignored) so it's version-controlled.

Detailed phase-by-phase history: `_archive/docs-history/TODO-history.md` (local only).
