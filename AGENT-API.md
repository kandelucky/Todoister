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
- `log` = what the user decided on standard actions (accepted / changed with `changes` diff / rejected) — read it to learn.
- `trigger_at` non-empty → re-analyse the Inbox now (`GET /api/state` → tasks with `project == "Inbox"` and no `agent_proposal`).

## 3. Finish a batch — `POST /api/agent_done`
```json
{ "agent": "kiki", "batch_id": "b89710d261fb" }      // or "batch_id": "all"
```
Marks the batch done; the panel unlocks and re-renders (toast „პასუხი მოვიდა").

## 4. Read tasks — `GET /api/state`
Every task carries `agent_status`, `agent_proposal` (object or null), `agent_decided_at`,
`postpone_count` (from the Todoist label `(+n)`); the response has a global
`agent: {connected, busy, name, last_seen, last_analysis, open_batches, queued}`.
Standard task endpoints you may use: `POST /api/update {id, field, value}`
(fields: text · description · priority · due_date · due_time · project · section · chosen_labels …),
`POST /api/subtask_add {id, text}`, `POST /api/task_delete {id}`.

## Status values (`task_local.agent_status`)
`""` · `proposed` · `accepted` · `changed` · `rejected` · `split` · `queued` · `done`

## Endpoints the panel itself uses (for completeness)
`POST /api/agent_status {id, status, changes, verdict, tab}` (panel records the user's decision) ·
`POST /api/agent_queue {active:[…], triage:[…], agent}` (the one button; returns `batch_id`) ·
`POST /api/agent_trigger {}` („ხელახლა გაანალიზე").
