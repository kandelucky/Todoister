# Calendar — full sync

Full sync connects Todoister to **your own Google account**: timed tasks are
sent to Google Calendar as events automatically — with real reminders. It is
independent of the simple view-only connection: both can be on at the same time.

A one-time setup is needed on Google's side — about **10 minutes**. The steps are
below.

## If Google's screens look different
The Google Cloud interface changes from time to time. If you can't find the
buttons described below, search for the latest official instructions — type into
a search engine:
- **Google Cloud create OAuth client ID Desktop app**
- **Google Cloud enable Calendar API**
- **Google OAuth consent screen publish app**

Official source: **console.cloud.google.com** and **support.google.com**.

## Step 1 — a project in Google Cloud
- Open [console.cloud.google.com](https://console.cloud.google.com) and sign in
  with the Google account whose calendar should receive your tasks.
- Create a **new project** (project picker in the top bar → New project). Any
  name works, e.g. "Todoister". After creating it, make sure that project is the
  one selected.

## Step 2 — enable the Calendar API
- In the menu: **APIs & Services → Library**.
- Search for **Google Calendar API** and press **Enable**.
- (If it drops you on a statistics page afterwards — that's normal, carry on.)

## Step 3 — the consent screen
- **APIs & Services → OAuth consent screen**.
- Enter any app name (e.g. "Todoister") and your email address as the contact.
  User type: **External**.
- At the end, make sure to **publish** the app (**Publish app** — the status must
  become "In production"). A connection left in Testing mode **expires after
  7 days** and you would have to start over.

## Step 4 — create the credentials
- **APIs & Services → Credentials → Create credentials → OAuth client ID**.
- Application type: **Desktop app**. Any name.
- On creation you get a **Client ID** and a **Client secret** — copy both (they
  stay visible in the Credentials list).

## Step 5 — enable it in Todoister
- Open the calendar → the **⋯** menu at the end of the toolbar →
  **"Full sync — enable"**.
- Paste the **Client ID** and **Client secret** → **"Continue"**.
- Google's consent screen opens in the browser. If it says "Google hasn't
  verified this app" — that's normal (the app is your own): click
  **Advanced → Go to …** and continue.
- Approve access. A confirmation page appears in the browser — close it and
  return to Todoister.
- **If you see "403 access_denied"** — the app wasn't published in Step 3. Go
  back to the OAuth consent screen and **Publish app**.

## After connecting
- An open, **timed** task automatically becomes an event in your Google calendar.
- A **P1/P2** task gets a double reminder (1 day and 1 hour before); P3/P4 get
  Google's default.
- Completing, deleting, or removing the time from a task also removes the event.
- Changes appear within seconds; to push them by hand, use **"Sync now"** in the
  account panel.

## Disconnecting
- In the same **⋯** menu: **"Full sync is on · disconnect"**.
- The simple view-only connection is not affected — it is disconnected
  separately.

## Security
- The Client ID, Client secret and access tokens are stored **only on your
  computer**, in the app's local database. They are never sent anywhere else.
- Todoister asks for access **only to calendar events** (`calendar.events`) — not
  to your mail, files or anything else.
