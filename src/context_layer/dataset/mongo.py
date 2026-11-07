"""MongoDB Atlas as the store of the big dataset: threads, network, people and ground truth, outside our memory.

Needs MONGODB_URI (and MONGODB_DB) in .env. Loading is streamed in batches and can be re-run: duplicate
`_id`s are skipped, so an interrupted load resumes where it stopped.
"""

from __future__ import annotations

import csv
import json
import time
from collections.abc import Iterable, Iterator
from pathlib import Path

from .. import config
from .source import load_alias_map, thread_doc

BATCH = 1000


def connect():
    from pymongo import MongoClient

    if not config.mongo_configured():
        raise SystemExit("MONGODB_URI is not set. Copy the line from .env.example into .env and fill it in (docs/dataset.md).")
    client = MongoClient(config.MONGODB_URI, serverSelectionTimeoutMS=10_000)
    return client[config.MONGODB_DB]


def check(db) -> dict:
    """Ping and report what is stored (sizes in MB)."""
    db.client.admin.command("ping")
    out = {"database": db.name, "collections": {}}
    for name in db.list_collection_names():
        s = db.command("collStats", name)
        out["collections"][name] = {"documents": s["count"], "data_mb": round(s["size"] / 1e6, 1), "storage_mb": round(s.get("storageSize", 0) / 1e6, 1), "index_mb": round(s.get("totalIndexSize", 0) / 1e6, 1)}
    return out


def _insert(col, docs: Iterable[dict], log) -> int:
    from pymongo.errors import BulkWriteError

    n, batch = 0, []

    def flush() -> None:
        nonlocal n, batch
        if not batch:
            return
        try:
            col.insert_many(batch, ordered=False)
        except BulkWriteError as e:
            if any(err["code"] != 11000 for err in e.details["writeErrors"]):  # 11000 = already loaded
                raise
        n += len(batch)
        batch = []

    for d in docs:
        batch.append(d)
        if len(batch) >= BATCH:
            flush()
            if n % 50_000 == 0:
                log(f"  {col.name}: {n:,}")
    flush()
    return n


def _jsonl(path: Path) -> Iterator[dict]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            yield json.loads(line)


def load(root: Path, db, drop: bool = False, only: set[str] | None = None, log=print) -> dict:
    """Stream a dataset folder into MongoDB. Returns the number of documents per collection."""
    want = lambda name: not only or name in only  # noqa: E731
    counts: dict[str, int] = {}
    started = time.time()
    alias_map = load_alias_map(root)

    def prepare(name: str):
        if drop:
            db.drop_collection(name)
        return db[name]

    if want("sites"):
        counts["sites"] = _insert(prepare("sites"), ({"_id": s["id"], **s} for s in _jsonl(root / "network" / "sites.jsonl")), log)
    if want("links"):
        counts["links"] = _insert(prepare("links"), ({"_id": s["id"], **s} for s in _jsonl(root / "network" / "links.jsonl")), log)
    if want("elements"):
        def elements() -> Iterator[dict]:
            with open(root / "network" / "network_elements.csv", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    yield {"_id": r["id"], **r, "install_year": int(r["install_year"]), "aliases": [a for a in r["aliases"].split("|") if a]}
        counts["elements"] = _insert(prepare("elements"), elements(), log)
    if want("users"):
        counts["users"] = _insert(prepare("users"), ({"_id": u["id"], **u} for u in _jsonl(root / "people" / "users.jsonl")), log)
    if want("facts"):
        counts["facts"] = _insert(prepare("facts"), ({"_id": f["fact_id"], **f} for f in _jsonl(root / "ground_truth" / "facts.jsonl")), log)
    if want("threads"):
        col = prepare("threads")
        total = 0
        for shard in sorted((root / "conversations").glob("threads-*.jsonl")):
            total += _insert(col, (thread_doc(t, alias_map) for t in _jsonl(shard)), lambda *_: None)
            log(f"  threads: {total:,} ({shard.name}, {time.time() - started:.0f} s)")
        counts["threads"] = total
    create_indexes(db, only)
    log(f"loaded {counts} in {time.time() - started:.0f} s")
    return counts


def create_indexes(db, only: set[str] | None = None) -> None:
    """Built after the load: faster than maintaining them while inserting."""
    if not only or "threads" in only:
        db["threads"].create_index("started_at")
        db["threads"].create_index("mentions")  # all threads naming an element
        db["threads"].create_index([("source", 1), ("started_at", 1)])
    if not only or "elements" in only:
        db["elements"].create_index("site_id")
        db["elements"].create_index("aliases")
        db["elements"].create_index([("model", 1), ("install_year", 1)])
    if not only or "facts" in only:
        db["facts"].create_index("item.topic")
        db["facts"].create_index("reach.entity_ids")
