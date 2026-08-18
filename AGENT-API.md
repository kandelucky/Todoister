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
- connected = last poll < 60 s ago.
- known = some agent has connected at least once (`agent_name` set) → the sidebar item is enabled;
  before that (fresh install, no agent ever) it is disabled.
- **offline** = known but no poll for 60 s (B3, Lasha 2026-08-17): the panel stays usable — the
  standard actions (ვეთანხმები · შესრულდა · წაშალე · undo) and the round close („დაასრულე") work
  without you (they use the app's own endpoints; read the `log` since your last poll when you are
  back); only the agent actions (დაშალე · „?" · comment · „გადაამოწმე (N)") are locked until you
  return — drafts and დაშალე marks stay (a card with `agent_status = split` stays on tab 2 until it
  is sent, regardless of rounds). A strip above the tabs says „აგენტი ხაზზე არ არის". Anything
  already queued simply waits in the DB.
- busy = an open batch exists **and** you are connected → the panel is locked („მუშავდება")
  until you `POST /api/agent_done`.
Always send your `agent` name (`kiki`, `codex`, …) — the panel shows who is connected.

## Duty session — several sessions of one agent (2026-08-18, Kiki's letter №2 §1, Lasha's yes)
Lasha often has 2–3 sessions of the same agent open; each may run the poller. The server decides
who works — not your code:
- Make up a session id at start and send it on every poll: `GET /api/agent_queue?agent=kiki&session=<uuid>`.
  Presence is kept per (agent, session); a session silent for 60 s is forgotten.
- **The first live session is on duty**; every poll renews its lease; when it stays silent for 60 s the
  lease is free and the next poller takes it. Explicit takeover (Lasha told THIS session to be the
  secretary): `POST /api/agent_take {agent, session}` → `{ok, duty, on_duty:true, sessions}`.
- **Only the duty session** gets `queue` rows and the `trigger_at`; every other session gets
  `queue: []` and `trigger_at: ""` (the log, `open_batches` and presence are for everyone).
  `POST /api/agent_done` from a session that is **not** on duty while another live session holds it →
  `{ok:false, error:"not_on_duty", duty:{agent, session, since}}` and nothing changes; if nobody alive holds
  the duty, the finisher takes it. `agent_propose` stays open to every session (harmless).
- Every poll answers `session`, `on_duty: true|false`, `duty: {agent, session, since} | null`, `sessions: n`
  (live sessions, all agents); `/api/state` → `agent.duty` + `agent.sessions`. The panel header shows
  „kiki — მორიგე სესია (2 ხაზზე)" when more than one session is online.
- A poll **without** `session` is session `""` — one more session, nothing special (old pollers keep working).
- Two different agents at once (kiki + codex): one duty globally, first come (v1).
- Not on duty → stand down: heartbeat only, don't act on the log; log event `duty` (`data: {agent, session,
  takeover, prev, prev_expired}`) tells you when the lease moved.

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
  "due_string": "recurrence in Todoist grammar, English: 'every wednesday at 20:00' · 'every 20th at 10:00' · 'every day ending 2026-12-31' (optional; must start with 'every'; '' = no recurrence; the user can change it in the date chip's Repeat slot)",
  "description_append": "text added to the task's description as a new paragraph on accept (optional; never replaces what is there — a cleaned title still puts the original text in first)",
  "labels": ["label", …],
  "subtasks": ["…", …],
  "merge_into": "<other task_id> (optional: becomes a subtask of that task)",
  "complete": "true (optional): the capture is already done → „შესრულდა' becomes the card's main button (ვეთანხმები moves into „მეტი'); it only completes the task, no other field is written",
  "confidence": "high | mid | low",
  "questions": ["only when confidence is low"],
  "made_at": "ISO (filled by the server when missing)" }
```

## 2. Read what the user sent — `GET /api/agent_queue`
Query: `agent=<name>` · `session=<id>` (see Duty session) · `status=queued|waiting|done|all` (default = not done) · `since=<ISO>`
(log entries after that moment) · `limit=<n>` (log rows; default 500 with `since`, 100 without; max 2000).
```json
{ "ok": true, "server_time": "…",
  "agent": { "connected": true, "known": true, "busy": true, "name": "kiki", "last_seen": "…", "last_analysis": "…", "open_batches": ["b89710d261fb"], "queued": 2, "duty": { "agent": "kiki", "session": "…", "since": "…" }, "sessions": 2 },
  "session": "…", "on_duty": true, "duty": { "agent": "kiki", "session": "…", "since": "…" }, "sessions": 2,
  "queue": [ { "id": 1, "batch_id": "b89…", "task_id": "…", "tab": "triage|active", "status": "queued",
               "created_at": "…", "item": { "task_id": "…", "action": "split|null", "flag": true, "proposal": {…}, "changes": {…}|null, "decision": "…", "comment": "…"|null } } ],
  // tab "active" item = the same shape without `proposal`: { task_id, action, flag, decision, comment, changes:{due, due_string}|null }
  "open_batches": ["b89…"],
  "log": [ { "at": "…", "task_id": "…", "event": "accepted|changed|completed|postponed|partial|kept|rejected|split|deleted|undo|queue|done|round_close|trigger", "data": {…} } ],
  "trigger_at": "ISO or '' — the user pressed „ხელახლა გაანალიზე'; consumed once" }
```
- `queue` = agent work: `action:"split"` (დაშალე → add subtasks / re-propose), `flag` („?" — something is off), `comment` (free text). Do it if clear (subtasks via `POST /api/subtask_add {id,text}`, new proposal via `agent_propose`); ask the user in chat if unclear.
- `log` = what the user decided on standard actions — read it to learn: `accepted` · `changed` (with `changes` diff — keys project · section · priority · due · due_string · labels — **and** `proposal` = the user's edited version) · `completed` („შესრულდა" — the task was already done; `proposal` = what you proposed, so you learn when to send `complete: true`) · `rejected` (data.status `deleted_pending` = marked for deletion, still undoable) · `deleted` (the round closed, the task is really gone) · `undo` (the user took a decision back) · `split` (დაშალე marked; the item itself arrives in `queue` when the user sends) · `queue` · `done` · `round_close` · `trigger`.
  Tab 1 („აქტიური", 2026-08-18) adds `postponed` (data.changes = `{due, due_string?}` — the new due; the
  Todoist label `(+n)` on the task is the counter; `verdict` names the choice) · `partial` (ნაწილობრივ — the
  task is untouched, stays open) · `kept` (დატოვე — untouched, dropped from the round). Every per-task row
  carries `data.tab` = `active|triage`. A move („გადაიტანე…") is a plain edit — no log row, you see it in
  `data.project`/`data.section` of the next decision, or in `/api/state`.
  Every per-task row (`accepted` · `changed` · `completed` · `postponed` · `partial` · `kept` · `rejected` · `split` · `undo`) also carries
  `data.text` (task text at decision time) and `data.project` / `data.section` (**resulting** — the panel
  writes its fields before it records the status, so on `accepted`/`changed` this is where the task ended
  up); `deleted` carries `data.text` too — readable after the row is gone (Kiki, 2026-08-17).
- `trigger_at` non-empty → re-analyse the Inbox now (`GET /api/state` → tasks with `project == "Inbox"` and no `agent_proposal`).

## 3. Finish a batch — `POST /api/agent_done`
```json
{ "agent": "kiki", "session": "<your id>", "batch_id": "b89710d261fb" }      // or "batch_id": "all"
```
Marks the batch done; the panel unlocks and re-renders (toast „პასუხი მოვიდა"). Refused with
`{ok:false, error:"not_on_duty", duty:{…}}` when another live session is on duty (see Duty session).

## 4. Read tasks — `GET /api/state`
Every task carries `agent_status`, `agent_proposal` (object or null), `agent_decided_at`,
`agent_decision` (object or null — the panel's own undo recipe `{kind, changes, recipe}`; the
recipe holds the old values, i.e. the snapshot before the accept), `postpone_count` (from the
Todoist label `(+n)`); the response has a global
`agent: {connected, known, busy, name, last_seen, last_analysis, open_batches, queued, round_closed_at, duty, sessions, pending_deletes}`.
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
· `postponed` · `partial` · `kept`
(`deleted_pending` → `rejected` when the round closes; undo before that → `proposed` on tab 2, `""` on tab 1;
`completed` = the user pressed „შესრულდა" — the task is checked off in Todoist right away, undo → reopened;
`postponed` / `partial` / `kept` = tab-1 decisions, see below).

## Which tab shows a card (2026-08-18)
- **Tab 2 „დაუხარისხებელი"**: `agent_status = proposed` with a proposal, project Inbox, not completed; plus
  every card decided **on tab 2** in the current round (`agent_decision.recipe.tab != "active"`, status in
  accepted · changed · completed · split · deleted_pending, `agent_decided_at > round_closed_at`); plus
  `split` marks not yet sent.
- **Tab 1 „აქტიური"**: every open top-level task that is pinned (sticky) · overdue · due today · due
  tomorrow **and is not on tab 2** (one card, one tab — Kiki, 2026-08-17); plus cards decided **on tab 1**
  in the current round (`recipe.tab = "active"`, status in postponed · partial · kept · completed · split ·
  deleted_pending) — they stay in their group (`recipe.group` = pin | over | today | tom), dimmed, until the
  round closes. Tasks with status `queued` (sent to you) show on neither tab until you post `agent_done`.
- Groups: აპინული (n / 10) · ვადაგადაცილებული (due asc, first 10 + „მეტი…") · დღეს · ხვალ. The card shows
  the overdue age („N დღე": orange ≥ 7, red ≥ 30) and the postpone counter `@(+n)` (red at 5).

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
`POST /api/agent_round_close {}` (returns `{deleted:[{id, subs, text, tab}], closed_at}`) ·
`POST /api/agent_trigger {}` („ხელახლა გაანალიზე"; delivered to the duty session only).
What each panel action writes: ვეთანხმები = `POST /api/update` per changed field (project → section →
priority → due_date → due_time → due_string → chosen_labels → text → description) + `subtask_add` per subtask +
on merge `subtask_add` on the target + `task_delete` of the card, then `agent_status accepted|changed`
with the recipe. შესრულდა = `POST /api/update {id, field:"completed", value:true}` (the app's own completion,
synced as `item_complete`) + `agent_status completed`; nothing else is written even when the proposal carries
other fields. წაშალე = `agent_status deleted_pending` only (real `task_delete` at round close).
დაშალე = `agent_status split`, item sent with „გადაამოწმე". Undo = the reverse calls + `agent_status proposed`.
Tab 1: გადადება = `POST /api/update due_date` (+ `due_time` / `due_string` from the date popover; როდესმე
clears the date and with it time + recurrence) + `chosen_labels` with the old `(+k)` replaced by `(+k+1)`, then
`agent_status postponed` (recipe.tab active). Intervention: the 5th postpone or an overdue age ≥ 30 days shows
the block first (დავშალოთ = split · როდესმეში = date cleared · წაშალე = deferred delete · მაინც გადადე = the
postpone anyway). წრე = `completed=true` + `agent_status completed`. ნაწილობრივ / დატოვე = `agent_status`
partial / kept only. გადაიტანე… = `update project` (+ `section`) — no status. Undo on tab 1 = the reverse
calls + `agent_status ""`.
