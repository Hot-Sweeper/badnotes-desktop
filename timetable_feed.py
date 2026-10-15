"""Optional user-supplied iCalendar feed. No network requests without configuration."""
import os
import re
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

_lock = threading.Lock()
_cache = {"expires": 0, "data": None}


def _unescape(value):
    return re.sub(r"\\([nN,;\\])", lambda match: "\n" if match[1].lower() == "n" else match[1], value)


def parse_calendar(text):
    zone = ZoneInfo(os.environ.get("BADNOTES_CALENDAR_TIMEZONE", "UTC"))
    def event_time(value):
        if value.endswith("Z"):
            return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        return datetime.strptime(value, "%Y%m%dT%H%M%S").replace(tzinfo=zone)
    lines = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.startswith((" ", "\t")) and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line)
    events, fields = [], None
    for line in lines:
        if line == "BEGIN:VEVENT":
            fields = {}
        elif line == "END:VEVENT" and fields is not None:
            try:
                start, end = event_time(fields["DTSTART"]), event_time(fields["DTEND"])
                if fields.get("STATUS") != "CANCELLED" and end > start:
                    events.append({"id": fields.get("UID", ""), "start": start.astimezone(zone).isoformat(),
                        "end": end.astimezone(zone).isoformat(), "subject": _unescape(fields.get("SUMMARY", "Event")),
                        "teacher": "", "room": _unescape(fields.get("LOCATION", ""))})
            except (KeyError, ValueError):
                pass
            fields = None
        elif fields is not None and ":" in line:
            name, value = line.split(":", 1)
            fields[name.split(";", 1)[0].upper()] = value
    return sorted(events, key=lambda event: (event["start"], event["id"]))


def get_timetable():
    url = os.environ.get("BADNOTES_CALENDAR_URL", "").strip()
    empty = {"events": [], "fetched_at": datetime.now(timezone.utc).isoformat(), "stale": False, "enabled": False}
    if not url:
        return empty
    if not url.startswith("https://"):
        raise ValueError("Calendar URL must use HTTPS")
    with _lock:
        now = time.monotonic()
        if _cache["data"] is not None and now < _cache["expires"]:
            return _cache["data"]
        try:
            response = requests.get(url, timeout=12)
            response.raise_for_status()
            if "BEGIN:VCALENDAR" not in response.text:
                raise ValueError("Invalid iCalendar feed")
            result = {**empty, "events": parse_calendar(response.content.decode("utf-8-sig")), "enabled": True}
        except (requests.RequestException, ValueError, UnicodeError):
            if _cache["data"] is None:
                raise
            result = {**_cache["data"], "stale": True}
        _cache.update(expires=now + 60, data=result)
        return result
