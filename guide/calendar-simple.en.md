# Calendar — simple connection

The simple connection brings your Google calendar into Todoister **view-only** —
entries show in **blue**, next to your tasks. Nothing can be changed. It takes
about a minute, with no Google Cloud setup.

**Sending** tasks to Google is a separate, deeper connection — see
"Calendar — full sync". You can turn on both at once.

## If Google's screens look different
Google changes its interface from time to time. If you can't find the buttons
described below, search for the latest official instructions — type into a
search engine:
- **Google Calendar secret address in iCal format**
- **Google Calendar Integrate calendar** (Google's own help page)

Official source: **support.google.com/calendar**.

## Step 1 — Get the iCal address in Google
- On a computer, open [calendar.google.com](https://calendar.google.com) and
  sign in. (This address isn't shown in the phone app — you need a browser.)
- Top right, click the **Settings gear** → **Settings**.
- In the left list, under **"Settings for my calendars"**, click the calendar
  you want to show.
- Scroll down to the **"Integrate calendar"** section.
- Find the **"Secret address in iCal format"** field and copy the whole address
  (it starts with `https://` and ends in `.ics`).
- **Important:** this address is private — anyone who has it can see your
  calendar. Don't share it.

## Step 2 — Paste it into Todoister
- Open the **Calendar** (the green button in the sidebar).
- At the end of the toolbar, click the **⋯** menu →
  **"Connect Google Calendar"**.
- Paste the address you copied and click **"Connect"**.

## What you'll see
- Google entries appear in **blue** in all three views (day/week/month), next to
  your tasks.
- Clicking an entry opens a card — **view-only**; it can't be changed or deleted.
- **Updates:** Todoister refetches this calendar **every 15 minutes**. A change
  made in Google shows up after a while (Google itself refreshes the secret iCal
  feed only periodically). The "Sync now" button **does not** speed up the simple
  connection — the delay is on Google's side.

## Disconnect
- From the same **⋯** menu — **"Disconnect Google Calendar"**. It doesn't affect
  your tasks.
