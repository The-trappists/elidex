"""Pipeline processor: idle timers, one job at a time, idempotent re-processing of a whole thread.

Runs on the asyncio loop. Only the LLM call goes to a worker thread.
"""

from __future__ import annotations

import asyncio
import logging
import inspect
import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

from .. import config, llm
from ..link import Linker
from ..mvp.lifecycle import reconcile
from ..models import ContextAssertion, ExtractedItem, Thread
from ..understand import CachedExtractor, LLMExtractor
from . import dedupe
from .review import collect_flags
from .contracts import EvalResult, LiveThread, LlmCall, PipelineJob, Settings

if TYPE_CHECKING:
    from .state import Dashboard

log = logging.getLogger(__name__)


HOOK_NAMES = ("after_understand", "after_store", "after_reconcile")


@dataclass
class HookContext:
    """What a hook sees. `items` is the current item list; `new_assertions` is filled from after_store on."""

    wb: Any  # Dashboard
    job: PipelineJob
    thread: LiveThread
    core: Thread  # core models.Thread
    items: list[ExtractedItem]
    new_assertions: list[ContextAssertion] = field(default_factory=list)
    settings: Settings | None = None


def agents_quiet(ctx: HookContext) -> bool:
    """True when the LLM agents (critic, judge) must stay silent: no LLM key (scripted mode) or the job
    processes the seed at first start (no extra LLM calls)."""
    from ..connections import current_connection
    from ..demo_policy import current_policy
    registry = current_connection()
    personal = registry is not None and registry.ai is not None
    if current_policy() is not None and not personal:
        return True
    proc = getattr(ctx.wb, "processor", None)
    return not config.llm_configured() or (proc is not None and proc.is_bootstrap(ctx.job.thread_id))


_HOOKS: dict[str, list[Callable[[HookContext], Any]]] = defaultdict(list)


def register_hook(name: str, fn: Callable[[HookContext], Any]) -> None:
    """Register fn (sync or async) for "after_understand", "after_store" or "after_reconcile".

    after_understand may return a replacement list of ExtractedItem (None keeps the items).
    Exceptions are caught and noted in job.notes; a hook never fails the job."""
    if name not in HOOK_NAMES:
        raise ValueError(f"unknown hook {name!r}, expected one of {HOOK_NAMES}")
    if fn not in _HOOKS[name]:
        _HOOKS[name].append(fn)


def clear_hooks() -> None:
    _HOOKS.clear()


async def run_hooks(name: str, ctx: HookContext) -> list[ExtractedItem] | None:
    """Run the hooks of `name` in registration order. Returns the last replacement items, if any."""
    replacement: list[ExtractedItem] | None = None
    for fn in list(_HOOKS.get(name, ())):
        try:
            out = fn(ctx)
            if inspect.isawaitable(out):
                out = await out
            if name == "after_understand" and out is not None:
                replacement = list(out)
                ctx.items = replacement
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - never fail the job
            ctx.job.notes.append(f"hook {name}:{getattr(fn, '__name__', 'fn')} failed ({type(e).__name__}: {e})")
            log.warning("hook %s failed: %s", name, e)
    return replacement


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
    """Match on (type, scope, action similarity), not on the topic slug. See evaluation.match_items."""
    from ..evaluation import match_items

    return EvalResult(**match_items(items, expected, lambda i: _scope_key(i, inv)))


class Processor:
    def __init__(self, wb: Dashboard):
        self.wb = wb
        self.loop: asyncio.AbstractEventLoop | None = None
        self._lock: asyncio.Lock | None = None
        self._timers: dict[str, asyncio.TimerHandle] = {}
        self._running: set[str] = set()
        self._rerun: set[str] = set()
        self._pending: list[str] = []  # requested before start()
        self._tasks: set[asyncio.Task] = set()
        self._generation = 0
        self.bootstrap_threads: set[str] = set()  # seed threads not processed yet: critic and judge stay off

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
        self.bootstrap_threads.clear()

    def is_bootstrap(self, thread_id: str) -> bool:
        return thread_id in self.bootstrap_threads

    def forget(self, thread_id: str) -> None:
        """Drop the timer of a thread that is going away."""
        if h := self._timers.pop(thread_id, None):
            h.cancel()
        self._rerun.discard(thread_id)
        self.bootstrap_threads.discard(thread_id)
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

    async def process(self, thread_id: str, items: list[ExtractedItem] | None = None) -> None:
        """Run one job. `items` (operator re-run) replaces the extractor and the after_understand hooks."""
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
                await self._run(job, thread, gen, items)
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
            self.bootstrap_threads.discard(thread_id)  # later jobs of this thread use the user's settings
            collect_flags(job, wb)  # informational: the knowledge is already live
            wb.emit_changes(before)

    async def _run(self, job: PipelineJob, thread: LiveThread, gen: int, override: list[ExtractedItem] | None = None) -> None:
        wb = self.wb
        core = thread.to_thread()

        t0 = time.perf_counter()
        self._stage(job, "listen", "running")
        self._stage(job, "listen", "done", f"{len(thread.messages)} messages", t0)

        # --- understand
        t0 = time.perf_counter()
        self._stage(job, "understand", "running")
        if override is not None:
            items = list(override)
            job.extractor = "operator"
        else:
            items = await self._extract(job, thread, core)
        if gen != self._generation or thread.id not in wb.threads:
            return
        hook_ctx = HookContext(wb=wb, job=job, thread=thread, core=core, items=items, settings=wb.settings)
        if override is None and (replaced := await run_hooks("after_understand", hook_ctx)) is not None:
            items = replaced
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
        new, merged, deduped = [], 0, 0
        use_dedupe = wb.settings.use_dedupe
        if use_dedupe and config.EMBEDDING_MODEL and linked:  # fill the vector cache off the loop; fails silently
            await asyncio.to_thread(dedupe.warm_for, wb.store, [r.assertion for r in linked])
        for result in linked:
            for cls in result.classes:
                wb.store.add_class(cls)
            stored, is_new = wb.store.add_assertion(result.assertion)
            folded = None
            if is_new and use_dedupe:
                # A near-duplicate of an older valid assertion (not from this same job) folds into it.
                folded = dedupe.dedupe_new(wb, stored, skip_ids=set(job.assertion_ids))
                if folded:
                    stored, is_new, deduped = wb.store.assertions[folded.kept_id], False, deduped + 1
                    job.events.append(f"dedupe: folded into {folded.kept_id} ({folded.method} {round(folded.similarity * 100)}%)")
            if stored.id not in job.assertion_ids:
                job.assertion_ids.append(stored.id)
            if is_new:
                new.append(stored)
            elif not folded:
                merged += 1
                job.events.append(f"merged into {stored.id} (same knowledge, another source)")
        self._stage(job, "store", "done", f"{len(new)} new, {merged} merged, {deduped} deduped, {len(job.removed_assertion_ids)} removed", t0)
        hook_ctx.new_assertions = new
        await run_hooks("after_store", hook_ctx)
        if gen != self._generation or thread.id not in wb.threads:
            return

        # --- reconcile
        if wb.settings.lifecycle:
            t0 = time.perf_counter()
            self._stage(job, "reconcile", "running")
            for a in new:
                job.events += reconcile(wb.store, a)
            self._stage(job, "reconcile", "done", f"{len(job.events)} event(s)", t0)
        else:
            self._stage(job, "reconcile", "skipped", "lifecycle is off")
        await run_hooks("after_reconcile", hook_ctx)

    async def _extract(self, job: PipelineJob, thread: LiveThread, core) -> list[ExtractedItem]:
        wb = self.wb
        from ..connections import current_connection
        from ..demo_policy import current_policy, DemoLimitError
        registry = current_connection()
        if registry is not None and registry.ai is not None:
            try:
                return await self._extract_llm(job, core)
            except Exception as e:  # noqa: BLE001 - a personal key failure must not fail the job
                job.notes.append(f"Personal AI failed ({type(e).__name__}), fell back to scripted answers")
                return self._extract_scripted(job, thread, core)
        if registry is not None and not registry.allow_server_ai:
            return self._extract_scripted(job, thread, core)
        policy = current_policy()
        if policy is not None:
            try:
                policy.require_active()
            except DemoLimitError:
                return self._extract_scripted(job, thread, core)
            return await self._extract_llm(job, core)
        mode = wb.settings.extractor_mode
        if mode == "auto" and config.llm_configured():
            try:
                return await self._extract_llm(job, core)
            except Exception as e:  # noqa: BLE001 - auto mode falls back to scripted answers
                job.notes.append(f"LLM failed ({type(e).__name__}), fell back to scripted answers")
        elif mode == "llm":
            return await self._extract_llm(job, core)
        return self._extract_scripted(job, thread, core)

    async def _extract_llm(self, job: PipelineJob, core) -> list[ExtractedItem]:
        wb = self.wb
        if not config.llm_configured():
            raise RuntimeError("LLM not configured: set LLM_API_KEY (or GOOGLE_APPLICATION_CREDENTIALS) and LLM_MODEL in .env")
        extractor = LLMExtractor(cache_path=getattr(wb, "llm_cache_file", config.DASHBOARD_LLM_CACHE_FILE))
        topics = sorted({a.topic for a in wb.store.assertions.values()})
        job.extractor = f"llm:{llm.active_model() or config.LLM_MODEL}"
        self._touch(job)
        try:
            return await asyncio.to_thread(extractor.extract, core, topics, wb.now())
        finally:
            job.llm_call_ids = [t["id"] for t in extractor.last_traces]
            ok = [t for t in extractor.last_traces if not t["error"]]
            if ok and ok[-1]["provider"] == "fallback":
                job.extractor = f"llm:{ok[-1]['model']} (fallback)"

    def _extract_scripted(self, job: PipelineJob, thread: LiveThread, core) -> list[ExtractedItem]:
        wb = self.wb
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


def install_llm_sinks(wb: Dashboard, loop: asyncio.AbstractEventLoop):
    """Trace every LLM call to the JSONL file and to the live state. Returns a function that removes the sinks."""
    file_sink = llm.jsonl_sink(config.DASHBOARD_LLM_CALLS_FILE)

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
