"""Compaction of the AI activity log (out/dashboard/llm_calls.jsonl).

The log only grows, so a job keeps what is still useful and moves the rest to
`archive/llm_calls.jsonl` (appended first, never deleted). Rules, applied to wall-clock `ts`:

1. every call of the last RECENT_HOURS is kept;
2. every error or parse failure of the last ERROR_HOURS is kept (debugging);
3. the newest call of each (purpose, thread_id, model) group is kept;
4. older than RECENT_HOURS, a call is dropped when its thread no longer exists, or when an identical
   request (same system + user text) was made again later (only the newest stays);
5. the log is capped at MAX_KEPT calls (oldest go first).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from .. import config, llm
from .contracts import LlmCall, LlmSummary, to_local_naive
from .state import Dashboard

RECENT_HOURS = 2
ERROR_HOURS = 24
MAX_KEPT = 500
INTERVAL_S = 600  # wall seconds between two runs


_naive = to_local_naive  # aware (new lines) -> local naive; naive (old lines) is already local


def is_failure(c: LlmCall) -> bool:
    return bool(c.error) or c.parsed_ok is False or bool(c.parse_error)


def _request_hash(c: LlmCall) -> str:
    return hashlib.sha1(f"{c.system}\x00{c.user}".encode()).hexdigest()


def compact_calls(calls: list[LlmCall], now: datetime, thread_ids: set[str]) -> tuple[list[LlmCall], list[LlmCall]]:
    """Pure rules. Returns (kept, removed), both oldest first."""
    now = _naive(now)
    recent_from = now - timedelta(hours=RECENT_HOURS)
    error_from = now - timedelta(hours=ERROR_HOURS)
    ordered = sorted(calls, key=lambda c: _naive(c.ts))
    newest_group: dict[tuple, str] = {}
    newest_request: dict[str, str] = {}
    for c in ordered:  # later ones overwrite: the newest id wins
        newest_group[(c.purpose, c.thread_id, c.model)] = c.id
        newest_request[_request_hash(c)] = c.id
    kept: list[LlmCall] = []
    for c in ordered:
        ts = _naive(c.ts)
        if ts >= recent_from or (is_failure(c) and ts >= error_from):
            kept.append(c)
        elif c.thread_id and c.thread_id not in thread_ids:
            continue
        elif newest_request[_request_hash(c)] != c.id:
            continue
        elif newest_group[(c.purpose, c.thread_id, c.model)] == c.id:
            kept.append(c)
    kept = kept[-MAX_KEPT:]
    kept_ids = {c.id for c in kept}
    return kept, [c for c in ordered if c.id not in kept_ids]


@dataclass
class CompactResult:
    kept: int = 0
    removed_ids: set[str] = field(default_factory=set)
    moved: int = 0  # lines moved to the archive (also counts unreadable lines)


def compact_file(live: Path, archive: Path, now: datetime, thread_ids: set[str]) -> CompactResult:
    """Compact the JSONL file. Holds llm.FILE_LOCK, so sink appends wait instead of being lost.

    Order: read, append the removed lines to the archive (flushed), then write a temp file and rename it."""
    live, archive = Path(live), Path(archive)
    with llm.FILE_LOCK:
        if not live.exists():
            return CompactResult()
        lines = [x for x in live.read_text(encoding="utf-8").splitlines() if x.strip()]
        parsed: list[tuple[str, LlmCall | None]] = []
        for line in lines:
            try:
                parsed.append((line, LlmCall.model_validate_json(line)))
            except Exception:  # noqa: BLE001
                parsed.append((line, None))
        calls = [c for _, c in parsed if c is not None]
        kept, removed = compact_calls(calls, now, thread_ids)
        removed_ids = {c.id for c in removed}
        kept_ids = {c.id for c in kept}
        drop = [line for line, c in parsed if c is None or c.id not in kept_ids]
        if not drop:
            return CompactResult(kept=len(kept), removed_ids=set())
        archive.parent.mkdir(parents=True, exist_ok=True)
        with archive.open("a", encoding="utf-8") as f:
            f.write("\n".join(drop) + "\n")
            f.flush()
            os.fsync(f.fileno())
        keep_lines = [line for line, c in parsed if c is not None and c.id in kept_ids]
        tmp = live.with_name(live.name + ".tmp")
        tmp.write_text("".join(x + "\n" for x in keep_lines), encoding="utf-8")
        os.replace(tmp, live)
        return CompactResult(kept=len(kept), removed_ids=removed_ids, moved=len(drop))


def archive_path(live: Path) -> Path:
    return Path(live).parent / "archive" / "llm_calls.jsonl"


def _count_lines(path: Path) -> int:
    try:
        with Path(path).open(encoding="utf-8") as f:
            return sum(1 for x in f if x.strip())
    except OSError:
        return 0


def summarize(calls: list[LlmCall], archived_total: int, last_at: datetime | None, last_removed: int) -> LlmSummary:
    by_purpose: dict[str, int] = {}
    for c in calls:
        by_purpose[c.purpose] = by_purpose.get(c.purpose, 0) + 1
    times = sorted(_naive(c.ts) for c in calls)
    return LlmSummary(
        total_kept=len(calls), by_purpose=by_purpose, errors_kept=sum(1 for c in calls if is_failure(c)),
        oldest=times[0] if times else None, newest=times[-1] if times else None,
        archived_total=archived_total, last_compacted_at=last_at, last_removed=last_removed,
    )


class LlmCompactor:
    """Runs the compaction on the app's dashboard; stats live here (reset on restart, archive count is re-read)."""

    def __init__(self, wb: Dashboard):
        self.wb = wb
        self.last_at: datetime | None = None
        self.last_removed = 0
        self.archived_total: int | None = None
        self._run_lock = asyncio.Lock()

    async def summary(self) -> LlmSummary:
        from .persistence import read_llm_calls

        live = getattr(self.wb, "llm_calls_file", config.DASHBOARD_LLM_CALLS_FILE)
        if self.archived_total is None:
            self.archived_total = await asyncio.to_thread(_count_lines, archive_path(live))
        by_id = {c.id: c for c in await asyncio.to_thread(read_llm_calls, live)}
        by_id.update({c.id: c for c in self.wb.llm_calls})
        return summarize(list(by_id.values()), self.archived_total, self.last_at, self.last_removed)

    async def run_once(self) -> LlmSummary:
        async with self._run_lock:
            live = getattr(self.wb, "llm_calls_file", config.DASHBOARD_LLM_CALLS_FILE)
            arch = archive_path(live)
            if self.archived_total is None:
                self.archived_total = await asyncio.to_thread(_count_lines, arch)
            now = datetime.now()
            res = await asyncio.to_thread(compact_file, live, arch, now, set(self.wb.threads))
            if res.removed_ids:
                self.wb.llm_calls = [c for c in self.wb.llm_calls if c.id not in res.removed_ids]
            self.archived_total += res.moved
            self.last_at, self.last_removed = now, res.moved
            self.wb.emit("log", {"level": "info", "text": f"AI activity log compacted: {res.moved} moved to the archive, {res.kept} kept"})
            return await self.summary()

    async def run_forever(self) -> None:
        while True:
            await self.run_once()
            await asyncio.sleep(INTERVAL_S)
