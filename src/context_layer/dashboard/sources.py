"""Human activity around an element, read on demand from the dataset sources (docs/dataset.md, docs/dashboard.md).

Three views, each with its own endpoint so that one failing source never blocks the others:

- threads that name the element: Atlas (`MONGODB_URI`) when configured, else the dataset files (`FileSource`);
- freshness ("last exchange N days ago", messages and active days, per month): Tiger Data `daily_mentions`
  (`TIGER_DATABASE_URL`) when configured, else computed on the files in the same response shape;
- similar knowledge: Atlas vector search when configured, else an offline ranking of the Dashboard's own assertions.

Every answer says where it came from (`source`: files, atlas, tiger, dashboard) and has a `status`: `ok`,
`not_configured`, `error` or `timeout`, with a `detail` sentence. Nothing here raises to the client, and every
blocking call runs in a thread with a short timeout. When a cloud source fails and the files can answer, the answer
comes from the files and `fallback_from` carries the reason.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Request

from .. import config, embed
from ..dataset.source import FileSource, load_alias_map, mentions

router = APIRouter(prefix="/api/sources")

TIMEOUT_S = 6.0  # cloud sources
FILES_TIMEOUT_S = 8.0  # a scan of the demo dataset takes a second or two
PREVIEW_MESSAGES = 3
PREVIEW_CHARS = 280


class SourceUnavailable(Exception):
    """A source answered with an error or too slowly; the message is shown to the user."""

    def __init__(self, message: str, status: str = "error"):
        super().__init__(message)
        self.status = status


async def bounded(fn: Callable[..., Any], *args, timeout: float = TIMEOUT_S, what: str = "source") -> Any:
    """Run blocking `fn` in a thread; any failure (including SystemExit, which the dataset helpers use) becomes SourceUnavailable."""

    def call():
        try:
            return fn(*args)
        except SystemExit as e:
            raise RuntimeError(str(e)) from e

    try:
        return await asyncio.wait_for(asyncio.to_thread(call), timeout)
    except asyncio.TimeoutError as e:
        raise SourceUnavailable(f"{what} did not answer within {timeout:g} s", "timeout") from e
    except Exception as e:  # noqa: BLE001 - never an unhandled error for the UI
        raise SourceUnavailable(f"{what}: {type(e).__name__}: {str(e)[:240]}") from e


# ---------------------------------------------------------------- hooks the tests replace (no network in tests)


def atlas_db():
    from ..dataset import mongo

    return mongo.connect(timeout_ms=4000, socket_timeout_ms=5000)


def tiger_conn():
    from ..dataset import tiger

    return tiger.connect(timeout=4, statement_timeout_ms=5000)


# ---------------------------------------------------------------- config status


def files_root() -> Path | None:
    for root in (config.DATASET_DIR, config.OUT_DIR / "dataset" / "tiny"):
        if (root / "conversations").is_dir() and (root / "network" / "network_elements.csv").exists():
            return root
    return None


def sources_status() -> dict:
    """What is configured, without any network call."""
    root = files_root()
    return {
        "files": {"configured": root is not None, "detail": f"dataset folder {root.name}" if root else "no dataset folder: run `ctx dataset generate --scale tiny`"},
        "atlas": {"configured": config.mongo_configured(), "detail": "MONGODB_URI set" if config.mongo_configured() else "MONGODB_URI is not set"},
        "tiger": {"configured": config.tiger_configured(), "detail": "TIGER_DATABASE_URL set" if config.tiger_configured() else "TIGER_DATABASE_URL is not set"},
        "embeddings": {"mode": embed.mode(), "model": bool(config.EMBEDDING_MODEL)},
    }


@router.get("")
async def status() -> dict:
    return sources_status()


# ---------------------------------------------------------------- shapes


def _iso(d) -> str | None:
    return d.isoformat() if isinstance(d, (datetime, date)) else d


def _summary(t: dict, dashboard_ids: set[str]) -> dict:
    msgs = t["messages"]
    authors: list[str] = []
    for m in msgs:
        if m["author"] not in authors:
            authors.append(m["author"])
    return {
        "id": t["id"], "source": t["source"], "subject": t.get("subject"),
        "started_at": _iso(msgs[0]["sent_at"]), "ended_at": _iso(msgs[-1]["sent_at"]),
        "n_messages": t.get("n_messages", len(msgs)), "authors": authors[:5],
        "preview": [{"seq": m.get("seq"), "author": m["author"], "role": m.get("role"), "sent_at": _iso(m["sent_at"]), "text": m["text"][:PREVIEW_CHARS]} for m in msgs[:PREVIEW_MESSAGES]],
        "in_dashboard": t["id"] in dashboard_ids,
    }


# ---------------------------------------------------------------- files: one scan per element, cached


_SCANS: OrderedDict[tuple, dict] = OrderedDict()
_SCAN_LIMIT = 64


def scan_files(root: Path, element: str) -> dict:
    """Every thread that names `element` (newest first) and the messages that name it, per day and per month."""
    key = (str(root), element, (root / "manifest.json").stat().st_mtime if (root / "manifest.json").exists() else 0)
    if key in _SCANS:
        _SCANS.move_to_end(key)
        return _SCANS[key]
    amap = load_alias_map(root)
    threads: list[dict] = []
    days: set[str] = set()
    months: dict[str, dict] = {}
    n_messages = 0
    for t in FileSource(root).threads(element=element):
        threads.append({**t, "n_messages": len(t["messages"])})
        for m in t["messages"]:
            if element in mentions({"messages": [m]}, amap):
                n_messages += 1
                days.add(m["sent_at"][:10])
                row = months.setdefault(m["sent_at"][:7], {"messages": 0, "people": set()})
                row["messages"] += 1
                row["people"].add(m.get("author_id") or m["author"])
    threads.sort(key=lambda t: t["messages"][0]["sent_at"], reverse=True)
    out = {
        "threads": threads, "messages": n_messages, "active_days": len(days), "last": max(days) if days else None,
        "by_month": [{"month": k, "messages": v["messages"], "people": len(v["people"])} for k, v in sorted(months.items())],
    }
    _SCANS[key] = out
    while len(_SCANS) > _SCAN_LIMIT:
        _SCANS.popitem(last=False)
    return out


def _days_since(last: str | None, now: datetime) -> int | None:
    return (now.date() - date.fromisoformat(last[:10])).days if last else None


def _ids(request: Request) -> set[str]:
    return set(request.app.state.wb.threads)


def _now(request: Request) -> datetime:
    return request.app.state.wb.now()


# ---------------------------------------------------------------- threads


def atlas_threads(db, element: str, offset: int, limit: int) -> tuple[int, list[dict]]:
    col = db["threads"]
    total = col.count_documents({"mentions": element})
    cursor = col.find({"mentions": element}, {"messages": {"$slice": PREVIEW_MESSAGES}}).sort("started_at", -1).skip(offset).limit(limit)
    rows = []
    for d in cursor:
        rows.append({"id": d["_id"], "source": d["source"], "subject": d.get("subject"), "messages": d["messages"], "n_messages": d.get("n_messages", len(d["messages"]))})
    return total, rows


@router.get("/elements/{element}/threads")
async def element_threads(element: str, request: Request, limit: int = 10, offset: int = 0) -> dict:
    limit, offset = max(1, min(limit, 50)), max(0, offset)
    base = {"element": element, "limit": limit, "offset": offset, "items": [], "total": 0, "has_more": False}
    ids = _ids(request)
    fallback = None
    if config.mongo_configured():
        try:
            def q():
                return atlas_threads(atlas_db(), element, offset, limit)

            total, rows = await bounded(q, what="MongoDB Atlas")
            items = [_summary(r, ids) for r in rows]
            return {**base, "source": "atlas", "status": "ok", "detail": None, "total": total, "items": items, "has_more": offset + len(items) < total}
        except SourceUnavailable as e:
            fallback = {"source": "atlas", "status": e.status, "detail": str(e)}
    root = files_root()
    if root is None:
        detail = "No dataset folder: run `ctx dataset generate --scale tiny` (or set DATASET_DIR)."
        if fallback:
            return {**base, "source": "atlas", "status": fallback["status"], "detail": f"{fallback['detail']}. {detail}"}
        return {**base, "source": "files", "status": "not_configured", "detail": detail}
    try:
        scan = await bounded(scan_files, root, element, timeout=FILES_TIMEOUT_S, what="Dataset files")
    except SourceUnavailable as e:
        return {**base, "source": "files", "status": e.status, "detail": str(e), **({"fallback_from": fallback} if fallback else {})}
    rows = scan["threads"][offset : offset + limit]
    out = {**base, "source": "files", "status": "ok", "detail": None, "total": len(scan["threads"]), "items": [_summary(r, ids) for r in rows]}
    out["has_more"] = offset + len(rows) < out["total"]
    if fallback:
        out["fallback_from"] = fallback
    return out


# ---------------------------------------------------------------- freshness


def tiger_freshness(element: str) -> dict:
    from ..dataset import tiger

    with tiger_conn() as conn:
        last, total, days = tiger.freshness(conn, element)
        rows = tiger.activity(conn, element, "1 month") if total else []
    return {
        "last": _iso(last)[:10] if last else None, "messages": int(total or 0), "active_days": int(days or 0),
        "by_month": [{"month": _iso(b)[:7], "messages": int(m), "people": int(p)} for b, m, p in rows],
    }


@router.get("/elements/{element}/freshness")
async def element_freshness(element: str, request: Request) -> dict:
    """When humans last talked about the element. Days are counted from the simulated now of the Dashboard."""
    now = _now(request)
    base = {"element": element, "last_discussed": None, "days_since": None, "messages": 0, "active_days": 0, "threads": None, "by_month": []}

    def done(source: str, data: dict, **extra) -> dict:
        return {**base, "source": source, "status": "ok", "detail": None, "last_discussed": data["last"], "days_since": _days_since(data["last"], now),
                "messages": data["messages"], "active_days": data["active_days"], "by_month": data["by_month"], **extra}

    fallback = None
    if config.tiger_configured():
        try:
            data = await bounded(tiger_freshness, element, what="Tiger Data")
            return done("tiger", data)
        except SourceUnavailable as e:
            fallback = {"source": "tiger", "status": e.status, "detail": str(e)}
    root = files_root()
    if root is None:
        detail = "No dataset folder: run `ctx dataset generate --scale tiny` (or set DATASET_DIR)."
        if fallback:
            return {**base, "source": "tiger", "status": fallback["status"], "detail": f"{fallback['detail']}. {detail}"}
        return {**base, "source": "files", "status": "not_configured", "detail": f"{detail} Tiger Data is not configured either (TIGER_DATABASE_URL)."}
    try:
        scan = await bounded(scan_files, root, element, timeout=FILES_TIMEOUT_S, what="Dataset files")
    except SourceUnavailable as e:
        return {**base, "source": "files", "status": e.status, "detail": str(e), **({"fallback_from": fallback} if fallback else {})}
    return done("files", scan, threads=len(scan["threads"]), **({"fallback_from": fallback} if fallback else {}))


# ---------------------------------------------------------------- similar knowledge


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def offline_similar(wb, q: str, entity: str | None, k: int) -> list[dict]:
    """Rank the Dashboard's own assertions by hashed-word similarity (finds similar wording, not meaning)."""
    qv = embed.hash_embed(q)
    scored = []
    for a in wb.store.assertions.values():
        text = " ".join(filter(None, [a.topic.replace("-", " "), a.summary, a.diagnosis, a.action, a.fact]))
        score = _cosine(qv, embed.hash_embed(text))
        if score > 0.05:
            scored.append((score, a))
    scored.sort(key=lambda x: -x[0])
    return [
        {"id": a.id, "topic": a.topic, "summary": a.summary, "score": round(s, 3), "trust": a.trust.level, "applies_to": sorted(a.applies_to)[:6], "bound_here": bool(entity and entity in a.about)}
        for s, a in scored[:k]
    ]


def atlas_similar(q: str, collection: str, k: int) -> list[dict]:
    from .. import mongo_store

    rows = mongo_store.similar(atlas_db(), collection, q, k)
    return [
        {"id": str(r.get("_id")), "topic": r.get("topic") or r.get("item", {}).get("topic"), "summary": r.get("summary") or r.get("item", {}).get("summary") or "",
         "score": round(float(r.get("score", 0)), 3), "trust": r.get("trust", {}).get("level") if isinstance(r.get("trust"), dict) else r.get("trust")}
        for r in rows
    ]


@router.get("/similar")
async def similar(request: Request, q: str, entity: str | None = None, limit: int = 5, collection: str = "assertions") -> dict:
    limit = max(1, min(limit, 20))
    if collection not in ("assertions", "facts"):
        collection = "assertions"
    wb = request.app.state.wb
    base = {"query": q, "mode": embed.mode(), "items": []}
    fallback = None
    if config.mongo_configured():
        try:
            items = await bounded(atlas_similar, q, collection, limit, timeout=15.0, what="MongoDB Atlas vector search")
            return {**base, "source": "atlas", "status": "ok", "detail": None, "items": items}
        except SourceUnavailable as e:
            fallback = {"source": "atlas", "status": e.status, "detail": str(e)}
    items = offline_similar(wb, q, entity, limit)
    detail = "Offline ranking of this dashboard's knowledge by shared words (MONGODB_URI is not set); a real embedding model in Atlas finds similar meaning." if not fallback else None
    out = {**base, "mode": f"hash:{embed.HASH_DIM}", "source": "dashboard", "status": "ok", "detail": detail, "items": items}
    if fallback:
        out["fallback_from"] = fallback
        out["detail"] = "Atlas failed, showing the offline word ranking of this dashboard's knowledge."
    return out

