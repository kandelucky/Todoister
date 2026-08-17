# Todoister — AI Agent Panel: the contract for agents

Todoister has a view **„AI აგენტის პანელი"** (AI Agent Panel). It is a bridge: an AI agent
(v1 = კიკი, but any agent that speaks HTTP JSON to `localhost` works — Claude Code, Codex CLI,
Gemini CLI, a local Ollama agent, later an MCP wrapper) reads Inbox captures, writes proposals,
and receives what the user sends back with „გადაამოწმე (N)". Everything is plain JSON over
`http://127.0.0.1:<PORT>` (the port Todoister prints at start; default in `store.PORT`).

Cloud chat UIs (ChatGPT / Gemini web) cannot reach localhost — do not tunnel Todoister to the
internet for them.

## Presence — how the panel knows you are there
`GET /api/agent_queue?agent=<name>` is your poll **and** your heartbeat. Poll every 20–30 s.
- connected = last poll < 60 s ago → the sidebar item is enabled.
- no poll for 60 s → the panel is disabled; anything queued simply waits in the DB.
- busy = an open batch exists **and** you are connected → the panel is locked („მუშავდება")
  until you `POST /api/agent_done`.
Always send your `agent` name (`kiki`, `codex`, …) — the panel shows who is connected.

## 1. Write a proposal — `POST /api/agent_propose`
```json
{ "agent": "kiki", "id": "<task_id>", "proposal": { …schema below… } }
{ "agent": "kiki", "proposals": [ { "id": "…", "proposal": {…} }, … ] }      // batch form
```
Sets `task_local.agent_status = "proposed"`; the task appears on tab **დაუხარისხებელი**.
**Inbox only** (Lasha, 2026-08-17): a proposal for a task outside the Inbox project is refused —
the response lists it in `skipped: [{id, reason: "not_inbox"}]` (other reasons: `not_found`,
`deleted_pending` = the user marked it for deletion, wait for the round to close; `completed` =
the task is already done, nothing to triage). Overdue /
today / other-project work belongs to tab „აქტიური" (stage 3), not here.
Response: `{ok, proposed: n, skipped: […]}`.
Proposal schema:
```json
{ "read": "one sentence: how you read the capture (no name prefix)",
  "type": "simple | complex | info | note",
  "title": "optional cleaned title (original goes to description when empty)",
  "project": "project name (default = task's project)",
  "section": "section name, or 'Project / Section', or ''",
  "priority": "P1 | P2 | P3 | P4",
  "due": "YYYY-MM-DD | today | tomorrow | +Nd | ''",
  "time": "HH:MM or ''",
  "labels": ["label", …],
  "subtasks": ["…", …],
  "merge_into": "<other task_id> (optional: becomes a subtask of that task)",
  "complete": "true (optional): the capture is already done → „შესრულდა' becomes the card's main button (ვეთანხმები moves into „მეტი'); it only completes the task, no other field is written",
  "confidence": "high | mid | low",
  "questions": ["only when confidence is low"],
  "made_at": "ISO (filled by the server when missing)" }
```

## 2. Read what the user sent — `GET /api/agent_queue`
Query: `agent=<name>` · `status=queued|waiting|done|all` (default = not done) · `since=<ISO>`
(log entries after that moment).
```json
{ "ok": true, "server_time": "…",
  "agent": { "connected": true, "busy": true, "name": "kiki", "last_seen": "…", "last_analysis": "…", "open_batches": ["b89710d261fb"], "queued": 2 },
  "queue": [ { "id": 1, "batch_id": "b89…", "task_id": "…", "tab": "triage|active", "status": "queued",
               "created_at": "…", "item": { "task_id": "…", "action": "split|null", "flag": true, "proposal": {…}, "changes": {…}|null, "decision": "…", "comment": "…"|null } } ],
  "open_batches": ["b89…"],
  "log": [ { "at": "…", "task_id": "…", "event": "accepted|changed|rejected|undo|queue|done|trigger", "data": {…} } ],
  "trigger_at": "ISO or '' — the user pressed „ხელახლა გაანალიზე'; consumed once" }
```
- `queue` = agent work: `action:"split"` (დაშალე → add subtasks / re-propose), `flag` („?" — something is off), `comment` (free text). Do it if clear (subtasks via `POST /api/subtask_add {id,text}`, new proposal via `agent_propose`); ask the user in chat if unclear.
- `log` = what the user decided on standard actions — read it to learn: `accepted` · `changed` (with `changes` diff **and** `proposal` = the user's edited version) · `completed` („შესრულდა" — the task was already done; `proposal` = what you proposed, so you learn when to send `complete: true`) · `rejected` (data.status `deleted_pending` = marked for deletion, still undoable) · `deleted` (the round closed, the task is really gone) · `undo` (the user took a decision back) · `split` (დაშალე marked; the item itself arrives in `queue` when the user sends) · `queue` · `done` · `round_close` · `trigger`.
- `trigger_at` non-empty → re-analyse the Inbox now (`GET /api/state` → tasks with `project == "Inbox"` and no `agent_proposal`).

## 3. Finish a batch — `POST /api/agent_done`
```json
{ "agent": "kiki", "batch_id": "b89710d261fb" }      // or "batch_id": "all"
```
Marks the batch done; the panel unlocks and re-renders (toast „პასუხი მოვიდა").

## 4. Read tasks — `GET /api/state`
Every task carries `agent_status`, `agent_proposal` (object or null), `agent_decided_at`,
`agent_decision` (object or null — the panel's own undo recipe `{kind, changes, recipe}`; the
recipe holds the old values, i.e. the snapshot before the accept), `postpone_count` (from the
Todoist label `(+n)`); the response has a global
`agent: {connected, busy, name, last_seen, last_analysis, open_batches, queued, round_closed_at, pending_deletes}`.
- `pending_deletes` = tasks the user marked „წაშალე" on the panel: they are **not** in `tasks`
  (hidden from every app view) and not yet deleted on Todoist; the real delete runs when the
  round closes. Do not propose for them; do not touch them.
- `round_closed_at` = ISO of the last round close. A card decided after that moment is still
  on tab 2 (dimmed, undoable); older decisions are final.
Standard task endpoints you may use: `POST /api/update {id, field, value}`
(fields: text · description · priority · due_date · due_time · project · section · chosen_labels …),
`POST /api/subtask_add {id, text}`, `POST /api/task_delete {id}`.

## Status values (`task_local.agent_status`)
`""` · `proposed` · `accepted` · `changed` · `completed` · `rejected` · `split` · `queued` · `done` · `deleted_pending`
(`deleted_pending` → `rejected` when the round closes; undo before that → `proposed`; `completed` = the
user pressed „შესრულდა" — the task is checked off in Todoist right away, undo → `proposed` + reopened).

## The round (how the panel behaves, 2026-08-17)
Cards never move: the order is frozen when a card first shows, new proposals append at the end.
A decided card (ვეთანხმები / შესრულდა / წაშალე / დაშალე) stays in place, dimmed, with its verdict and an
undo button, until the user closes the round with the one button — „გადაამოწმე (N)" when
something goes to you, „დაასრულე" when only decisions wait. Closing = `POST /api/agent_round_close`:
deferred deletes become real deletes (log `deleted`), `round_closed_at` moves, decided cards leave
the tab. Decisions survive an app restart (they live in the DB, not in the browser).

## Endpoints the panel itself uses (for completeness)
`POST /api/agent_status {id, status, changes, verdict, tab, decision, proposal}` (panel records the user's decision) ·
`POST /api/agent_queue {active:[…], triage:[…], agent}` (the one button; returns `batch_id`) ·
`POST /api/agent_round_close {}` (returns `{deleted:[{id, subs, text}], closed_at}`) ·
`POST /api/agent_trigger {}` („ხელახლა გაანალიზე").
What each panel action writes: ვეთანხმები = `POST /api/update` per changed field (project → section →
priority → due_date → due_time → chosen_labels → text/description) + `subtask_add` per subtask +
on merge `subtask_add` on the target + `task_delete` of the card, then `agent_status accepted|changed`
with the recipe. შესრულდა = `POST /api/update {id, field:"completed", value:true}` (the app's own completion,
synced as `item_complete`) + `agent_status completed`; nothing else is written even when the proposal carries
other fields. წაშალე = `agent_status deleted_pending` only (real `task_delete` at round close).
დაშალე = `agent_status split`, item sent with „გადაამოწმე". Undo = the reverse calls + `agent_status proposed`.
