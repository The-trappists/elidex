"""Listen: load Teams chats and emails as threads. Nobody types anything."""

import json
import re
from datetime import date, datetime, time
from pathlib import Path

from . import config
from .models import Message, Thread

_HEADER = re.compile(r"^(From|To|Subject|Date):\s*(.*)$", re.IGNORECASE)


def _rel(path: Path, data_dir: Path) -> str:
    return path.relative_to(data_dir).as_posix()


def load_teams(path: Path, data_dir: Path) -> Thread:
    raw = json.loads(path.read_text(encoding="utf-8"))
    day = date.fromisoformat(raw.get("date") or config.DEFAULT_THREAD_DATE)
    tid = _rel(path, data_dir)
    messages = [
        Message(
            thread_id=tid,
            source="teams",
            seq=m["seq"],
            author=m["author"],
            role=m.get("role"),
            sent_at=datetime.combine(day, time.fromisoformat(m["time"])),
            text=m["text"],
        )
        for m in raw["messages"]
    ]
    return Thread(id=tid, source="teams", subject=raw.get("subject"), messages=messages)


def load_email(path: Path, data_dir: Path) -> Thread:
    """One email = one thread with one message. Headers: From, To, Subject, optional Date (ISO)."""
    head, _, body = path.read_text(encoding="utf-8").partition("\n\n")
    headers = {}
    for line in head.splitlines():
        if m := _HEADER.match(line.strip()):
            headers[m[1].lower()] = m[2].strip()
    if "date" in headers:
        sent_at = datetime.fromisoformat(headers["date"])
    else:
        sent_at = datetime.combine(
            date.fromisoformat(config.DEFAULT_THREAD_DATE), time.fromisoformat(config.DEFAULT_EMAIL_TIME)
        )
    author = re.sub(r"\s*<.*?>", "", headers.get("from", "unknown")).strip()
    tid = _rel(path, data_dir)
    message = Message(thread_id=tid, source="email", seq=1, author=author, sent_at=sent_at, text=body.strip())
    return Thread(id=tid, source="email", subject=headers.get("subject"), messages=[message])


def _fill_roles(threads: list[Thread]) -> None:
    """Emails carry no role: reuse the one people have in Teams."""
    roles = {m.author: m.role for t in threads for m in t.messages if m.role}
    for t in threads:
        for m in t.messages:
            m.role = m.role or roles.get(m.author)


def discover_threads(data_dir: Path | None = None) -> list[Thread]:
    """Every teams*.json and email*.txt under data/elisa and data/synthetic, oldest first."""
    data_dir = data_dir or config.DATA_DIR
    threads: list[Thread] = []
    for folder in ("elisa", "synthetic"):
        d = data_dir / folder
        threads += [load_teams(p, data_dir) for p in sorted(d.glob("teams*.json"))]
        threads += [load_email(p, data_dir) for p in sorted(d.glob("email*.txt"))]
    _fill_roles(threads)
    return sorted(threads, key=lambda t: t.started_at)
