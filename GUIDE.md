# Todoister — Guide

## What this is

Todoister is **not** a Todoist clone for its own sake. It is a personal
task-management command center where an AI assistant (driven through Claude Code)
has **full, live control of your Todoist account**. You are the architect — you
say what you want; the assistant does it, directly on your tasks.

The Todoist-style interface you see is the *cockpit*. The engine is the
assistant plus a set of custom layers built on top. Everything you do here syncs
straight to Todoist (phone, web) — this is not a separate local system.

## Why it exists

1. **Full live control of Todoist by the assistant.** It can add, edit, complete,
   delete and duplicate tasks; set priority, date/time and labels; manage
   subtasks; move tasks between projects and sections; create, rename, reorder
   and delete sections; add comments and file attachments; reschedule overdue
   tasks; search everything. Every change is pushed to Todoist immediately.
2. **The assistant as your task AI** — it organizes tasks, assigns priorities and
   awards bonus XP, in place of Todoist's own AI.
3. **Custom tools you actually want** — e.g. a button that sends the assistant
   your opinion about a specific task.
4. **Notes** — Todoist plus a real note-taking layer.
5. **Gamification** — a little dragon you grow with points from completed tasks
   (work in progress).
6. **Google Calendar + the full range of reminders** through it (a Todoist Pro
   capability, for free — still a concept).
7. **Fully controllable translation** of the whole app.
8. **Your own filters and views**, beyond the Todoist Free-tier limits.

And the meta-point: because the assistant writes the code, **any tool you can
imagine can be built on request.** The app grows around your needs.

---

## How to use it

### Launch

1. Double-click **`start.vbs`** (silent, no console) — the main way to run.
2. Use **`start.bat`** instead to see a console for errors (debugging).
3. The app opens in its own native window — no browser needed.

To quit, close the window.

### First run

1. In Todoist, open `Settings → Integrations → Developer` and copy your API token.
2. Paste it and click **Start**.
3. Initial sync downloads all your projects, sections and tasks (~10-30s).
4. The token is saved to `.env`; you won't be asked again.

### The interface

- **Sidebar** — Inbox, Today, your projects, labels, Completed, the language
  toggle (English ↔ Georgian), and **Help & resources** at the bottom (with a
  link to this guide).
- **Main area** — **Board view** (Kanban columns per section) or **List view**;
  toggle in the header.

### Tasks

- **Add** — the "+ Add task" row at the top of a list/column.
- **Open** — click a task for the detail modal: title, description, priority,
  date & time, labels, subtasks, comments.
- **Quick edits** — date pickers, a priority dropdown (P1–P4) and a labels
  dropdown, inline and in the modal.
- **Drag & drop** — move tasks between sections; drag a section header to reorder.
- **Add / rename a section** — inline, in place (no popup dialog).
- **Search** — `Ctrl+F`; covers task text, descriptions, labels, project/section
  names, subtasks and comments.
- **Completed** — finished tasks move to the Completed view.
- **Reschedule** — in Today, when there are overdue tasks, move them all at once.
- **Sticky notes** — from a task's **"⋯"** menu, "Add sticky note" pins it (up to 2)
  as a super-priority card fixed at the top of the window; it stays in every view
  until you complete it (or remove the sticky with "×").

Priority colors: P1 red, P2 orange, P3 blue, P4 none.

### Notebook (notes)

Open the **Notebook** project for the notes view — each task is a note page in a
rich BlockNote editor (headings, lists, tables, images).

- **Sections** — group pages into sections. Each section header has a **"+"** to add
  a page and a **"⋯"** menu (rename, add above/below, reorder, sort, colour, delete).
  Loose pages with no section sit in a faint band above the sections.
- **Per-page actions** (bottom bar): date & **time**, priority colour, labels,
  **attach a file** (any file — images embed in the page, other files become a
  download link), pin, move to a section, duplicate, archive, delete.
- **Pin / archive** — the section is created in your current language and matched by
  its emoji, so switching language never renames or duplicates it.
- Uploads up to 5MB.

### Sync

- Local edits are written instantly and queued, so the UI never waits on the
  network.
- A background thread pushes the queue to Todoist every 30s, then pulls changes
  made on other devices.
- If Todoist is unreachable, an "offline" pill appears — click it to retry.

### Free Tier

Todoister targets the Todoist **Free Tier**: Deadlines and custom Reminders are
shown but disabled (marked Pro); file uploads are capped at 5MB. The Pro-style
capabilities in the vision above (e.g. Google Calendar reminders) are added by
us, on top — not taken from Todoist Pro.

For install details and the technical design, see
[README.md](README.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
