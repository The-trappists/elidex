"""Pipeline processor: idle timers, one job at a time, idempotent re-processing of a whole thread.

Runs on the asyncio loop. Only the LLM call goes to a worker thread.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import TYPE_CHECKING, Any

from .. import config, llm
from ..link import Linker
from ..mvp.lifecycle import reconcile
from ..models import ExtractedItem
from ..understand import CachedExtractor, LLMExtractor
from .contracts import EvalResult, LiveThread, LlmCall, PipelineJob

if TYPE_CHECKING:
    from .state import Workbench

log = logging.getLogger(__name__)


def _scope_key(item: ExtractedItem, inv) -> tuple:
    """What an item binds to, normalised, to compare extracted and expected items."""
    inst = set()
    for raw in item.scope.instance_ids:
        el = inv.resolve_element(raw)
        inst.add(el.id if el else raw.lower())
    sites = set()
    for raw in item.scope.site_ids:
        s = inv.resolve_site(raw)
        sites.add(s.id if s else raw.lower())
    cls = item.scope.element_class.class_id() if item.scope.element_class else None
    return (tuple(sorted(inst)), tuple(sorted(sites)), cls, item.scope.trigger)


def evaluate(items: list[ExtractedItem], expected: list[ExtractedItem], inv) -> EvalResult:
    """Match on (type, topic). Same scope: matched. Different scope: a note in binding_diffs."""
    result = EvalResult()
    got = {(i.type, i.topic): i for i in items}
    want = {(i.type, i.topic): i for i in expected}
    for key, w in want.items():
        g = got.get(key)
        if g is None:
            result.missed.append(key[1])
        elif _scope_key(g, inv) == _scope_key(w, inv):
            result.matched.append(key[1])
        else:
            result.binding_diffs.append(f"{key[1]}: expected {_scope_key(w, inv)}, got {_scope_key(g, inv)}")
    result.unexpected = [k[1] for k in got if k not in want]
    return result


class Processor:
    def __init__(self, wb: Workbench):
        self.wb = wb
        self.loop: asyncio.AbstractEventLoop | None = None
        self._lock: asyncio.Lock | None = None
        self._timers: dict[str, asyncio.TimerHandle] = {}
        self._running: set[str] = set()
        self._rerun: set[str] = set()
        self._pending: list[str] = []  # requested before start()
        self._tasks: set[asyncio.Task] = set()
        self._generation = 0

    # ------------------------------------------------------------ lifecycle

    def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        self._lock = asyncio.Lock()
        pending, self._pending = self._pending, []
        for tid in pending:
            self._launch(tid)

    def stop(self) -> None:
        self.reset()
        self.loop = None

    def reset(self) -> None:
        """Cancel timers and running jobs (used before the state is replaced)."""
        self._generation += 1
        for h in self._timers.values():
            h.cancel()
        self._timers.clear()
        for t in list(self._tasks):
            t.cancel()
        self._tasks.clear()
        self._running.clear()
        self._rerun.clear()
        self._pending.clear()

    def forget(self, thread_id: str) -> None:
        """Drop the timer of a thread that is going away."""
        if h := self._timers.pop(thread_id, None):
            h.cancel()
        self._rerun.discard(thread_id)
        if thread_id in self._pending:
            self._pending.remove(thread_id)

    # ------------------------------------------------------------ scheduling

    def request(self, thread_id: str, immediate: bool = False) -> None:
        if self.loop is None:
            if thread_id not in self._pending:
                self._pending.append(thread_id)
            return
        if h := self._timers.pop(thread_id, None):
            h.cancel()
        if immediate:
            self._launch(thread_id)
        else:
            self._timers[thread_id] = self.loop.call_later(self.wb.settings.idle_seconds, self._launch, thread_id)

    def _launch(self, thread_id: str) -> None:
        self._timers.pop(thread_id, None)
        if thread_id in self._running:
            self._rerun.add(thread_id)
            return
        self._running.add(thread_id)
        task = self.loop.create_task(self._run_until_quiet(thread_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run_until_quiet(self, thread_id: str) -> None:
        try:
            while True:
                self._rerun.discard(thread_id)
                await self.process(thread_id)
                if thread_id not in self._rerun:
                    break
        finally:
            self._running.discard(thread_id)

    # ------------------------------------------------------------ idempotence

    def retract(self, thread_id: str) -> list[str]:
        """Remove this thread's sources, delete assertions left without one, reopen what they closed.
        Returns the ids of the deleted assertions."""
        wb = self.wb
        gone: set[str] = set()
        for a in list(wb.store.assertions.values()):
            kept = [s for s in a.sources if s.file != thread_id]
            if len(kept) != len(a.sources):
                a.sources = kept
                if not kept:
                    gone.add(a.id)
        wb.drop_assertions(gone)
        return sorted(gone)

    # ------------------------------------------------------------ the job

    def _touch(self, job: PipelineJob) -> None:
        self.wb.emit("pipeline.job", job)

    def _stage(self, job: PipelineJob, name: str, status: str, detail: str = "", t0: float | None = None) -> None:
        st = next(s for s in job.stages if s.stage == name)
        st.status = status  # type: ignore[assignment]
        st.detail = detail
        if t0 is not None:
            st.duration_ms = int((time.perf_counter() - t0) * 1000)
        self._touch(job)

    async def process(self, thread_id: str) -> None:
        wb = self.wb
        if thread_id not in wb.threads:
            return
        async with self._lock:
            thread = wb.threads.get(thread_id)
            if thread is None:
                return
            gen = self._generation
            job = wb.new_job(thread_id)
            thread.last_job_id, thread.status = job.id, "processing"
            wb._thread_event(thread)
            self._touch(job)
            n_messages = len(thread.messages)
            before = wb.assertion_snapshot()
            failed = False
            try:
                await self._run(job, thread, gen)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - shown in the UI
                failed = True
                job.error = f"{type(e).__name__}: {e}"
                running = next((s for s in job.stages if s.status == "running"), None)
                if running:
                    running.status = "error"
                    running.detail = str(e)[:300]
                log.warning("job %s failed: %s", job.id, e)
            if gen != self._generation or thread_id not in wb.threads:
                return  # state was replaced or the thread deleted while we worked
            job.finished_at = datetime.now()
            self._touch(job)
            thread.status = "error" if failed else ("active" if len(thread.messages) > n_messages else "processed")
            wb._thread_event(thread)
            wb.emit_changes(before)

    async def _run(self, job: PipelineJob, thread: LiveThread, gen: int) -> None:
        wb = self.wb
        core = thread.to_thread()

        t0 = time.perf_counter()
        self._stage(job, "listen", "running")
        self._stage(job, "listen", "done", f"{len(thread.messages)} messages", t0)

        # --- understand
        t0 = time.perf_counter()
        self._stage(job, "understand", "running")
        items = await self._extract(job, thread, core)
        if gen != self._generation or thread.id not in wb.threads:
            return
        job.items = items
        scenario = wb.scenarios.get(thread.scenario_id) if thread.scenario_id else None
        if job.extractor.startswith("llm") and scenario and scenario.expected:
            job.eval = evaluate(items, scenario.expected.items, wb.store.inventory)
        self._stage(job, "understand", "done", f"{len(items)} item(s) from {job.extractor}", t0)

        # --- link
        t0 = time.perf_counter()
        self._stage(job, "link", "running")
        linker = Linker(wb.store.inventory)
        linked = []
        for item in items:
            if item.type == "invalidation" and not wb.settings.lifecycle:
                job.notes.append(f"skipped invalidation of '{item.topic}' (lifecycle is off)")
                continue
            result = linker.link(item, core)
            job.notes += result.notes
            if result.assertion is not None:
                linked.append(result)
        self._stage(job, "link", "done", f"{len(linked)} linked, {len(items) - len(linked)} not stored", t0)

        # --- store (re-processing: retract first)
        t0 = time.perf_counter()
        self._stage(job, "store", "running")
        job.removed_assertion_ids = self.retract(thread.id)
        new, merged = [], 0
        for result in linked:
            for cls in result.classes:
                wb.store.add_class(cls)
            stored, is_new = wb.store.add_assertion(result.assertion)
            if stored.id not in job.assertion_ids:
                job.assertion_ids.append(stored.id)
            if is_new:
                new.append(stored)
            else:
                merged += 1
                job.events.append(f"merged into {stored.id} (same knowledge, another source)")
        self._stage(job, "store", "done", f"{len(new)} new, {merged} merged, {len(job.removed_assertion_ids)} removed", t0)

        # --- reconcile
        if wb.settings.lifecycle:
            t0 = time.perf_counter()
            self._stage(job, "reconcile", "running")
            for a in new:
                job.events += reconcile(wb.store, a)
            self._stage(job, "reconcile", "done", f"{len(job.events)} event(s)", t0)
        else:
            self._stage(job, "reconcile", "skipped", "lifecycle is off")

    async def _extract(self, job: PipelineJob, thread: LiveThread, core) -> list[ExtractedItem]:
        wb = self.wb
        mode = wb.settings.extractor_mode
        if mode == "auto":
            mode = "llm" if config.llm_configured() else "scripted"
        if mode == "llm":
            if not config.llm_configured():
                raise RuntimeError("LLM not configured: set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in .env")
            extractor = LLMExtractor(cache_path=config.WORKBENCH_LLM_CACHE_FILE)
            topics = sorted({a.topic for a in wb.store.assertions.values()})
            job.extractor = f"llm:{config.LLM_MODEL}"
            self._touch(job)
            try:
                return await asyncio.to_thread(extractor.extract, core, topics, wb.now())
            finally:
                job.llm_call_ids = [t["id"] for t in extractor.last_traces]
                ok = [t for t in extractor.last_traces if not t["error"]]
                if ok and ok[-1]["provider"] == "fallback":
                    job.extractor = f"llm:{ok[-1]['model']} (fallback)"
        scenario = wb.scenarios.get(thread.scenario_id) if thread.scenario_id else None
        if scenario and scenario.expected:
            job.extractor = "scripted"
            return list(scenario.expected.items)
        cached = CachedExtractor()
        if thread.id in cached.cache:
            job.extractor = "cache"
            return cached.extract(core, [])
        job.extractor = "none"
        job.notes.append("scripted mode: no ground truth for this thread")
        return []


def install_llm_sinks(wb: Workbench, loop: asyncio.AbstractEventLoop):
    """Trace every LLM call to the JSONL file and to the live state. Returns a function that removes the sinks."""
    file_sink = llm.jsonl_sink(config.WORKBENCH_LLM_CALLS_FILE)

    def record(call: LlmCall) -> None:  # runs on the loop
        wb.llm_calls.append(call)
        del wb.llm_calls[:-500]
        wb.emit("llm.call", call)

    def live_sink(trace: dict[str, Any]) -> None:  # runs in worker threads
        try:
            call = LlmCall.model_validate(trace)
        except Exception:  # noqa: BLE001
            return
        loop.call_soon_threadsafe(record, call)

    llm.add_trace_sink(file_sink)
    llm.add_trace_sink(live_sink)

    def remove() -> None:
        llm.remove_trace_sink(file_sink)
        llm.remove_trace_sink(live_sink)

    return remove
