"""Google Calendar (read-only) via the calendar's secret iCal URL.

The user pastes their Google calendar's "Secret address in iCal format"
(Google Calendar - Settings - Integrate calendar). We fetch and cache the
ICS text, then expand its events into concrete per-day occurrences for the
date range the calendar view asks for.

Read-only by design: creating/updating events (Stage B) will use the
Calendar API with OAuth. The URL is a secret - it lives only in the local
app_settings table and must never be logged or committed.
"""

import datetime
import threading
import time
import urllib.request

try:
    from zoneinfo import ZoneInfo
except ImportError:          # very old Python - fall back to local time only
    ZoneInfo = None

CACHE_TTL = 15 * 60          # refetch the ICS at most every 15 minutes
FETCH_TIMEOUT = 30
MAX_ICS_BYTES = 20 * 1024 * 1024
_MAX_ITER = 4000             # recurrence expansion safety cap per event

_lock = threading.Lock()
_cache = {"url": None, "text": None, "at": 0.0}

_WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def clear_cache():
    with _lock:
        _cache.update({"url": None, "text": None, "at": 0.0})


def _fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Todoister"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
        text = r.read(MAX_ICS_BYTES).decode("utf-8", "replace")
    if "BEGIN:VCALENDAR" not in text:
        raise ValueError("not an iCal feed")
    return text


def _fetch_cached(url):
    with _lock:
        if _cache["url"] == url and time.time() - _cache["at"] < CACHE_TTL:
            return _cache["text"]
    text = _fetch(url)       # network outside the lock
    with _lock:
        _cache.update({"url": url, "text": text, "at": time.time()})
    return text


def probe(url):
    """Fetch once (bypassing the cache) to validate the URL; returns the
    calendar's display name and primes the cache."""
    text = _fetch(url)
    with _lock:
        _cache.update({"url": url, "text": text, "at": time.time()})
    for ln in _unfold(text):
        if ln.startswith("X-WR-CALNAME:"):
            return _unescape(ln.split(":", 1)[1].strip())
    return "Google Calendar"


# ---------------- ICS parsing ----------------

def _unfold(text):
    """RFC 5545 line unfolding: a line starting with space/tab continues the
    previous one."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = []
    for ln in lines:
        if ln[:1] in (" ", "\t") and out:
            out[-1] += ln[1:]
        else:
            out.append(ln)
    return out


def _unescape(s):
    return (s.replace("\\n", "\n").replace("\\N", "\n")
             .replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\"))


def _prop(line):
    """'NAME;PARAM=X;PARAM2=Y:value' -> (name, {param: x}, value)."""
    head, _, value = line.partition(":")
    parts = head.split(";")
    params = {}
    for p in parts[1:]:
        k, _, v = p.partition("=")
        params[k.upper()] = v
    return parts[0].upper(), params, value


def _local_tz():
    return datetime.datetime.now().astimezone().tzinfo


def _parse_when(value, params, local_tz):
    """DTSTART/DTEND/EXDATE value -> (date, all_day=True) or
    (aware datetime in local tz, all_day=False)."""
    value = value.strip()
    if params.get("VALUE") == "DATE" or (len(value) == 8 and value.isdigit()):
        return datetime.date(int(value[:4]), int(value[4:6]), int(value[6:8])), True
    naive = datetime.datetime.strptime(value[:15], "%Y%m%dT%H%M%S")
    tzid = params.get("TZID")
    if value.endswith("Z"):
        dt = naive.replace(tzinfo=datetime.timezone.utc)
    elif tzid and ZoneInfo is not None:
        try:
            dt = naive.replace(tzinfo=ZoneInfo(tzid))
        except Exception:
            dt = naive.replace(tzinfo=local_tz)
    else:
        dt = naive.replace(tzinfo=local_tz)
    return dt.astimezone(local_tz), False


def _parse_events(text, local_tz):
    """VEVENT blocks -> list of event dicts (VALARM and VTIMEZONE skipped)."""
    events, cur, depth = [], None, 0
    for ln in _unfold(text):
        name, params, value = _prop(ln)
        if name == "BEGIN":
            v = value.strip().upper()
            if v == "VEVENT" and cur is None:
                cur = {"exdates": []}
            elif cur is not None:
                depth += 1               # VALARM etc. inside the event - skip
            continue
        if name == "END":
            v = value.strip().upper()
            if cur is not None and depth:
                depth -= 1
            elif v == "VEVENT" and cur is not None:
                if "start" in cur and cur.get("status") != "CANCELLED":
                    events.append(cur)
                cur = None
            continue
        if cur is None or depth:
            continue
        if name == "DTSTART":
            cur["start"], cur["all_day"] = _parse_when(value, params, local_tz)
        elif name == "DTEND":
            cur["end"], _ = _parse_when(value, params, local_tz)
        elif name == "SUMMARY":
            cur["title"] = _unescape(value.strip())
        elif name == "RRULE":
            cur["rrule"] = value.strip()
        elif name == "EXDATE":
            for v in value.split(","):
                if v.strip():
                    cur["exdates"].append(_parse_when(v, params, local_tz)[0])
        elif name == "STATUS":
            cur["status"] = value.strip().upper()
        elif name == "UID":
            cur["uid"] = value.strip()
        elif name == "RECURRENCE-ID":
            cur["rec_id"], _ = _parse_when(value, params, local_tz)
    return events


# ---------------- recurrence expansion ----------------

def _parse_rrule(s):
    rule = {}
    for part in s.split(";"):
        k, _, v = part.partition("=")
        rule[k.upper()] = v
    return rule


def _past_until(occ, until):
    """occ > UNTIL, tolerating date-vs-datetime mismatch between the two."""
    if until is None:
        return False
    a, b = occ, until
    if isinstance(a, datetime.datetime) and not isinstance(b, datetime.datetime):
        a = a.date()
    elif not isinstance(a, datetime.datetime) and isinstance(b, datetime.datetime):
        b = b.date()
    return a > b


def _beyond_window(occ, win_end):
    d = occ.date() if isinstance(occ, datetime.datetime) else occ
    return d > win_end


def _rrule_starts(start, rule, win_end, local_tz):
    """Occurrence starts (same type as `start`: date or aware datetime) from
    DTSTART per the rule, stopping past win_end / COUNT / UNTIL."""
    freq = rule.get("FREQ", "").upper()
    interval = max(1, int(rule.get("INTERVAL", 1) or 1))
    count = int(rule["COUNT"]) if rule.get("COUNT") else None
    until = _parse_when(rule["UNTIL"], {}, local_tz)[0] if rule.get("UNTIL") else None

    if freq == "WEEKLY":
        candidates = _weekly_candidates(start, rule, interval)
    elif freq == "DAILY":
        step = datetime.timedelta(days=interval)
        candidates = (start + step * i for i in range(_MAX_ITER))
    elif freq == "MONTHLY":
        candidates = _stepper(start, lambda occ: _next_monthly(start, occ, interval, rule))
    elif freq == "YEARLY":
        candidates = _stepper(start, lambda occ: _next_yearly(start, occ, interval))
    else:
        candidates = iter([start])   # unknown rule - at least show the first one

    out = []
    for occ in candidates:
        if _past_until(occ, until) or (count and len(out) >= count):
            break
        out.append(occ)
        if _beyond_window(occ, win_end):
            break
    return out


def _stepper(start, advance):
    occ = start
    for _ in range(_MAX_ITER):
        yield occ
        occ = advance(occ)
        if occ is None:
            return


def _weekly_candidates(start, rule, interval):
    bydays = sorted(_WEEKDAYS[d] for d in rule.get("BYDAY", "").split(",")
                    if d in _WEEKDAYS) or [start.weekday()]
    week0 = start - datetime.timedelta(days=start.weekday())
    for i in range(_MAX_ITER):
        week = week0 + datetime.timedelta(weeks=i * interval)
        for wd in bydays:
            occ = week + datetime.timedelta(days=wd)
            if occ >= start:
                yield occ


def _replace_day(base, year, month, day):
    try:
        if isinstance(base, datetime.datetime):
            return base.replace(year=year, month=month, day=day)
        return datetime.date(year, month, day)
    except ValueError:
        return None


def _next_monthly(start, occ, interval, rule):
    """Next monthly occurrence after `occ` (BYMONTHDAY, or ordinal BYDAY like
    2TU / -1FR, defaulting to DTSTART's day of month)."""
    y, m = occ.year, occ.month
    for _ in range(_MAX_ITER):
        m += interval
        y += (m - 1) // 12
        m = (m - 1) % 12 + 1
        byday = rule.get("BYDAY", "")
        if byday and byday[-2:] in _WEEKDAYS:
            ord_s, wd = byday[:-2], _WEEKDAYS[byday[-2:]]
            ordinal = int(ord_s) if ord_s else 1
            day = _nth_weekday(y, m, wd, ordinal)
        else:
            day = int(rule.get("BYMONTHDAY") or start.day)
        if day:
            nxt = _replace_day(start, y, m, day)
            if nxt is not None:
                return nxt
    return None


def _next_yearly(start, occ, interval):
    y = occ.year
    for _ in range(200):
        y += interval
        nxt = _replace_day(start, y, start.month, start.day)
        if nxt is not None:      # skips Feb 29 on non-leap years
            return nxt
    return None


def _nth_weekday(year, month, weekday, ordinal):
    """Day-of-month of the Nth weekday (1..4) or last (-1); 0 if absent."""
    if ordinal > 0:
        first = datetime.date(year, month, 1)
        day = 1 + (weekday - first.weekday()) % 7 + (ordinal - 1) * 7
        try:
            datetime.date(year, month, day)
            return day
        except ValueError:
            return 0
    last_day = (datetime.date(year + (month == 12), month % 12 + 1, 1)
                - datetime.timedelta(days=1))
    return last_day.day - (last_day.weekday() - weekday) % 7


# ---------------- expansion into per-day occurrences ----------------

def _fmt_hm(dt):
    return dt.strftime("%H:%M")


def get_events(url, start_iso, days):
    """Expand the cached ICS into occurrences for [start_iso, +days).

    Returns a list of {date, time, end_time, dur, title, all_day, uid} sorted
    by date/time; `time` is "" for all-day entries, `dur` is minutes. `uid`
    lets the server drop events Todoister itself created via full sync."""
    local_tz = _local_tz()
    p = [int(x) for x in start_iso.split("-")]
    win_start = datetime.date(p[0], p[1], p[2])
    win_end = win_start + datetime.timedelta(days=max(1, min(62, days)) - 1)

    events = _parse_events(_fetch_cached(url), local_tz)

    # Detached instances (RECURRENCE-ID) replace that occurrence of the master.
    overrides = {}
    for ev in events:
        if ev.get("rec_id") is not None and ev.get("uid"):
            key = ev["rec_id"]
            if isinstance(key, datetime.datetime):
                key = key.date()
            overrides.setdefault(ev["uid"], set()).add(key)

    out = []
    for ev in events:
        title = ev.get("title") or "(untitled)"
        start = ev["start"]
        all_day = ev.get("all_day", False)

        if ev.get("rrule") and ev.get("rec_id") is None:
            rule = _parse_rrule(ev["rrule"])
            starts = _rrule_starts(start, rule, win_end, local_tz)
        else:
            starts = [start]

        skip_days = overrides.get(ev.get("uid"), set()) if ev.get("rrule") else set()
        ex = set()
        for x in ev.get("exdates", []):
            ex.add(x.date() if isinstance(x, datetime.datetime) else x)

        for occ in starts:
            occ_day = occ.date() if isinstance(occ, datetime.datetime) else occ
            if occ_day in ex or occ_day in skip_days:
                continue
            if all_day:
                # DTEND is exclusive; a multi-day event gets a chip on each day
                span = 1
                if isinstance(ev.get("end"), datetime.date):
                    end_d = ev["end"]
                    if isinstance(end_d, datetime.datetime):
                        end_d = end_d.date()
                    span = max(1, (end_d - (start.date() if isinstance(start, datetime.datetime) else start)).days)
                for i in range(span):
                    d = occ_day + datetime.timedelta(days=i)
                    if win_start <= d <= win_end:
                        out.append({"date": d.isoformat(), "time": "", "end_time": "",
                                    "dur": 0, "title": title, "all_day": True,
                                    "uid": ev.get("uid", "")})
            else:
                if not (win_start <= occ_day <= win_end):
                    continue
                dur = 60
                if isinstance(ev.get("end"), datetime.datetime):
                    dur = int((ev["end"] - start).total_seconds() // 60)
                # clamp into the occurrence's own day (rare cross-midnight case)
                mins = occ.hour * 60 + occ.minute
                dur = max(15, min(dur, 24 * 60 - mins))
                end_dt = occ + datetime.timedelta(minutes=dur)
                out.append({"date": occ_day.isoformat(), "time": _fmt_hm(occ),
                            "end_time": _fmt_hm(end_dt), "dur": dur,
                            "title": title, "all_day": False,
                            "uid": ev.get("uid", "")})

    out.sort(key=lambda e: (e["date"], e["time"]))
    return out
