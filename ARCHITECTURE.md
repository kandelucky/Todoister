# Architecture — Todoister (Todoist sync app)

## Overview

A native Windows window (WebView2 engine) + a local Python HTTP server + a
**SQLite mirror** of Todoist data + **bidirectional sync** via the Todoist Sync API.

Single source of truth = **`triage.db`** (SQLite).

---

## Data flow

```
   ┌────────────────────────────────────────────────────────────┐
   │                  Native window (WebView2)                    │
   │                       index.html                            │
   └────────────────────────┬───────────────────────────────────┘
                            │  fetch/POST localhost:8765
                            ▼
   ┌────────────────────────────────────────────────────────────┐
   │  server.py  (HTTP API + write to SQLite + queue commands)   │
   └────────────────┬───────────────────────────────┬───────────┘
                    │ read/write                    │ proxy
                    ▼                               ▼
   ┌─────────────────────────────────┐    files.todoist.com
   │       triage.db (SQLite)         │  (attachment download
   │  projects, sections, tasks,      │   via Bearer auth)
   │  labels, comments, reminders,    │
   │  pending_ops, task_local,        │
   │  sync_state                       │
   └────────────────┬─────────────────┘
                    │
                    ▼ background thread (app.py, 30s)
   ┌─────────────────────────────────────────────────────────────┐
   │  sync.py  — Todoist Sync API v1 client                       │
   │  • push pending_ops batch                                    │
   │  • incremental pull (sync_token)                             │
   │  • upload files → /uploads/                                  │
   │  • apply temp_id_mapping                                     │
   └────────────────┬────────────────────────────────────────────┘
                    │ HTTPS
                    ▼
            api.todoist.com / files.todoist.com
```

- Local edits (POST) → SQLite + pending_ops queue → pushed within ~30s
- Remote edits (from other devices) → background pull → SQLite → UI smart poll (10s, idle)
- The UI sees changes live: its own POST responses + an idle 10s poll

---

## Files

| File | Role |
|---|---|
| `app.py` | Native window wrapper — server thread + sync thread + WebView2 window |
| `server.py` | Local HTTP API (Handler), SQLite read/write, attachment proxy, upload endpoint |
| `sync.py` | Sync API client: init/pull/push/queue/status CLI + background sync flows |
| `index.html` | UI — Todoist clone (board+list, modal, dropdowns, drag&drop) |
| `i18n.js` | **Language engine** — `window.I18N` (t/list/apply/setLang/toggle/onChange), lang fetch + cache |
| `lang/en.json` | English strings (canonical, ~197 keys) |
| `lang/ka.json` | Georgian strings (same keys) |
| `onboarding.html` | First-run token form (i18n-aware) |
| `triage.db` | **SQLite — single source of truth** (Todoist mirror + Todoister local fields + queue) |
| `triage.log` | Action log (for Monitor) |
| `app.log` | Crash log for silent mode (pythonw stdout/stderr) |
| `start.vbs` | **Main launcher** — silent (pythonw.exe) |
| `start.bat` | Debug launcher — with a console (to see errors) |
| `README.md` | Install + overview |
| `GUIDE.md` | Legacy end-user usage guide (fallback for the in-app viewer) |
| `guide/<topic>.<lang>.md` | In-app help topics: `program` / `sync` / `notes` / `buddy` / `calendar`, each in `en` + `ka` — rendered by `GET /guide` |

---

## Launch layer

### `app.py`

1. Server in a daemon thread
2. Wait for the server to be ready (`/` ping)
3. **Background sync thread** — every 30s: push queue + pull deltas (quiet mode)
4. Open the window with pywebview — centered (ctypes GetSystemMetrics)
5. Under pythonw.exe stdout/stderr=None → automatic redirect to `app.log`

### `start.vbs`

```vbs
sh.Run """...pythonw.exe"" app.py", 0, False
```
Silent — no console, no taskbar flash.

---

## Sync layer (`sync.py`)

### Resource types

`["projects", "sections", "items", "labels", "notes", "reminders", "user"]`

### CLI commands

```
python sync.py init     — once, from scratch (schema + full pull)
python sync.py pull     — manual incremental pull (delta)
python sync.py push     — manual push pending_ops queue → Todoist
python sync.py queue    — view pending_ops
python sync.py status   — report
```

### Push flow (Phase 4)

1. `fetch_pending(conn, limit=100)` — top-100 from pending_ops
2. `build_commands(rows)` — Sync API command dicts (temp_id moved from args to command level)
3. `call_sync(sync_token, commands=...)` — POST batch
4. **`apply_temp_id_mapping`** — replaces local UUIDs with real IDs:
   - `tasks.id`, `tasks.parent_id`, `tasks.section_id`
   - `sections.id`
   - `task_local.task_id`
   - `comments.id`, `comments.task_id`
   - `pending_ops.args_json` (substring replace)
5. `apply_sync_status` — ok → DELETE pending_ops; error → attempts++ + last_error
6. `apply_resp` — apply the server's returned items/projects/etc. locally
7. Update `sync_token`

### Pull flow

`incremental_sync(quiet=False)` — `POST /sync` `sync_token={saved}` → `apply_resp` (delta only)

### Background loop (app.py)

```
while True:
    sleep(30)
    if pending_count > 0: push_queue(quiet=True)
    incremental_sync(quiet=True)
```

quiet=True — log only if something changed.

---

## SQLite schema (`triage.db`)

| Table | Columns |
|---|---|
| `projects` | id, name, color, parent_id, is_inbox, is_favorite, is_archived, is_deleted, view_style, child_order, is_collapsed |
| `sections` | id, project_id, name, section_order, is_collapsed/archived/deleted, timestamps |
| `tasks` | id, project_id, section_id, parent_id, content, description, priority (1-4), labels_json, due_*, deadline_*, duration_*, checked, child_order, timestamps, note_count |
| `labels` | id, name, color, item_order, is_favorite, is_deleted |
| `comments` | id, task_id, project_id, content, posted_at, posted_uid, **file_attachment** (JSON), is_deleted |
| `reminders` | id, item_id, type (relative/absolute/location), due_*, mm_offset, is_deleted |
| `sync_state` | key-value — sync_token, last_sync_at, last_full_sync |
| `pending_ops` | uuid, command_type, args_json, created_at, attempts, last_error |
| **`task_local`** | task_id PK, interpretation, review_status, suggested_label — **Todoister fields, not synced to Todoist** |

### Indexes

- `idx_sections_project`, `idx_tasks_project/section/parent/due/checked`, `idx_comments_task`, `idx_reminders_item`

### Migration

- `defaults(task)` — legacy RPG section (quest/active/boss → ""), done → completed=true
- `ensure_schema(conn)` in server.py — CREATE TABLE IF NOT EXISTS comments + reminders (for older DBs)

---

## Server endpoints (`server.py`)

| Method + path | What it does |
|---|---|
| `GET /` | `index.html` (302 → `/onboarding` if DB or token missing) |
| `GET /onboarding` | `onboarding.html` — first-run token form |
| `GET /api/setup-status` | `{has_db, has_token, ready}` |
| `GET /api/state` | `{tasks, projects, project_sections, labels, pending_count, sync_state}`. `labels`: `[{name, color}]` from the synced Todoist `labels` table — drives the label picker (no more hardcoded list) |
| `GET /api/completed[?cursor=]` | Reporting: a page of completed tasks from `tasks/completed/by_completion_date`, mirrored into the DB + enriched. `{items, next_cursor}` |
| `GET /api/attachment?u=URL` | Bearer-auth proxy for files (files.todoist.com / image-resize.todoist.com) |
| `GET /open-tz-help` / `/open-filters-help` / `/open-todoist-dev` | open a Todoist help/settings page in the system browser |
| `GET /i18n.js` | Language engine (static) |
| `GET /lang/<code>.json` | Language file (path-traversal protected) |
| `GET /guide?topic=&lang=` | Renders one help topic via `build_guide_page` — `guide/<topic>.<lang>.md` → styled HTML (markdown). Falls back `.<lang>` → `.en` → `GUIDE.md`. Topics: program/sync/notes/buddy/calendar |
| `POST /api/init` | onboarding: `{token}` → validate → write `.env` → `init_db` → `initial_sync`. On error returns `{error, error_key, error_args}` — onboarding translates `error_key` into the current language |
| `POST /api/sync` | manual push + pull (Phase 8 — retry by hand) |
| `POST /api/upload` | base64 file → Todoist `/uploads/` → metadata (5MB cap client-side) |
| `POST /api/update` | task field update (text, description, completed, priority, due_date, due_time, due_timezone, due_string, project, section, chosen_labels, interpretation, review_status) |
| `POST /api/subtask_add/_toggle/_del` | subtasks |
| `POST /api/task_add` | new task; response includes **`new_id`** (for file attachment) |
| `POST /api/task_duplicate/task_delete/task_move` | card operations |
| `POST /api/section_add/_rename/_delete/_reorder` | sections |
| `POST /api/task_reorder` | move a task up/down (child_order swap + item_reorder queue) |
| `POST /api/comment_add` | comment (text + optional file_attachment) |
| `POST /api/comment_delete` | comment soft delete |
| `POST /api/reminder_add/_delete` | reminders (Pro; UI disabled under Free-first) |
| `POST /api/refresh` | manual sync — push + pull (legacy alias for `/api/sync`) |
| `POST /api/all_done` | "ready" signal (log only) |

`sync_state` object: `{last_push_error, last_push_error_at, last_pull_error, last_pull_error_at, last_sync_at}`. The UI uses it to color the pending pill and wire onclick → `/api/sync`.

### Write path (Phase 3)

Every POST:
1. Update SQLite (immediate)
2. `queue_cmd(conn, type, args, coalesce_id=tid)` — append to `pending_ops`
3. **Coalesce**: 10 priority updates on the same task → 1 command (`item_update` merge)
4. **Cancel local**: deleting a just-created task → both records removed (never sent to Todoist)

### Field → Todoist command mapping

| Field | Sync API command |
|---|---|
| text/description/priority/chosen_labels | `item_update` (coalesced) |
| completed=true/false | `item_complete` / `item_uncomplete` |
| due_date/due_time/due_timezone | `item_update` `{due: {date}|{datetime, timezone?}}`. `split_due` parses a time embedded in `due_date` (Todoist's shape) and converts UTC→local; changing the date keeps the time. Clearing the date also drops any recurrence |
| due_string | `item_update` `{due: {string, ...}}` — recurrence. `task_due_obj` sends `string` **only** when it's a real recurrence (Todoist echoes plain dates back as `due_string` too) and embeds the time into it (`every day at 15:00`) so Todoist doesn't re-derive a timeless due. Moving the date past an `ending <date>` cap strips that clause |
| project | `item_move` `{project_id}` |
| section | `item_move` `{section_id}` or `{project_id}` |
| interpretation/review_status | — (local-only) |
| task_add | `item_add` `{temp_id, ...}` |
| task_duplicate | `item_add` (clone) |
| task_delete | `item_delete` (or cancel pending) |
| subtask_add | `item_add` `{parent_id}` |
| section_add/rename/delete/reorder | `section_add` / `section_update` / `section_delete` / `section_reorder` |
| comment_add | `note_add` `{item_id, content, file_attachment?}` |

---

## Data model (UI shape)

```json
{
  "id": "task uuid or Todoist id",
  "text": "content",
  "project": "Inbox",
  "section": "Focus",
  "completed": false,
  "completed_at": "",
  "priority": "P1",                // UI inversion: Todoist 4 ↔ UI P1
  "due_date": "2026-05-30",
  "due_time": "15:00",
  "due_string": "every Friday",
  "due_is_recurring": true,
  "due_timezone": "",              // "" = floating time, else an IANA zone
  "deadline_date": "",             // Pro
  "chosen_labels": ["..."],
  "subtasks": [
    {"id", "text", "done", "priority", "due_date", "due_time",
     "due_string", "due_is_recurring", "chosen_labels", "description"}
  ],
  "comments": [
    {"id", "content", "posted_at",
     "attachment": {file_name, file_size, image, tn_l, file_url, ...}}
  ],
  "reminders": [
    {"id", "type", "due_date", "due_time", "due_string", "mm_offset"}
  ],
  "description": "",
  "interpretation": "",            // Todoister local
  "review_status": ""              // Todoister local
}
```

### Priority inversion

| Todoist | UI |
|---|---|
| 4 (urgent) | "P1" |
| 3 | "P2" |
| 2 | "P3" |
| 1 (normal) | "P4" |

---

## UI architecture (`index.html`)

### Layout

```
┌─ topbar (none — pywebview chrome) ────────────────────────────┐
│ Sidebar (280px)             │ Main content                     │
│ ┌ User card                  │ ┌ #large-header                 │
│ │   Me                       │ │   h1 + ↻ + pending-pill + Display│
│ │ + Add task (red circle)   │ │   + search input               │
│ │ ─ filter_search            │ ├─────────────────────────────  │
│ │ ─ filter_inbox             │ │ #project-board-view            │
│ │ ─ filter_today             │ │   ┌ Board / List              │
│ │ ─ filter_upcoming          │ │   │                            │
│ │ ─ filter_completed         │ │                                │
│ │ ─ filters_labels           │ │                                │
│ │ ─ activity_log             │ │                                │
│ │                            │ │                                │
│ │ My Projects (collapsible)  │ │                                │
│ │   • Inbox                   │ │                                │
│ │   • Project ...             │ │                                │
└────────────────────────────┴────────────────────────────────────┘
```

### Views (`currentView`)

| View | What is shown | Render |
|---|---|---|
| `inbox` | Inbox project | Board (default) or List (toggle) |
| `project:NAME` | the given project | Board or List |
| `today` | due_date today + overdue | List |
| `upcoming` | due_date > today (sorted) | List |
| `filters` | Filters & Labels page (`renderFiltersLabelsPage`) | page |
| `label:NAME` / `filter:ID` | tasks matching a label / saved filter query | List |
| `completed` | **Reporting** — completed-task history (`renderReporting`) | page |

#### Reporting (`completed` view)

- `GET /api/completed[?cursor=]` → `sync.fetch_completed` calls Todoist
  `tasks/completed/by_completion_date` (last ~3 months, newest first, cursor
  pagination; `until` is padded +1 day so today is never cut off by the account's
  time zone). Each item is **upserted into the local DB** (`checked=1`) so it opens
  in the normal task modal, and enriched with project name/colour + `by_me`.
- `loadReporting()` fetches a page then calls `fetchState()`; the list renders from
  `completedTasks()` (state, `completed=true`, sorted by `completed_at` desc),
  grouped by day ("Today / Yesterday / weekday"), each row "You completed X · project
  · timeAgo" with the account avatar. Clicking a row opens the task modal; its
  checkbox reopens (uncompletes) the task. "Load more" follows the cursor.
- Faithful but decorative header controls (All workspaces / projects / Everyone,
  Export = Pro). No sidebar count badge (Todoist has none).

### Board view

- Horizontal sections (290px), `display:flex; align-items:stretch`
- Column — header (h3 + count + ⋯) / `.board-task-list[role=group]` (sizes to its
  cards: `flex:0 1 auto`) / `.board-add-wrap` footer (`flex:none`) with a red "+" Add
  task. Few cards → footer hugs the last card; full column → list scrolls, footer below
- "+ Add section" placeholder column at the end
- Vertical scroll inside a column (`overflow-y:auto`)
- **Drag & drop**: card is draggable, column is a drop target → `item_move` changes the section
- A section header is draggable too → `section_reorder` (before/after indicator on mouse-x)
- Completed tasks are not draggable

### List view (`list-mode` class)

- The whole viewport scrolls vertically
- Centered, 800px max
- In Today/Upcoming/Completed/Search — a project pill on the right

### Modal (task detail)

- Centered overlay (`modal-backdrop` + `modal`)
- Header: breadcrumb (project / section) | prev / next / more / close (real SVG icons)
- Body in 2 columns:
  - **Main**: checkbox (shows ✓ when completed) + title (textarea, auto-grow) +
    description + subtasks (rich: priority circle, date pill, labels, recurring icon,
    click → subtask modal) + **Comments** (image preview + lightbox + "+ Add comment"
    two-state form + 📎 attach)
  - **Side** — rebuilt as a faithful Todoist copy (`md-field` = title-case key + a
    clickable value, value-side icons, thin separators). Order: **Project, Date,
    Deadline, Priority, Labels, Reminders, Location**. Empty fields show a faint "+";
    Pro fields (Deadline/Reminders/Location) show a gold crown and are disabled.
    Each value opens a popover picker (`openModalProject/Date/Priority/Labels`); labels
    are individual chips with per-chip remove + an add (+) button.
  - The Megi-only additions (interpretation note, review status, calendar note) were
    removed — base is a clean Todoist copy first.

### Inline Add task form

- Multi-line textarea (Task name + Description), auto-grow
- Tool row: **📅 Date** (dropdown), **📎 Attach** (`<label for>` file input → /api/upload → chip), **🚩 Priority** (dropdown 4 options + checkmark), **⏰ Reminder** (Pro, disabled), **🏷 Labels** (dropdown of all labels, multi-select)
- **Label chips** — selected labels as chips below the description, × to remove
- **Attachment chip** — file_name + size + ×
- Project/Section dropdown in the footer (cascade options)
- **Add button** — `disabled` while Task name is empty
- **Date color**: Today green, Tomorrow orange, Future blue, Overdue red — applyInlineDate swaps the CSS class

### Dropdown popovers (Priority, Date, Labels)

- `positionPopover(el, triggerRect)` helper — tries below, flips above if it doesn't fit; clamps horizontally inside the viewport
- Outside click + Escape → close
- **Date scheduler** (compact, 250px — Todoist width) — full clone:
  - **"Type a date"** with natural-language parsing (`parseDateInput`, en + ka):
    today/tomorrow/yesterday/day-after-tomorrow, weekday names (next occurrence, `next …`), `dd.mm[.yyyy]`,
    `dd/mm`, `10 jun` / `jun 10` (localized month names too), `+N` / `in N days`, ISO. Live preview row
    as you type; red border + "couldn't read" instead of silent failure.
  - 4 quick options + month calendar (‹ › nav, current day red, the task's own
    date highlighted via `datePickCurrent` which also seeds the opening month).
  - Footer: **Time** and **Repeat** buttons → sub-popovers, and **No date**.
- **Time sub-popover** (`openTimePopover`) — Time field is a text input + a
  **15-minute scroll list** (`tpTimeOptionsHtml`, hidden until the field is clicked,
  prefilled to now rounded to :15 via `tpRoundNow`, free typing normalised by
  `normalizeTime`); Duration (No duration, Pro), Time zone (custom dropdown: Floating
  time + your current zone, each with a description + checkmark, + "Time Zones Help"
  link → `/open-tz-help`), Cancel / Save. Save writes `due_time` (+ `due_timezone`),
  defaulting the date to today if the task had none. `timePickFn`/`timePickCurrent`/
  `timePickTz` carry the per-open context; navCal keeps them on month change.
- **Repeat sub-popover** (`openRepeatPopover`) — presets (every day / week on
  weekday / weekday / month on Nth / year on date), each computed from the task's
  date, with a checkmark on the active one and a "No repeat" clear row. **Custom...**
  opens a centred dialog (`renderCustomRepeat`): Based on (scheduled vs `every!`
  completed) · Every N day/week/month/year · Ends (never / on date, floored at the
  task date). `buildCustomRepeat` emits the `due.string` (e.g. `every 2 weeks`,
  `every! day`, `… ending <ISO>`). `repeatPickFn`/`repeatPickCurrent`/`repeatAnchorISO`
  carry context; only an `every…` string counts as a recurrence (`isRecurrenceStr`),
  so a plain date echoed back by Todoist never shows in the Repeat slot.

### Context menu (Card ⋯)

Add task above/below | Edit | Date (T) | Priority (Y) | Move to ... | Duplicate | Delete (red)

### Help menu (sidebar)

- **Help & resources** button → `openHelpMenu`. The top item **"Todoister help"** (book icon, `›`) opens a flyout **submenu** to the side via `openTodoisterSubmenu` — reusing the same `#ctx-submenu` element as the card's "Move to ...".
- The submenu lists this app's own help topics (`HELP_TOPICS`: Program / Sync / Notes / Buddy / Calendar). Each → `openGuide(topic)`, which loads `/guide?topic=<topic>&lang=<I18N.lang>` into the guide overlay (iframe) — so the help follows the app language.
- Below a divider, the original Todoist Help & resources links (`HELP_ITEMS`) are kept as a faithful copy (external URLs).

### Smart polling

- Auto-polling (10s) runs only when idle:
  - no modal, no inline-add, no sub-add, no comment-add, no lightbox, no focused input/textarea
- Scroll preservation on render (board horizontal + columns vertical + list)

### Manual refresh

- ↻ button → `POST /api/refresh` → push + pull + return state
- Pending pill ("`N pending`") — number of unsent changes

---

## Attachment / Upload flow

### Upload (UI → Server → Todoist)

1. UI: 📎 → file picker → file selected
2. **Client-side size check**: > 5 MB → error (Todoist Free Tier limit)
3. `fileToBase64(file)` → base64 string
4. `POST /api/upload` `{filename, type, data}` (JSON)
5. Server: base64 decode → multipart to Todoist `/api/v1/uploads/` with Bearer auth
6. Response: file_attachment metadata (file_url, image, tn_l, file_size, ...)
7. Stored in the UI — pending attachment chip

### Comment with attachment

1. UI: submit comment → `POST /api/comment_add` `{id, text, attachment}`
2. Server: store `comments.file_attachment` + queue `note_add` (attachment in args)
3. Background push: Todoist Sync API → comment + attachment

### Add Task with attachment

1. UI: submit add task → `POST /api/task_add` → response includes `new_id`
2. UI: if attachment → `POST /api/comment_add` `{id: new_id, text: "", attachment}`
3. Both queued commands push at the next sync

### Display

- Image attachment in a comment → thumbnail `tn_l[0]` (528px Todoist-optimized) → via proxy (Bearer auth) → click → full-size lightbox
- Non-image — 📎 + file name + size, link in a new tab

---

## Live visibility (Todoister → files)

- **You → Todoister**: a change → triage.db (SQLite) + triage.log
  Monitor tails triage.log
- **Todoister → you**: Todoister writes to triage.db (interpretation/review_status — task_local table; **not synced to Todoist**)
  The UI's 10s smart poll picks it up

---

## Local-only Todoister layer

In the `task_local` table:
- `interpretation` — Todoister's note on a task
- `review_status` — "" | ok | help | leave
- `suggested_label` — Todoister's suggestion
- `sticky` — task shown as a super-priority sticky note (see "Sticky notes")
- `pinned` / `archived` — legacy columns, unused (Notebook pin/archive is section-based)

**Not synced to Todoist** — these fields are never pushed. Local mirror only.

---

## Sticky notes (super-priority, local)

A task can be pinned as a **sticky note** — a small card fixed at the top-centre of the
window, visible across every view, that stays until the task is completed.

- **Mark / unmark:** task ⋯ context menu → "Add / Remove sticky note" (`toggleSticky`).
  Stored in `task_local.sticky` via the generic `/api/update` field path (local only —
  not pushed to Todoist, so not cross-device).
- **Limit:** max 2 (`STICKY_MAX`). A 3rd attempt shows a warning toast (`sticky.limit`).
- **Render:** `renderStickies()` (called from `render()`) fills `#sticky-layer`
  (`position:fixed`, centred row, `z-index:90` — above content, below dialogs/menus).
  Each note has: a "!" badge, a checkbox (→ `completeTask`, which removes it and shows
  the completion toast), the title (→ `openModal`), and a "×" (unstick only — keeps the task).
- **Look:** the app's brand green (#637760), muted; amber "!" badge for attention.

### Completion toast

`completeTask` shows a single two-line toast on completion (bottom-left): a congratulatory
title plus, for a recurring task, the next-occurrence pattern (`repeatLabel(due_string)`).
Per-edit changes no longer toast — undo lives on the ↶/↷ buttons + `Ctrl+Z` / `Ctrl+Y`.

---

## i18n (language system)

- **Files:** `i18n.js` (engine) + `lang/en.json` + `lang/ka.json` (same keys, ~197). English = canonical
- **API:** `window.I18N` — `t(key, vars)` (`{n}` interpolation), `list(key)` (comma→array, date names), `apply(root)` (DOM `data-i18n` / `-ph` / `-title` / `-html`), `setLang(code)`, `toggle()`, `onChange(fn)`
- **Default language:** English; `localStorage.lang` stores the choice. Language button in the sidebar + onboarding
- **Usage (index.html):** alias `tr()` (since `t` is the task variable); static HTML → `data-i18n`; dynamic JS → `tr("key", {vars})`
- **React (notebooks):** `tr()` reads `window.I18N`; `I18N.onChange` → re-render. **Rebuild required** (`node build.mjs`)
- **Backend:** `/api/init` error → `error_key` + `error_args`; the frontend translates
- **Bootstrap:** `I18N.init()` (lang fetch) → `apply()` → `fetchState()`
- ❗ `server.py` routes `/i18n.js` + `/lang/*.json`; after a change, **restart** the server (orphan process race — closing the window doesn't kill the process → port taken → old code serves 404 → raw keys show in the UI. fix: `taskkill //PID <pid> //F`)
- **Todoist fidelity:** terms were aligned with real snapshots — `Desktop/todoist-ref/_COMPARISON.md` + `_FIDELITY.md`. **Free-first** — Pro features are not added

---

## Free-first behaviour (2026-06-04)

- **Deadline / Reminders** — in the modal: **disabled + a yellow (Pro) badge** (#ffba0a; like Todoist Free's upgrade icon). Would work with a Pro token, but not enabled for now
- **Reschedule** — a Today-view header button (when overdue > 0). Opens the date picker (`openDatePicker(anchorId, fn)` — reusable via callback; `datePickFn` global). On a chosen date → batch-update all overdue tasks
- **Postpone** — deliberately skipped (a Today-specific micro-feature; Tomorrow already exists)

---

## Known limitations

- File attachments **5MB** (Todoist Free Tier; Pro = 100MB — hardcoded)
- Deadline, Reminders — Pro features, **disabled** in the modal (Free-first, above)
- Search covers task text, description, labels, project name, section name, subtasks and comments (`visibleTasks()`)
- Comment image previews — image-resize.todoist.com URLs sometimes return 501; we load the real file via Bearer auth
- Single user (local SQLite)
- Background sync 30s → max delay for asynchronous changes

---

## Target workflow

```
change in the window → SQLite save → pending_ops queue
                                            │ ≤30s
                                            ▼
                              Todoist Sync API (batch)
                                            │
change on phone → Todoist                   ▼
                            ↓        sync_token advance
                            └─→ background pull (30s)
                                            │
                                            ▼
                                       SQLite update
                                            │ ≤10s
                                            ▼
                                      UI smart poll
                                            │
                                            ▼
                                     shows on screen
```

End-to-end latency: 0-30s outbound, 0-40s inbound.

---

# Notebook — BlockNote editor

A layer built on top of Todoister: tasks in the Todoist "Notebook" project show up
as **note pages** (Notion/Bear style) with a live markdown editor. It has **no
sync of its own** — it reuses Todoister's existing SQLite + Sync API infrastructure.

## Provisioning & recognition (a real Todoist project)

Notes are **not local-only** — they live in a real Todoist project literally named
`Notebook` (constant `NOTEBOOK_PROJECT` in `index.html`). Everything keys off that
**exact name**: `state.filter(t => t.project === "Notebook")`, `projectSections["Notebook"]`,
the pinned sidebar row, etc.

Consequences of this design:

- **Cross-device:** because it's a synced Todoist project, connecting the same
  account from any other computer/phone pulls the `Notebook` project (and all note
  pages + sections) on the initial sync, and the app recognises it automatically by
  name. No local migration needed. (A local-only notebook would *not* travel.)
- **Costs a Free slot:** it counts as one of the 5 Free-tier projects, so it is
  **opt-in**, never auto-created.
- **Rename is blocked** in the UI — renaming the project would break recognition on
  every device. The `⋯` menu therefore offers only archive/delete, not edit.

**Lifecycle (all in `index.html`):**

| State | Sidebar | Action |
|---|---|---|
| Doesn't exist | muted "Enable notes" row (`notes.enable`) | `enableNotes()` → `project_add {name:"Notebook"}` (blocked with `notes.limit` toast if 5 slots full) |
| Active | pinned top, notebook icon, divider below | `⋯` → `openNotebookMenu`: Archive or Delete |
| Archived | "Enable notes" row again | `enableNotes()` → `project_unarchive` (restores, never duplicates) |

Pinned + special in **both** the sidebar (`renderSidebar`) and the My Projects page
(`ppRow`); excluded from drag-reorder (`submitProjectReorder`). Onboarding-time
opt-in is a TODO (see `TODO.md`).

## 3 layers

```
┌─ Todoister (host) — vanilla JS (index.html) ──────────────────┐
│  • existing Todoist sync (SQLite triage.db + 30s + Sync API) │
│  • window.NB bridge                                          │
│  • #notebook-view (React mount point)                        │
└──────────────────────────┬───────────────────────────────────┘
                           │ window.NB.*
                           ▼
┌─ Notebook app — React + BlockNote (notebook-assets/bundle.js) ┐
│  • editor + sidebar + ⋯ menu + bottom bar + files strip      │
│  • source: triage/notebooks/app/ → esbuild → bundle.js+.css  │
└──────────────────────────┬───────────────────────────────────┘
                           │ /api/* (POST)
                           ▼
              server.py → SQLite → Todoist queue (sync 30s)
```

React **never talks to Todoist directly** — everything goes through the
`window.NB` bridge → `/api/*` → SQLite + queue.

## Files

| File | Role |
|---|---|
| `triage/notebooks/app/src/main.jsx` | React app (App, Editor, FilesStrip, CardMenu, DatePicker, Icon) |
| `triage/notebooks/app/src/app.css` | Notebook styles (`.nb-*` prefix + BlockNote overrides) |
| `triage/notebooks/app/build.mjs` | esbuild bundle script |
| `triage/notebooks/app/package.json` | deps: react, react-dom, @blocknote/{core,react,mantine}, @floating-ui/react, esbuild |
| `triage/notebook-assets/bundle.js` | built bundle (~1.7MB) — served by the server |
| `triage/notebook-assets/bundle.css` | built CSS (~230KB) |
| `triage/index.html` | `window.NB` bridge + `#notebook-view` + renderContent hook |

The React source now lives **inside** the repo (`triage/notebooks/app/`); `node_modules/`
is gitignored. (It used to sit outside the repo, so only the built bundle was tracked.)

## Build

```
cd triage/notebooks/app && node build.mjs
```
- entry `src/main.jsx` → `../../notebook-assets/bundle.js` + `bundle.css`
- esbuild conditions: `['style','browser','import','default']` (for BlockNote CSS)
- ⚠️ after a change: build + `Ctrl+Shift+R` in the browser (cache)

## Integration points (`index.html`)

1. `<head>`: `<link rel="stylesheet" href="notebook-assets/bundle.css">`
2. before `</body>`: `<script src="notebook-assets/bundle.js"></script>`
3. next to `#project-board-view`: `<div id="notebook-view"><div id="notebook-root"></div></div>`
4. `renderContent()`: if `currentView === "project:Notebook"` → hide board, show notebook-view, `ensureNotebookMounted()`, `NB.notify()`
5. the `window.NB` bridge object (before renderContent)

## `window.NB` bridge API

| Method | What it does |
|---|---|
| `list()` | Notebook tasks → pages (`{id,title,body,section,priority,due_date,pinned,archived,labels}`) |
| `sections()` | regular sections (excludes pin/archive, matched by emoji prefix) |
| `allLabels()` | all used labels (unique from state) |
| `subscribe(fn)` / `notify()` | React subscription; `notify` returns `{notes, sections}` |
| `saveTitle(id,t)` / `saveBody(id,b)` | content / description update |
| `create()` | new task in Notebook → `{id,title,body}` |
| `del(id)` | task delete |
| `setPriority(id,p)` / `setLabels(id,arr)` | priority / chosen_labels |
| `setDueDate(id,date)` | due_date |
| `reorder(id,dir)` | ↑/↓ (`/api/task_reorder`) |
| `moveToSection(id,sec)` | section move |
| `addSection(name)` | section_add + `reorderSpecial()` |
| `ensureSpecialSection(emoji, i18nKey)` | reuse the section starting with `emoji`, else create one named `tr(i18nKey)` |
| `setPinned(id,val)` | val → ensureSpecialSection(📌)+move+reorderSpecial; false → section="" |
| `setArchived(id,val)` | val → ensureSpecialSection(📥)+move+reorderSpecial; false → section="" |
| `reorderSpecial()` | section_reorder: pin first, regular, archive last (matched by emoji) |
| `uploadImage(file)` | 5MB cap → `/api/upload` → `/api/attachment?u=URL` (proxy) — used by BlockNote's in-editor image block |
| `uploadFile(file)` | 5MB cap → `/api/upload` → full Todoist file_attachment metadata (for the Files strip) |
| `addComment(id,text,att)` / `deleteComment(cid)` | attachment storage (Todoist comment = `note_add`); the Files strip lists comments that have an attachment |
| `exportFile(name,b64,mode)` | `/api/export_open` → server writes the file + opens browser/folder |
| `setDueTime(id,time)` | due time |
| `renameSection` / `deleteSection` / `sortSection` / `moveSection` | section ⋯ menu ops |
| `duplicate(id)` | task duplicate |

## Data model (page ↔ Todoist task)

| Page | Todoist |
|---|---|
| title | `content` (a separate field in the UI, not deletable) |
| text (markdown) | `description` (BlockNote in/out) |
| group | `section` |
| color | `priority` (P1-P4, left border on the card) |
| label | `labels` (chosen_labels) |
| date | `due_date` |

## pin / archive — our own feature on Todoist

Pin/Archive is **not** a Todoist original — it is Todoister's own feature that
auto-creates a Todoist section.

- The section is created **in the user's current language at creation time**
  (`tr("nb.group_pinned")` / `tr("nb.group_archived")` — e.g. "📌 Pinned" /
  "📥 Archive" in English, localized per language).
- **Matching is by emoji prefix** (`startsWith("📌")` / `"📥"`), not by exact
  text. So when the language changes, the existing section is still recognized,
  is **never renamed and never duplicated** (`findSpecialSection(emoji)` reuse +
  `ensureSpecialSection(emoji, i18nKey)` create).
- After every pin/archive/section-add, `reorderSpecial()` → 📌 **always first**,
  📥 **always last** (in Todoist and on the phone too).
- In the app: pinned/archived = derived from the section; an empty special
  section is hidden.
- restore = move the page to another section (drag or ⋯) → section changes,
  pinned/archived clears.
- The notebook group **header** is localized via `tr` and follows the UI
  language; the Todoist **section name** (seen in board view / on the phone) is
  frozen at creation.

## UI

- **Sidebar top tools**: two compact icon buttons — **new page** (file icon) and **new
  section** (folder icon) — each with a small green-circle white-`+` badge. New page
  creates immediately; new section reveals an inline name field just below. (Replaced the
  old full-width `+ New page` row + bottom `+ New section` button.)
- **Sidebar list**: loose pages (no section) render plainly — no band, no header · sections
  are background bands (pin first / regular / archive last, collapsible); each section header
  has a brand-green `+` (add a page into it) next to `⋯`. A page is draggable (drag → section /
  pin). Each card shows title · a **paperclip badge if the page has file attachments** · priority
  dot · `⋯`, then a preview and a meta line (date + label chips). Brand green = `--nb-brand` #637760
- **Top bar**: ↶ undo · ↷ redo · (spacer) · ✓/↻ save icon. (The markdown-import button was
  removed — Ctrl+V pastes/parses markdown natively; export moved to the bottom bar.) **Exception —
  inside a code block** the custom `pasteHandler` skips markdown parsing entirely and inserts the
  clipboard **verbatim** (`editor.pasteText`): every character lands as copied, ``` fences
  included, and it never spawns a new block on the page. The block is a "dumb" container.
- **Editor**: separate title input (focus → select all) + label chips + BlockNote. On open the
  cursor is parked in the first **text** block (`parkCursor`), so a leading/only image isn't
  auto-selected (which used to pop BlockNote's replace-file toolbar). The **"/" menu** (also
  opened by the side **+** button) is a custom `SuggestionMenuController` (`slashMenu={false}`
  disables the built-in one): its floating middleware is bounded to `.nb-editor-area` (`slashBoundary`),
  so near the bottom it flips **above** the cursor and stops at the top toolbar instead of
  shrinking into a tiny scroll box (the default capped height against the whole window). Needs
  `@floating-ui/react`.
- **Files strip** (above the bottom bar): renders **only when the page has attachments**. Compact
  file chips (thumbnail/icon + name + ×), label-sized. Files are stored as Todoist comments under
  the hood, but the page presents them purely as "files" — text-only comments are not surfaced.
- **Bottom bar (Keep style, lucide icons, compact)**: 📅 date · ⚑ color · 🏷 label · 📎 attach file
  | 📌 pin · ⤴ move · ⧉ duplicate · 📥 archive · ⬇ export | (spacer) · 🗑 delete (tinted red). The
  paperclip attaches a file straight to the Files strip (no inline/below chooser). Export opens a
  small menu **above** the button (browser HTML / Markdown).
- **⋯ menu**: 📌 pin · 📥 archive · ↑ up ↓ down · section › (lists sections + **New section…** to
  create one and move the page into it) · edit · duplicate · priority-color › · labels › · delete
- **Icons**: lucide (inline SVG, `Icon` component) — in the style of Todoister's `const SVG`

## Limitations

- Reminder notifications — rejected by Todoist Free (due_date only)
- Drawing / sharing / Google Docs / change history — out of scope (don't fit Todoist)
- Image 5MB (Todoist Free Tier)
- `task_local.pinned/archived` fields exist but are **no longer used** (pin/archive became section-based)
