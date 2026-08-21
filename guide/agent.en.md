# AI Agent Panel

The panel is the shared table between you and an AI assistant. The agent looks
through your tasks and proposes — where a task belongs, what priority, what
date — and you agree, change or reject it with one click. The agent decides
nothing on your behalf.

## Where it is

- In the sidebar, right after **Calendar** — "AI Agent Panel".
- Until an agent connects, the item is off: the panel is a bridge, and a bridge
  needs the other bank.
- The number next to the item = how many cards are waiting for your decision.
  While the agent works, a small spinner replaces the number.
- Under the title you see the connection state — **"Connection active"** or
  **"No connection"** — and **"Last analysis"** with the time.

## Two tabs

- **Active** — what is waiting for you now: pinned, overdue, today and tomorrow.
  A card shows the priority circle, the text, the date, the project, labels and
  "N d" — how many days it is overdue (orange from 7 days, red from 30).
- **Unsorted** — new captures in your Inbox with the agent's proposal. The green
  line shows **how it read** the capture; below it the proposal appears as
  chips. At the end there is a small dot — the agent's **confidence** (high,
  medium, low). On low confidence the agent asks you itself.
- A task lives on one tab only — nothing is shown twice.

## Chips — changing the proposal

On the "Unsorted" tab every card has four chips. **Clicking a chip changes the
proposal, not the task itself** — nothing is written to the task until you press
"Agree".

| Chip | What it opens |
|---|---|
| Section | The list of projects and sections — where the task should go |
| P1–P4 | The priority choice |
| Date | The usual date picker — date, time and repeat |
| @label | The label list with search; you can tick several |

A changed chip stays highlighted so you can see where you stepped in. After
"Agree" the card reads **"Saved (with your change)"** — that record goes to the
agent and it learns from it.

## Buttons on the "Unsorted" tab

- **Agree** — writes the whole proposal at once, in a single press:
  - project and section — the task moves where the chip says
  - priority
  - date and time; and the repeat, if the proposal has one
  - labels
  - if the agent rewrites the title, the original text goes into the
    description — nothing is lost
  - an addition to the description is appended as its own paragraph
  - the proposed subtasks are created
  - if the agent proposes merging with another task, this card becomes its
    subtask
  - all of it is one action — **a single "Undo"** takes it all back
- **Done** — appears as the main button when the agent sees the work is already
  finished. It completes the task right away and changes nothing else. The card
  stays in place, dimmed, until the round is closed.
- **Postpone ▾** — see its own section below.
- **More ▾**:
  - **Change** — reminds you to correct the chips first; the chips pulse
  - **Partially** — nothing changes on the task, it stays open; this is only a
    note for the agent that part of it is done
  - **Split** — a request to the agent to break the task into parts. It is not
    sent right away — it goes with "Recheck"
  - **Delete** — the task disappears from sight at once, but it is **really
    deleted only when you press "Finish"**. Until then "Undo" brings it back
  - **Leave** — let it stay as it is; a note for the agent
  - **Agree** — moves in here when the main button is "Done"

## Buttons on the "Active" tab

- **The circle on the left** — the task is completed. The card stays in place
  until you close the round, so an accidental click is fixable.
- **Postpone ▾** — see below.
- **More ▾**:
  - **Partially** — the task stays open, a record for the agent
  - **Split** — a request to the agent to break it up; goes with "Recheck"
  - **Move…** — the list of projects and sections; the task really moves, but
    **the card stays open** — moving is not a decision
  - **Delete** — as on the other tab: gone from sight at once, really deleted
    on "Finish"
  - **Leave** — let it stay as it is

## Postpone ▾ — six entries

A postponement **is written to the task at once**.

| Entry | What it does |
|---|---|
| Tomorrow | The date becomes tomorrow |
| 2-3 days | The date moves by 3 days |
| A week | The date moves by 7 days |
| A month | The date moves by one month |
| Someday | The date is cleared — and with it the time and the repeat |
| Date… | The usual picker opens: date, time and repeat |

Every postponement bumps the label **@(+1)**, **@(+2)** and so on — it is a real
Todoist label, so you see it on your phone too. On the fifth it turns red.

## When a task stops moving

If you postpone the same task for the fifth time, or it has been overdue for
more than 30 days, the postponement does not happen right away — a block appears
on the card: **"Not happening in this form. What now?"** with four answers:

- **Split it** — the same as "Split": we ask the agent to break it into parts
- **Someday** — the date is cleared, the task leaves the queue
- **Delete** — the task goes (really — on "Finish")
- **Postpone anyway** — the postponement you picked is carried out as chosen
- The small button beside them just closes the block — nothing is done

## Always at hand

- **Comment** (to the right of a card) — opens a small field: write to the agent
  what you think about this task. The text is kept even if you close the app.
- **"?"** — "Something is off — tell the agent". The card gets an orange stripe.
- **Undo** (on the card, after a decision) — reverses exactly that card's
  action. The comment and the "?" stay.

The comment and the "?" are not sent right away — they pile up for "Recheck".

## The bottom bar — Recheck and Finish

There is one button in the bottom bar and it takes two shapes:

- **"Recheck (N)"** — N is the number of cards carrying a **Split**, a **"?"**
  or a **comment**. Pressing it sends everything to the agent together: those
  cards leave the tabs, the panel switches to **"Processing"** and locks until
  the answer arrives. What is clear is updated right here; what is unclear, the
  agent asks you in chat.
- **"Finish"** — appears when there is nothing for the agent and only your own
  decisions are waiting for the round to close. On press: the tasks marked for
  deletion **are really deleted**, and the decided cards leave the tab. The
  whole close comes back with one "Undo".
- The bar also states how things work: **Agree · Done · Postpone apply at once,
  delete on finish**, and how many cards are left to recheck.

**Re-analyse** (top right) — a request for the agent to look at new Inbox
captures. It starts on its next check.

## When the agent is offline

A strip "Agent offline" appears above the tabs. The panel does not close down:

- **Works:** Agree · Done · Postpone · Delete · Finish.
- **Waits for the connection:** Split · "?" · comment · Recheck — those buttons
  are disabled for the time being.

A comment you wrote and a "?" you set are never lost — they stay and go out once
the connection is back.

## Access keys

The key button in the top right corner decides **who may talk to this
Todoister**. The list holds one row per agent: the name, its rights and when it
was last active.

There are two levels of rights: **full** — may manage tasks; **panel only** —
works within the panel alone.

| Button | What it does |
|---|---|
| Copy | Copies the key to the clipboard. If the file is gone, it tells you to rotate the key |
| Rotate | Creates a new key with the same name and rights. The old one stops working at once — the agent must read the new one |
| Revoke | An agent with this name cannot connect until you give it a new key |
| New key | A name (latin letters and digits) and the rights — and the key is ready |

A new key **is shown on screen once** and is saved the same moment as a file **on
your computer** — the agent reads it from there. It is never sent anywhere. The
folder of those files is stated in the dialog itself.

## One agent, several windows

If you have the same agent running in several places, only one of them may
write — the one **on duty**. Under the title you will see: "{name} — duty
session (N online)". Next to it is the **last write** — which agent changed
what, and when.
