"""Company day: a simulated working day of the whole company (docs/workbench.md, "Company day").

Many chats run in parallel from a timeline (`data/workbench/company/day.json`), incidents open and close, the
pipeline grows the knowledge graph, and every `cycle_minutes` of sim time Elisa's autonomous network system takes the
current knowledge package, asks the context layer about every affected element and updates the network status.
Incidents are scripted ground truth: nothing here detects a fault. All state changes happen on the event loop thread."""

from __future__ import annotations

import asyncio
import json
import random
import threading
import time
from datetime import datetime, timedelta
from typing import Any

from .. import agent as agent_mod
from .. import config
from .contracts import (
    AgentCall,
    CompanyCycle,
    CompanyStartBody,
    CompanyState,
    CompanyTimelineEntry,
    ElementHealth,
    Incident,
    KnowledgePackage,
    SettingsPatch,
    StatusChange,
)
from .archive import Archive
from .chatgen import ChatGenerator, LlmPrefetcher, activity_level
from .simulator import Simulator
from .state import Workbench

TICK_S = 0.25
DAY_FILE = config.WORKBENCH_SEED_DIR / "company" / "day.json"
DAY_START_HOUR = 8
MAX_CYCLES, MAX_CALLS = 60, 200
MAX_THREADS, MAX_RUNS, MAX_JOBS, MAX_LLM_CALLS, MAX_GENERATED_ENTRIES = 150, 100, 200, 500, 100
MAX_ACTIVE_GENERATED = 4
BURST_STALE = timedelta(minutes=10)
MAX_GAP_MIN = 360  # a quiet period never stalls the day for more than 6 sim hours
GEN_EVERY_MIN = (8, 25)  # sim minutes between two generated chats
CLOSED_INCIDENT_KEEP = timedelta(hours=6)
HEALTHY_KEEP = timedelta(hours=2)
AUTO_RESOLVE_AFTER = timedelta(hours=3)
SEVERITY_RANK = {"minor": 0, "major": 1, "critical": 2}


def load_timeline(path=DAY_FILE) -> list[CompanyTimelineEntry]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    entries = [CompanyTimelineEntry.model_validate(r) for r in rows]
    return sorted(entries, key=lambda e: e.at_min)


# ---------------------------------------------------------------- the knowledge package and its export


def _valid_assertions(wb: Workbench, at: datetime, valid_only: bool) -> list:
    items = [a for a in wb.store.assertions.values() if not valid_only or a.is_valid_at(at)]
    return sorted(items, key=lambda a: a.id)


def package_summary(wb: Workbench, cycle: int, at: datetime, prev_ids: set[str], prev_valid: set[str]) -> KnowledgePackage:
    """Light summary handed over at a sync. `prev_ids`/`prev_valid`: ids in the store / valid at the previous sync."""
    store = wb.store
    valid = {a.id: a for a in store.assertions.values() if a.is_valid_at(at)}
    trust: dict[str, int] = {}
    for a in valid.values():
        trust[a.trust.level] = trust.get(a.trust.level, 0) + 1
    return KnowledgePackage(
        cycle=cycle,
        at=at,
        total=len(store.assertions),
        valid=len(valid),
        new_ids=sorted(set(store.assertions) - prev_ids),
        closed_ids=sorted(prev_valid - set(valid)),
        classes=len(store.classes),
        trust=trust,
    )


def export_package(wb: Workbench, at: datetime | None = None, valid_only: bool = True) -> dict[str, Any]:
    """The knowledge graph as plain data: assertions, element classes, bindings and sources.

    Reusable by any page: `at` defaults to the sim now, `valid_only` keeps the assertions valid at `at`."""
    at = at or wb.now()
    assertions = _valid_assertions(wb, at, valid_only)
    bindings: dict[str, dict[str, Any]] = {}
    sources: dict[tuple, dict[str, Any]] = {}
    for a in assertions:
        for b in a.bound_to:
            if b.entity in wb.elements:
                kind = "element"
            elif b.entity in wb.sites:
                kind = "site"
            elif b.entity.startswith("class:"):
                kind = "class"
            else:
                kind = "other"
            row = bindings.setdefault(b.entity, {"entity": b.entity, "kind": kind, "assertions": []})
            row["assertions"].append({"assertion_id": a.id, "role": b.role})
        for s in a.sources:
            key = (s.source, s.file, tuple(s.seq))
            row = sources.setdefault(key, {"source": s.source, "file": s.file, "seq": list(s.seq), "assertion_ids": []})
            if a.id not in row["assertion_ids"]:
                row["assertion_ids"].append(a.id)
    used_classes = {e for e, r in bindings.items() if r["kind"] == "class"}
    classes = [c for c in wb.store.classes.values() if not valid_only or c.id in used_classes]
    class_members = {
        c.id: sorted(e.id for e in wb.elements.values() if c.criteria.matches(e)) for c in classes
    }
    return {
        "exported_at": at.isoformat(),
        "valid_only": valid_only,
        "counts": {
            "assertions": len(assertions),
            "classes": len(classes),
            "elements_bound": sum(1 for r in bindings.values() if r["kind"] == "element"),
            "sources": len(sources),
        },
        "assertions": [a.model_dump(mode="json") for a in assertions],
        "classes": [c.model_dump(mode="json") for c in classes],
        "class_members": class_members,
        "bindings": sorted(bindings.values(), key=lambda r: (r["kind"], r["entity"])),
        "sources": sorted(sources.values(), key=lambda r: (r["source"], r["file"], r["seq"])),
    }


def render_markdown(pkg: dict[str, Any], title: str = "Knowledge package") -> str:
    """A readable report of an `export_package` result."""
    c = pkg["counts"]
    out = [
        f"# {title}",
        "",
        f"Sim time: {pkg['exported_at']} · {'valid assertions only' if pkg['valid_only'] else 'all assertions'}",
        f"{c['assertions']} assertions · {c['classes']} classes · {c['elements_bound']} elements · {c['sources']} sources",
        "",
    ]
    if pkg.get("classes"):
        out += ["## Element classes", ""]
        for cl in pkg["classes"]:
            members = pkg["class_members"].get(cl["id"], [])
            out.append(f"- `{cl['id']}`: {cl['label']} ({len(members)} elements: {', '.join(members[:12])})")
        out.append("")
    out += ["## Assertions", ""]
    for a in pkg["assertions"]:
        trust = a["trust"]
        who = trust.get("stated_by") or "unknown"
        until = a["valid_to"] or "now"
        out.append(f"### {a['id']} · {a['topic']}")
        out.append(f"{a['summary']}")
        out.append("")
        out.append(f"- Type: {a['type']} · trust {trust['level']} ({who}) · confidence {a['confidence']:.2f}")
        out.append(f"- Valid: {a['valid_from']} to {until}")
        out.append("- Bound to: " + ", ".join(f"{b['entity']} ({b['role']})" for b in a["bound_to"]))
        if a.get("conditions"):
            out.append("- When: " + "; ".join(x["text"] for x in a["conditions"]))
        if a.get("diagnosis"):
            out.append(f"- Diagnosis: {a['diagnosis']}")
        if a.get("action"):
            out.append(f"- Do: {a['action']}")
        if a.get("avoid"):
            out.append("- Avoid: " + "; ".join(a["avoid"]))
        if a.get("fact") and a["fact"] != a["summary"]:
            out.append(f"- Fact: {a['fact']}")
        if a.get("conflicts_with"):
            out.append("- Conflicts with: " + ", ".join(a["conflicts_with"]))
        if a.get("closed_by"):
            out.append(f"- Closed by: {a['closed_by']}")
        out.append("- Sources: " + " | ".join(f"{s['source']} {s['file']}" + (f" seq {','.join(map(str, s['seq']))}" if s.get("seq") else "") for s in a["sources"]))
        out.append("")
    return "\n".join(out).rstrip() + "\n"


# ---------------------------------------------------------------- the company day


class _Stale(Exception):
    """The session ended (stop or restart) while a sync was waiting for the agent."""


def summarize_clear(r: dict) -> str:
    atlas = r["atlas"]
    if isinstance(atlas, dict):
        atlas = ", ".join(f"{k}={v}" for k, v in atlas.items())
    return f"{r['files_removed']} files, atlas {atlas}, tiger {r['tiger']}"


class CompanyDay:
    def __init__(self, wb: Workbench, sim: Simulator, timeline_path=DAY_FILE, burst_p: float = 0.12, archive: Archive | None = None):
        self.wb = wb
        self.archive = archive if archive is not None else Archive(None, atlas=False, tiger=False)  # no files by default
        self.sim = sim
        self.timeline_path = timeline_path
        self.st = CompanyState()
        self._cycles: list[CompanyCycle] = []
        self._calls: list[AgentCall] = []
        self._health: dict[str, ElementHealth] = {}
        self._call_n = 0
        self._cycle_no = 0  # monotonic: _cycles is capped
        self._prev_ids: set[str] = set()
        self._prev_valid: set[str] = set()
        self._prev_at: datetime | None = None
        self._kicked: set[str] = set()  # run ids whose thread was handed to the pipeline
        self._posted: set[tuple[str, str]] = set()  # (element, assertion) already announced to the outcome loop
        self.seed = 2026
        self.burst_p = burst_p  # chance that a generated chat triggers a burst of 1-2 more within a few minutes
        self._bursts: list[datetime] = []
        self._burst_els: set[str] = set()
        self._gen_level = 1.0
        self.chatgen = ChatGenerator(wb, seed=self.seed)
        self._rng = random.Random(self.seed)
        self._next_gen_at: datetime | None = None
        self.prefetch = LlmPrefetcher(self.chatgen, self._gaps)
        self._gen = 0  # bumped by start and stop: an awaiting cycle of an older session drops its result
        self._auto_sim_before: bool | None = None  # auto_sim as it was before the day turned it off
        self._last_error: tuple[str, float] = ("", 0.0)

    # ------------------------------------------------------------ public

    async def run_forever(self) -> None:
        prefetch = asyncio.get_running_loop().create_task(self.prefetch.run())
        try:
            while True:
                try:
                    await self.tick()
                except Exception as e:  # noqa: BLE001 - the loop must never die
                    msg = f"company day tick failed: {type(e).__name__}: {e}"
                    if msg != self._last_error[0] or time.monotonic() - self._last_error[1] > 30:  # no log flood
                        self._last_error = (msg, time.monotonic())
                        self._log("error", msg)
                await asyncio.sleep(TICK_S)
        finally:
            prefetch.cancel()

    def _gaps(self) -> list[str]:
        return [h.element_id for h in self._health.values() if h.status in ("degraded", "down") and not h.applied_assertion_ids]

    def state(self) -> CompanyState:
        return self.st.model_copy(
            update={
                "cycles": self._cycles[-MAX_CYCLES:],
                "calls": self._calls[-MAX_CALLS:],
                "health": sorted(self._health.values(), key=lambda h: h.element_id),
            }
        )

    def start(self, body: CompanyStartBody) -> CompanyState:
        wb = self.wb
        if self.st.status in ("running", "paused"):
            raise RuntimeError("the company day is already running")
        if body.reset == "empty":
            wb.reset("empty")
        self._gen += 1
        if body.reset == "empty" and body.clear_archive:
            self._clear_archive_async(self._gen)
        self._auto_sim_before = wb.settings.auto_sim
        wb.update_settings(SettingsPatch(auto_sim=False))  # the timeline is the only source of chats (restored on stop)
        now = wb.now()
        if now.tzinfo is not None:  # a clock set with a UTC offset would break every naive comparison
            now = now.replace(tzinfo=None)
        start = now.replace(hour=DAY_START_HOUR, minute=0, second=0, microsecond=0) if body.reset == "empty" else now
        wb.clock.set(start)
        wb.clock.set_speed(body.speed)
        wb.clock.start()
        self._cycles, self._calls, self._health, self._call_n, self._cycle_no = [], [], {}, 0, 0
        self._kicked, self._posted = set(), set()
        self.chatgen = ChatGenerator(wb, seed=self.seed)
        self.prefetch.chatgen = self.chatgen
        self._rng = random.Random(self.seed)
        self._next_gen_at, self._bursts, self._burst_els = None, [], set()
        endless = body.day_minutes == 0
        self.prefetch.enable(body.use_llm and endless)
        self._prev_ids = set(wb.store.assertions)
        self._prev_valid = {a.id for a in wb.store.assertions.values() if a.is_valid_at(start)}
        self._prev_at = start
        self.st = CompanyState(
            status="running",
            started_at=start,
            ends_at=None if endless else start + timedelta(minutes=body.day_minutes),
            endless=endless,
            day_minutes=body.day_minutes,
            cycle_minutes=body.cycle_minutes,
            speed=body.speed,
            use_llm=body.use_llm,
            next_cycle_at=start + timedelta(minutes=body.cycle_minutes),
            timeline=[e for e in load_timeline(self.timeline_path) if endless or e.at_min < body.day_minutes],
        )
        self._log("info", f"company day started: {len(self.st.timeline)} chats, a sync every {body.cycle_minutes} min")
        self._emit_state()
        wb.emit("clock", wb.clock.state())
        return self.state()

    def _clear_archive_async(self, gen: int | None = None) -> None:
        """Empty the cold archive in a worker thread. Pending writes are discarded right now; writes of the new day
        wait inside the archive until the wipe is done, so nothing stale or new is lost or left over."""
        epoch = self.archive.discard_pending()
        loop = self.wb.bus.loop

        def work() -> None:
            result = self.archive.clear(epoch)
            if gen is not None and gen != self._gen:
                return  # the session ended meanwhile: nothing to report to it
            text = "archive cleared: " + summarize_clear(result)
            if loop is not None and not loop.is_closed():
                loop.call_soon_threadsafe(self._log, "info", text)

        threading.Thread(target=work, name="wb-archive-clear", daemon=True).start()

    def pause(self) -> CompanyState:
        if self.st.status == "running":
            self.wb.clock.pause()
            self.st.status = "paused"
            self._emit_state()
            self.wb.emit("clock", self.wb.clock.state())
        return self.state()

    def resume(self) -> CompanyState:
        if self.st.status == "paused":
            self.wb.clock.start()
            self.st.status = "running"
            self._emit_state()
            self.wb.emit("clock", self.wb.clock.state())
        return self.state()

    def stop(self) -> CompanyState:
        """Back to idle; the data (cycles, calls, health, knowledge) stays."""
        if self.st.status in ("running", "paused"):
            self._gen += 1
            self.wb.clock.pause()
            self.st.status = "idle"
            self.st.next_cycle_at = None
            self._end_session()
            self._emit_state()
            self.wb.emit("clock", self.wb.clock.state())
        return self.state()

    def _end_session(self) -> None:
        """Stop or finish: give the settings back and drop the queued LLM chats."""
        self.prefetch.enable(False)
        if self._auto_sim_before is not None:
            if not self.wb.settings.auto_sim:  # unless the user switched it on again meanwhile
                self.wb.update_settings(SettingsPatch(auto_sim=self._auto_sim_before))
            self._auto_sim_before = None

    # ------------------------------------------------------------ loop

    async def tick(self) -> None:
        st, wb = self.st, self.wb
        if st.status != "running" or st.started_at is None or (st.ends_at is None and not st.endless):
            return
        now = wb.now()
        self._start_due(now)
        if st.endless:
            await self._generate_due(now)
        self._kick_processing()
        horizon = now if st.ends_at is None else min(now, st.ends_at)
        while st.status == "running" and st.next_cycle_at is not None and st.next_cycle_at <= horizon:
            at = st.next_cycle_at
            nxt = at + timedelta(minutes=st.cycle_minutes)
            st.next_cycle_at = nxt if (st.ends_at is None or nxt <= st.ends_at) else None
            await self._cycle(at)
        if st.status == "running" and st.ends_at is not None and now >= st.ends_at:
            if self._prev_at is None or self._prev_at < st.ends_at:
                await self._cycle(st.ends_at)  # last sync at the very end of the day
            st.status, st.next_cycle_at = "finished", None
            self._end_session()
            self._log("info", "company day finished")
            self._emit_state()

    def _start_due(self, now: datetime) -> None:
        st = self.st
        changed = False
        for e in st.timeline:
            if e.started or st.started_at + timedelta(minutes=e.at_min) > now:
                continue
            e.started = True
            changed = True
            try:
                e.run_id = self.sim.start_scenario(e.scenario_id).id
            except Exception as ex:  # noqa: BLE001 - one bad entry never stops the day
                self._log("error", f"company day: could not start {e.scenario_id}: {type(ex).__name__}: {ex}")
        if changed:
            self._emit_state()

    async def _generate_due(self, now: datetime) -> None:
        """Endless mode: once the scripted chats have all started, a new generated chat every 8-25 sim minutes."""
        st, wb = self.st, self.wb
        if not all(e.started for e in st.timeline):
            return
        level = activity_level(now)
        if self._next_gen_at is None or (level > 2 * self._gen_level and self._next_gen_at - now > timedelta(minutes=30)):
            self._schedule_next(now)  # first one, or the company woke up: do not wait out a night-time gap
        due_burst = bool(self._bursts) and self._bursts[0] <= now
        if now < self._next_gen_at and not due_burst:
            return
        if sum(1 for r in wb.runs.values() if not r.done) >= MAX_ACTIVE_GENERATED:
            self._bursts = [b for b in self._bursts if now - b <= BURST_STALE]  # a burst that cannot start in time is dropped
            return  # wait until a chat ends
        if due_burst:
            self._bursts.pop(0)
        else:
            self._schedule_next(now)
            self._burst_els = set()
        try:
            sc = self.prefetch.pop() if st.use_llm else None  # a ready LLM chat, never waited for
            if sc is None:
                sc = self.chatgen.offline(avoid=self._burst_els)
            if sc is None:
                return
            run = self.sim.start_scenario(sc.id)
        except Exception as ex:  # noqa: BLE001 - one bad chat never stops the endless day
            self._log("error", f"company day: could not generate a chat: {type(ex).__name__}: {ex}")
            return
        if sc.incident:
            self._burst_els.add(sc.incident.entity_id)
        if not due_burst and level >= 0.4 and self._rng.random() < self.burst_p:  # several chats overlap (one storm, two sites)
            self._bursts = sorted(now + timedelta(minutes=self._rng.uniform(1, 5)) for _ in range(self._rng.choice([1, 2])))
        st.generated_count += 1
        st.timeline.append(CompanyTimelineEntry(
            id=f"gen{st.generated_count:05d}", at_min=round((now - st.started_at).total_seconds() / 60, 1),
            kind="generated", scenario_id=sc.id, label=sc.title, started=True, run_id=run.id,
        ))
        gen = [e for e in st.timeline if e.kind == "generated"]
        if len(gen) > MAX_GENERATED_ENTRIES:
            drop = {id(e) for e in gen[:-MAX_GENERATED_ENTRIES]}
            st.timeline = [e for e in st.timeline if id(e) not in drop]
        self._emit_state()

    def _schedule_next(self, now: datetime) -> None:
        level = activity_level(now)
        gap = min(self._rng.uniform(*GEN_EVERY_MIN) / max(level, 0.02), MAX_GAP_MIN)
        self._next_gen_at, self._gen_level = now + timedelta(minutes=gap), level

    def _auto_resolve(self, at: datetime) -> None:
        """Endless mode: an incident whose chat ended more than 3 sim hours ago and is still open is closed."""
        wb = self.wb
        active_threads = {r.thread_id for r in wb.runs.values() if not r.done}
        for inc in list(wb.incidents.values()):
            if inc.resolved_at is not None or inc.thread_id is None or inc.thread_id in active_threads:
                continue
            t = wb.threads.get(inc.thread_id)
            last = (t.last_message_at if t else None) or inc.opened_at
            if at - last > AUTO_RESOLVE_AFTER:
                wb.resolve_incident(inc.id)
                self._log("info", f"incident {inc.id} on {inc.entity_id} closed by the cycle: no activity")

    def _prune(self, at: datetime) -> None:
        """Endless mode: keep memory bounded. Whatever leaves memory goes to the cold archive first.

        Knowledge (assertions, classes, their SourceRefs) stays. A thread that assertions cite may be evicted once it
        is archived: provenance reads it back from there (`Archive.get_thread`). Runs and LLM calls are plain caps
        (runs are tiny, LLM calls are already in out/workbench/llm_calls.jsonl)."""
        wb, archive = self.wb, self.archive
        busy = {r.thread_id for r in wb.runs.values() if not r.done}
        excess = len(wb.threads) - MAX_THREADS
        if excess > 0:
            old = sorted((t for t in wb.threads.values() if t.origin == "generated"), key=lambda t: t.created_at)
            for t in old:
                if excess <= 0:
                    break
                if t.id in busy or t.status in ("active", "idle", "processing"):
                    continue
                archive.put("threads", t.model_dump(mode="json"))
                wb.evict_thread(t.id)
                excess -= 1
        # closed incidents older than 6 sim hours
        for inc in [i for i in wb.incidents.values() if i.resolved_at and at - i.resolved_at > CLOSED_INCIDENT_KEEP]:
            archive.put("incidents", inc.model_dump(mode="json"))
            wb.delete_incident(inc.id)
        # finished runs whose thread went to the pipeline (kept: the last MAX_RUNS)
        done = [r for r in wb.runs.values() if r.done and (r.id in self._kicked or r.thread_id not in wb.threads)]
        gone = [r.id for r in done[: max(0, len(wb.runs) - MAX_RUNS)]]
        for rid in gone:
            del wb.runs[rid]
            self._kicked.discard(rid)
        self.chatgen.prune({e.scenario_id for e in self.st.timeline if not e.started})
        if gone:
            wb._scenarios_event()
        while len(wb.jobs) > MAX_JOBS:
            job = wb.jobs.pop(next(iter(wb.jobs)))
            archive.put("jobs", {
                "id": job.id, "thread_id": job.thread_id, "started_at": job.started_at.isoformat(),
                "finished_at": job.finished_at.isoformat() if job.finished_at else None, "extractor": job.extractor,
                "assertion_ids": job.assertion_ids, "events": job.events, "error": job.error,
            })
        del wb.llm_calls[:-MAX_LLM_CALLS]
        # healthy elements that stayed healthy for 2 sim hours
        for el, h in list(self._health.items()):
            if h.status == "healthy" and at - h.since > HEALTHY_KEEP:
                del self._health[el]
        if len(self._posted) > 5000:
            self._posted.clear()

    def _kick_processing(self) -> None:
        """A finished chat goes to the pipeline right away instead of waiting for the idle timer."""
        for e in self.st.timeline:
            run = self.wb.runs.get(e.run_id) if e.run_id else None
            if run and run.done and run.id not in self._kicked:
                self._kicked.add(run.id)
                if run.thread_id in self.wb.threads:
                    self.wb.request_processing(run.thread_id, immediate=True)

    # ------------------------------------------------------------ one sync of the autonomous system

    def _relevant_incidents(self, at: datetime) -> dict[str, list[Incident]]:
        """Per element: incidents open at `at`, plus short ones that opened and closed since the previous sync."""
        prev = self._prev_at or at
        out: dict[str, list[Incident]] = {}
        for inc in self.wb.incidents.values():
            if inc.opened_at > at:
                continue
            open_now = inc.resolved_at is None or inc.resolved_at > at
            missed = inc.resolved_at is not None and inc.opened_at > prev and inc.resolved_at <= at
            if open_now or missed:
                out.setdefault(inc.entity_id, []).append(inc)
        return out

    async def _cycle(self, at: datetime) -> CompanyCycle | None:
        wb, st, gen = self.wb, self.st, self._gen
        if st.endless:
            self._auto_resolve(at)
        n = self._cycle_no = self._cycle_no + 1
        pkg = package_summary(wb, n, at, self._prev_ids, self._prev_valid)
        incidents = self._relevant_incidents(at)
        targets = sorted(set(incidents) | {h.element_id for h in self._health.values() if h.status != "healthy"})
        calls: list[AgentCall] = []
        changes: list[StatusChange] = []
        for element_id in targets:
            try:
                call, change = await self._handle_element(n, at, element_id, incidents.get(element_id, []), gen)
            except _Stale:
                return None  # stopped or restarted while the agent was thinking: the result belongs to an older session
            except Exception as e:  # noqa: BLE001 - one bad element never costs the whole sync
                self._log("error", f"company day: sync {n} failed for {element_id}: {type(e).__name__}: {e}")
                continue
            if call:
                calls.append(call)
            if change:
                changes.append(change)
        counts = {"healthy": 0, "degraded": 0, "down": 0, "recovering": 0}
        for el in wb.elements:
            h = self._health.get(el)
            counts[h.status if h else "healthy"] += 1
        cycle = CompanyCycle(
            n=n, at=at, package=pkg, agent_call_ids=[c.id for c in calls], status_changes=changes,
            open_incidents=sum(1 for i in wb.incidents.values() if i.opened_at <= at and (i.resolved_at is None or i.resolved_at > at)),
            health_counts=counts,
        )
        self._cycles.append(cycle)
        del self._cycles[:-MAX_CYCLES]
        self._prev_ids = set(wb.store.assertions)
        self._prev_valid = {a.id for a in wb.store.assertions.values() if a.is_valid_at(at)}
        self._prev_at = at
        if st.endless:
            try:
                self._prune(at)
            except Exception as e:  # noqa: BLE001
                self._log("error", f"company day: pruning failed: {type(e).__name__}: {e}")
        self.archive.put_metrics({
            "sim_time": at.isoformat(), "cycle": n, "knowledge_total": pkg.total, "knowledge_valid": pkg.valid,
            "open_incidents": cycle.open_incidents, "agent_calls": len(calls), **counts,
        })
        wb.emit("company.cycle", cycle)
        self._emit_state()
        return cycle

    async def _handle_element(
        self, n: int, at: datetime, element_id: str, incs: list[Incident], gen: int | None = None
    ) -> tuple[AgentCall | None, StatusChange | None]:
        before = self._health.get(element_id)
        status_before = before.status if before else "healthy"
        if not incs:  # nothing open any more: back to normal
            return None, self._set_health(element_id, at, "healthy", None, "Incident resolved; the element is back to normal.", [], None)

        worst = max(incs, key=lambda i: SEVERITY_RANK.get(i.severity, 1))
        base = "down" if worst.severity == "critical" else "degraded"
        observations: dict[str, Any] = {}
        for i in sorted(incs, key=lambda i: i.opened_at):
            observations.update(i.observations)
        description = "; ".join(dict.fromkeys(i.summary for i in incs))
        case = agent_mod.Case(
            id=f"cycle{n}-{element_id}", title=f"{element_id}: {worst.kind}", entity_id=element_id, at=at,
            description=description, observations=observations,
        )
        report, used_llm = await self._ask(case)
        if gen is not None and gen != self._gen:
            raise _Stale()
        cited = agent_mod.cited_assertion_ids(report.recommendation, report.hits)
        closed = all(i.resolved_at is not None and i.resolved_at <= at for i in incs)
        if cited:
            status = "recovering"
            reason = f"Knowledge applied: {report.recommendation}"
            if closed:
                reason += " (the field team already closed the incident)"
            recommendation = report.recommendation
        else:
            status = base
            reason = "no knowledge yet for this case" if not report.hits else "knowledge found but none applies to this case"
            recommendation = report.recommendation
        self._announce(element_id, report, cited, description)
        self._call_n += 1
        call = AgentCall(
            id=f"call_{self._call_n:04d}", cycle=n, at=at, entity_id=element_id,
            incident_id=worst.id, thread_id=worst.thread_id, observations=observations,
            hit_ids=[h.assertion.id for h in report.hits], skipped=len(report.skipped), cited_assertion_ids=cited,
            recommendation=report.recommendation, status_before=status_before, status_after=status, used_llm=used_llm,
        )
        self._calls.append(call)
        del self._calls[:-MAX_CALLS]
        self.wb.emit("agent.call", call)
        change = self._set_health(element_id, at, status, worst.id, reason, cited, recommendation)
        return call, change

    async def _ask(self, case: agent_mod.Case):
        """Ask the context layer. With the LLM on, a failure falls back to the template and is logged."""
        wb = self.wb
        kwargs = dict(use_conditions=wb.settings.use_conditions, use_guard=wb.settings.use_guard, use_relevance=wb.settings.use_relevance)
        if self.st.use_llm:
            try:
                report = await asyncio.to_thread(agent_mod.run_agent, wb.store, case, use_llm=True, **kwargs)
                return report, True
            except Exception as e:  # noqa: BLE001 - no key, rate limit, bad answer
                self._log("warning", f"company day: LLM recommendation failed for {case.entity_id} ({type(e).__name__}), template used")
        return agent_mod.run_agent(wb.store, case, use_llm=False, **kwargs), False

    def _announce(self, element_id: str, report, cited: list[str], title: str) -> None:
        """Close the outcome loop like POST /agent/run: tell the incident thread which knowledge was applied (once)."""
        wb = self.wb
        if not (wb.settings.use_outcome_loop and cited):
            return
        applied = [h.assertion for h in report.hits if h.assertion.id in cited and (element_id, h.assertion.id) not in self._posted]
        if not applied:
            return
        try:
            from .. import outcome

            outcome.post_application(wb, element_id, applied, title)
            self._posted.update((element_id, a.id) for a in applied)
        except Exception as e:  # noqa: BLE001 - optional, never breaks a sync
            self._log("warning", f"outcome loop: could not post the agent message ({e})")

    def _set_health(
        self, element_id: str, at: datetime, status: str, incident_id: str | None, reason: str,
        applied: list[str], recommendation: str | None,
    ) -> StatusChange | None:
        old = self._health.get(element_id)
        old_status = old.status if old else "healthy"
        if old is None and status == "healthy":
            return None
        changed_status = status != old_status
        since = at if (changed_status or old is None) else old.since
        new = ElementHealth(
            element_id=element_id, status=status, since=since, incident_id=incident_id, reason=reason,
            applied_assertion_ids=list(applied), recommendation=recommendation,
        )
        self._health[element_id] = new
        if not changed_status and old and old.applied_assertion_ids == new.applied_assertion_ids and old.reason == new.reason:
            return None
        self.wb.emit("network.status", new)
        return StatusChange(element_id=element_id, from_status=old_status, to_status=status, reason=reason) if changed_status else None

    # ------------------------------------------------------------ helpers

    def _log(self, level: str, text: str) -> None:
        try:
            self.wb.emit("log", {"level": level, "text": text})
        except Exception:  # noqa: BLE001
            pass

    def _emit_state(self) -> None:
        self.wb.emit("company.state", self.st.model_copy(update={"cycles": [], "calls": [], "health": []}))

    # ------------------------------------------------------------ packages

    def package(self, cycle: int | None = None) -> dict[str, Any] | None:
        """Full content handed over at `cycle` (default: latest). None for an unknown cycle number."""
        if cycle is None:
            cyc = self._cycles[-1] if self._cycles else None
        else:
            cyc = next((c for c in self._cycles if c.n == cycle), None)
            if cyc is None:
                return None
        at = cyc.at if cyc else self.wb.now()
        data = export_package(self.wb, at=at, valid_only=True)
        return {"package": cyc.package.model_dump(mode="json") if cyc else None, **data}
