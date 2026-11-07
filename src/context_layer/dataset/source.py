"""Read threads of a dataset without loading it: streamed from the JSONL shards, or queried from MongoDB.

Both sources give dicts in the same shape (see docs/dataset.md) and take the same filters, so code written
against `ThreadSource.threads()` works on a 150 MB demo folder and on 3 GB in Atlas alike.
"""

from __future__ import annotations

import csv
import json
import re
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Protocol

# element ids (TRN-10001, RAD-221) and site-based aliases (HEL101-TRN2)
MENTION = re.compile(r"\b(?:[A-Z]{3}-\d{3,5}|[A-Z]{3}\d{3,4}-[A-Z]{3}\d+)\b")


def load_alias_map(root: Path) -> dict[str, str]:
    """Every id and alias of the inventory -> the element id."""
    out: dict[str, str] = {}
    with open(root / "network" / "network_elements.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["id"]] = r["id"]
            for a in filter(None, r["aliases"].split("|")):
                out[a] = r["id"]
    return out


def mentions(thread: dict, alias_map: dict[str, str]) -> list[str]:
    """Element ids named in the thread (aliases resolved; unknown tokens ignored), sorted."""
    found = {alias_map[m] for msg in thread["messages"] for m in MENTION.findall(msg["text"]) if m in alias_map}
    return sorted(found)


def thread_doc(thread: dict, alias_map: dict[str, str]) -> dict:
    """The thread as stored in MongoDB: `_id` = thread id, plus what the queries need."""
    msgs = thread["messages"]
    return {
        "_id": thread["id"], "source": thread["source"], "subject": thread["subject"],
        "started_at": datetime.fromisoformat(msgs[0]["sent_at"]), "ended_at": datetime.fromisoformat(msgs[-1]["sent_at"]),
        "n_messages": len(msgs), "authors": sorted({m["author_id"] for m in msgs}),
        "mentions": mentions(thread, alias_map), "messages": msgs,
    }


def message_rows(thread: dict, alias_map: dict[str, str]) -> Iterator[tuple]:
    """One row per message for the Tiger Data `messages` table."""
    for m in thread["messages"]:
        found = sorted({alias_map[x] for x in MENTION.findall(m["text"]) if x in alias_map})
        yield (thread["id"], m["seq"], datetime.fromisoformat(m["sent_at"]), thread["source"], m["author_id"], m["author"], m["role"], m["text"], found)


class ThreadSource(Protocol):
    def threads(self, since: datetime | None = None, until: datetime | None = None, element: str | None = None, limit: int | None = None) -> Iterator[dict]: ...


class FileSource:
    """Streams the shards in time order, one line in memory at a time. A filter on an element is a scan."""

    def __init__(self, root: Path):
        self.root = root
        self.alias_map: dict[str, str] | None = None

    def threads(self, since=None, until=None, element=None, limit=None) -> Iterator[dict]:
        needles: list[str] = []
        if element:
            self.alias_map = self.alias_map or load_alias_map(self.root)
            needles = [a for a, eid in self.alias_map.items() if eid == element] or [element]
        n = 0
        for shard in sorted((self.root / "conversations").glob("threads-*.jsonl")):
            with open(shard, encoding="utf-8") as f:
                for line in f:
                    if needles and not any(x in line for x in needles):  # cheap test before parsing the JSON
                        continue
                    t = json.loads(line)
                    if element and element not in mentions(t, self.alias_map):  # "RAD-221" is a prefix of "RAD-22101"
                        continue
                    start = datetime.fromisoformat(t["messages"][0]["sent_at"])
                    if until and start >= until:
                        return  # shards and threads are in time order
                    if since and start < since:
                        continue
                    yield t
                    n += 1
                    if limit and n >= limit:
                        return


class MongoSource:
    """Indexed queries on the `threads` collection (loaded by `ctx dataset load-mongo`)."""

    def __init__(self, db):
        self.col = db["threads"]

    def threads(self, since=None, until=None, element=None, limit=None) -> Iterator[dict]:
        query: dict = {}
        if since or until:
            query["started_at"] = {k: v for k, v in (("$gte", since), ("$lt", until)) if v}
        if element:
            query["mentions"] = element
        cursor = self.col.find(query).sort("started_at", 1)
        if limit:
            cursor = cursor.limit(limit)
        for d in cursor:
            yield {"id": d["_id"], "source": d["source"], "subject": d["subject"], "messages": d["messages"]}
