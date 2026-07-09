"""Google Calendar API (write side) — OAuth as the user, stdlib only.

Stage B. The read-only iCal view (gcal.py) stays available on its own; this
module adds real event writing for users who opt into full sync. They bring
their own OAuth client (id/secret from a personal Google Cloud project) and
authorize once in the browser (loopback redirect into our local server).

Reminders in Google Calendar are per-user: only the authenticated owner can
set their own popup reminders. That is why full sync authenticates as the
user (OAuth) and not via a service account.

Secrets (client id/secret, tokens) live only in the app_settings table.
Never log them.
"""

import json
import urllib.parse
import urllib.request

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API_BASE = "https://www.googleapis.com/calendar/v3"
SCOPE = "https://www.googleapis.com/auth/calendar.events"
TIMEOUT = 30


def build_auth_url(client_id, redirect_uri, state):
    q = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",        # ensures a refresh_token is issued
        "state": state,
    })
    return AUTH_URL + "?" + q


def _post_form(url, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def exchange_code(client_id, client_secret, code, redirect_uri):
    """Authorization code -> {access_token, refresh_token, expires_in, ...}."""
    return _post_form(TOKEN_URL, {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    })


def refresh_access(client_id, client_secret, refresh_token):
    """Refresh token -> {access_token, expires_in, ...}."""
    return _post_form(TOKEN_URL, {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    })


def revoke(token):
    """Best-effort revocation on disconnect."""
    try:
        _post_form(REVOKE_URL, {"token": token})
    except Exception:
        pass


def _call(method, path, token, payload=None):
    url = API_BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read()
    return json.loads(raw.decode()) if raw else {}


def insert_event(token, payload):
    return _call("POST", "/calendars/primary/events", token, payload)


def update_event(token, event_id, payload):
    return _call("PATCH", "/calendars/primary/events/" + urllib.parse.quote(event_id), token, payload)


def delete_event(token, event_id):
    """Missing/already-gone events (404/410) are not an error."""
    try:
        _call("DELETE", "/calendars/primary/events/" + urllib.parse.quote(event_id), token)
    except urllib.error.HTTPError as e:
        if e.code not in (404, 410):
            raise
