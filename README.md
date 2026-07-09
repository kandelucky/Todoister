# Todoister

A **free, open-source** native alternative to Todoist for Windows — and where it's headed.

---

## What it is

Todoister is a native Todoist client for Windows: fast, offline-first, in a real
window (no browser, no Electron), with full two-way sync.

The point isn't to copy Todoist. The point is that **the code is free and open.**
Todoist is closed and paid; this is yours — read it, use it, change it.

---

## What it has today

- **Free & open source** — the whole thing, yours to use and modify
- **A faithful Todoist client** — board, list, filters, tasks, live two-way sync
- **Notebook** — a place for real notes (text, images) that Todoist doesn't have,
  synced across all your devices
- **Sticky notes** — pin up to 2 tasks as super-priority notes that stay on screen,
  in every view, until you complete them
- **Undo / redo** — up to 100 steps, for tasks *and* notes (`Ctrl+Z` / `Ctrl+Y`)
- **Full translation support** — the entire interface translates through a single
  language file, into any language

---

## On the roadmap

- **Full Google Calendar sync** — tasks with a date and time become calendar events
- **An AI bridge & tools** — a live connection for an AI assistant (Claude Code or
  similar) to drive your tasks directly
- **A companion** — a small creature that grows with how many tasks you complete

---

## Quick start

1. Install the one dependency:
   ```
   pip install pywebview
   ```
2. Create your launcher once:
   ```
   copy start.vbs.example start.vbs
   ```
3. Double-click **start.vbs**.
4. Paste your Todoist API token
   (Todoist → Settings → Integrations → Developer) and click **Start**.

Your token is saved locally to `.env` — you only enter it once. On first run the
app pulls your full Todoist account into a local SQLite mirror; after that it
syncs incrementally every 30 seconds and on every change.

---

## How it works

```
Native window (WebView2 · index.html)
        |  fetch / POST  ->  localhost:8765
        v
server.py  -- reads/writes -->  triage.db (SQLite mirror)
        |                              |
        |                              v  background thread (30s)
        +--------------------->  sync.py  -- Todoist Sync API v1
                                        push queued changes · pull updates
```

Full details in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Documentation

- **[GUIDE.md](GUIDE.md)** — how to use every part of the app
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it's built under the hood
- **[TODO.md](TODO.md)** — what's coming next

---

## Support

If Todoister makes your day a little easier,
[buy me a coffee](https://buymeacoffee.com/Kandelucky_dev).

## License

MIT — do whatever you want.
