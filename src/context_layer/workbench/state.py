"""Workbench facade: the one live state, mutated only from the asyncio loop thread.

The simulator and the Slack bridge code against the public signatures below.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from .. import config
from ..link import Inventory
from ..models import ContextAssertion, ElementClass, Message, SourceRef, Trust
from ..store import ContextStore, same_knowledge
from . import persistence, seed
from .bus import EventBus
from .clock import SimClock
from .contracts import (
    AssertionEdit,
    REMOVABLE_ORIGINS,
    Incident,
    IncidentSpec,
    LiveThread,
    LlmCall,
    Origin,
    Persona,
    OperatorEdit,
    PipelineJob,
    ReviewFlag,
    RuleApplication,
    Scenario,
    ScenarioRun,
    Settings,
    SettingsPatch,
    StateSnapshot,
    ThreadSource,
    TopologyLink,
    WbElement,
    WbSite,
)
from .processor import Processor

log = logging.getLogger(__name__)

# fn(thread, message, mirror): called after every post_message. mirror=False means the message came
# from Slack (or another outside channel) and must not be sent back there.
MessageListener = Callable[[LiveThread, Message, bool], None]

# Events that do not change the saved state.
_NO_SAVE = {"llm.call", "log", "slack.status"}


class WbStore(ContextStore):
    """Core store with assertion ids that stay unique after removals (the core uses len + 1)."""

    def _new_id(self) -> str:
        used = [int(i[4:]) for i in self.assertions if i.startswith("ctx_") and i[4:].isdigit()]
        return f"ctx_{max(used, default=0) + 1:04d}"

    def add_assertion(self, a: ContextAssertion) -> tuple[ContextAssertion, bool]:
        for old in self.assertions.values():
            if same_knowledge(old, a):
                return super().add_assertion(a)  # merge path of the core, no id is allocated
        a.id = self._new_id()
        self._index(a)
        return a, True


def _flag_key(flag: ReviewFlag) -> tuple:
    """Identity of a flag. Conflicts are keyed by the unordered pair of assertions (the detail holds the
    other id, also in flags saved before pairs existed); flags without an assertion also compare the message."""
    if flag.kind == "conflict" and flag.assertion_id:
        ids = frozenset({flag.assertion_id, *re.findall(r"ctx_\d{4,}", flag.detail or "")})
        return (flag.kind, flag.thread_id, ids)
    return (flag.kind, flag.thread_id, flag.assertion_id, flag.message if flag.assertion_id is None else None)


def _next_id(prefix: str, existing) -> str:
    nums = [int(k.split("_")[1]) for k in existing if k.startswith(prefix + "_") and k.split("_")[1].isdigit()]
    return f"{prefix}_{max(nums, default=0) + 1:04d}"


class Workbench:
    # ------------------------------------------------------------ state (read freely, mutate via methods)
    clock: SimClock
    bus: EventBus
    settings: Settings
    elements: dict[str, WbElement]
    sites: dict[str, WbSite]
    links: dict[str, TopologyLink]
    personas: dict[str, Persona]
    threads: dict[str, LiveThread]
    incidents: dict[str, Incident]
    scenarios: dict[str, Scenario]
    runs: dict[str, ScenarioRun]
    jobs: dict[str, PipelineJob]
    flags: dict[str, ReviewFlag]  # operator console, never blocks the loop
    edits: dict[str, AssertionEdit]  # operator edit history
    applications: dict[str, RuleApplication]  # outcome loop: knowledge the agent applied
    llm_calls: list[LlmCall]  # last 500 in memory; all of them in out/workbench/llm_calls.jsonl
    store: ContextStore  # core store, rebuilt when the inventory changes

    def __init__(self, clock: SimClock | None = None, state_file=None, seed: bool = True):
        self.clock = clock or SimClock(datetime.fromisoformat(config.WORKBENCH_SIM_START), speed=10, running=False)
        self.bus = EventBus(self.clock.now)
        self.state_file = Path(state_file or config.WORKBENCH_STATE_FILE)
        self.settings = Settings(idle_seconds=config.WORKBENCH_IDLE_SECONDS)
        self.llm_calls = []
        self.slack = None  # set by the app; only read for settings.slack_connected
        self._listeners: list[MessageListener] = []
        self._save_handle = None
        self.processor = Processor(self)
        self._clear()
        self.refresh_readonly_settings()
        self.rebuild_store()

        loaded = False
        if self.state_file.exists():
            try:
                persistence.apply_state(self, persistence.load_state(self.state_file))
                loaded = True
            except Exception as e:  # noqa: BLE001 - a bad file must not stop the app
                log.warning("could not load %s (%s): starting from the seed", self.state_file, e)
                self._clear()
                self.rebuild_store()
        if not loaded and seed:
            self._load_seed(with_threads=True)

    # ------------------------------------------------------------ basics

    def now(self) -> datetime:
        """Simulated now."""
        return self.clock.now()

    def emit(self, type: str, data: Any) -> None:
        """Publish an event on the bus (loop thread only) and mark the state dirty for saving."""
        self.bus.publish(type, data)
        if type not in _NO_SAVE:
            self._schedule_save()

    def _schedule_save(self) -> None:
        loop = self.bus.loop
        if loop is None or self._save_handle is not None:
            return
        self._save_handle = loop.call_later(1.0, self.save_now)

    def save_now(self) -> None:
        if self._save_handle is not None:
            self._save_handle.cancel()
            self._save_handle = None
        try:
            persistence.save_state(self, self.state_file)
        except Exception as e:  # noqa: BLE001
            log.warning("could not save state: %s", e)

    def inventory(self) -> Inventory:
        """Core Inventory built from the current elements and sites."""
        return Inventory(list(self.elements.values()), list(self.sites.values()))

    def persona(self, persona_id: str) -> Persona | None:
        return self.personas.get(persona_id)

    def persona_by_name(self, name: str) -> Persona | None:
        wanted = name.strip().lower()
        return next((p for p in self.personas.values() if p.name.lower() == wanted), None)

    def refresh_readonly_settings(self) -> None:
        s = self.settings
        s.llm_configured = config.llm_configured()
        s.llm_model = config.LLM_MODEL or None
        s.llm_fallback_model = config.LLM_FALLBACK_MODEL if config.llm_fallback_configured() else None
        s.slack_connected = bool(getattr(self.slack, "connected", False))

    def update_settings(self, patch: SettingsPatch) -> Settings:
        for k, v in patch.model_dump(exclude_none=True).items():
            setattr(self.settings, k, v)
        self.refresh_readonly_settings()
        self.emit("settings.changed", self.settings)
        return self.settings

    def snapshot(self) -> StateSnapshot:
        self.refresh_readonly_settings()
        return StateSnapshot(
            clock=self.clock.state(),
            settings=self.settings,
            elements=list(self.elements.values()),
            sites=list(self.sites.values()),
            links=list(self.links.values()),
            personas=list(self.personas.values()),
            threads=list(self.threads.values()),
            incidents=list(self.incidents.values()),
            assertions=list(self.store.assertions.values()),
            classes=list(self.store.classes.values()),
            jobs=list(self.jobs.values())[-50:],
            scenarios=list(self.scenarios.values()),
            runs=list(self.runs.values()),
            llm_calls=self.llm_calls[-50:],
        )

    # ------------------------------------------------------------ store

    def rebuild_store(self, classes=None, assertions=None) -> None:
        """New core store from the current inventory; re-adds classes and assertions (given, or the old ones)."""
        old = getattr(self, "store", None)
        classes = list(classes if classes is not None else (old.classes.values() if old else []))
        assertions = list(assertions if assertions is not None else (old.assertions.values() if old else []))
        self.store = WbStore(self.inventory())
        for c in classes:
            self.store.add_class(c)
        for a in assertions:
            self.store._index(a)

    def assertion_snapshot(self) -> tuple[dict[str, dict], set[str]]:
        """What the store holds now, to diff against later with emit_changes()."""
        return {i: a.model_dump(mode="json") for i, a in self.store.assertions.items()}, set(self.store.classes)

    def emit_changes(self, before: tuple[dict[str, dict], set[str]]) -> None:
        """Emit assertion.upserted / assertion.deleted / class.upserted for everything that changed."""
        old_assertions, old_classes = before
        for aid, a in self.store.assertions.items():
            if old_assertions.get(aid) != a.model_dump(mode="json"):
                self.emit("assertion.upserted", a)
        for aid in old_assertions:
            if aid not in self.store.assertions:
                self.emit("assertion.deleted", {"id": aid})
        for cid, cls in self.store.classes.items():
            if cid not in old_classes:
                self.emit("class.upserted", cls)

    def drop_assertions(self, ids: set[str]) -> None:
        """Remove assertions; reopen the ones they closed and forget their conflict flags."""
        for aid in ids:
            self.store.remove_assertion(aid)
        for a in self.store.assertions.values():
            if a.closed_by in ids:
                a.valid_to, a.closed_by = None, None
            a.conflicts_with = [c for c in a.conflicts_with if c not in ids]

    def delete_assertion(self, assertion_id: str) -> None:
        if assertion_id not in self.store.assertions:
            raise KeyError(assertion_id)
        before = self.assertion_snapshot()
        self.drop_assertions({assertion_id})
        self.emit_changes(before)

    # ------------------------------------------------------------ inventory and people

    def _inventory_event(self) -> None:
        self.emit(
            "inventory.changed",
            {
                "elements": [e.model_dump(mode="json") for e in self.elements.values()],
                "sites": [s.model_dump(mode="json") for s in self.sites.values()],
                "links": [x.model_dump(mode="json") for x in self.links.values()],
            },
        )

    def _personas_event(self) -> None:
        self.emit("personas.changed", {"personas": [p.model_dump(mode="json") for p in self.personas.values()]})

    def upsert_item(self, kind: str, item: Any) -> None:
        """kind: elements, sites, links or personas."""
        getattr(self, kind)[item.id] = item
        if kind == "personas":
            self._personas_event()
        else:
            if kind in ("elements", "sites"):
                self.rebuild_store()
            self._inventory_event()

    def delete_item(self, kind: str, item_id: str) -> None:
        table = getattr(self, kind)
        if item_id not in table:
            raise KeyError(item_id)
        del table[item_id]
        if kind == "elements":
            self.links = {k: v for k, v in self.links.items() if item_id not in (v.a, v.b)}
        if kind == "personas":
            self._personas_event()
        else:
            if kind in ("elements", "sites"):
                self.rebuild_store()
            self._inventory_event()

    # ------------------------------------------------------------ threads and messages

    def _thread_event(self, t: LiveThread) -> None:
        data = t.model_dump(mode="json")
        data["messages"] = []
        self.emit("thread.upserted", data)

    def create_thread(
        self,
        source: ThreadSource,
        subject: str | None,
        participants: list[str],
        origin: Origin,
        scenario_id: str | None = None,
        incident_id: str | None = None,
    ) -> LiveThread:
        """New live thread with id "live/<8 hex>". Emits thread.upserted."""
        t = LiveThread(
            id=f"live/{uuid.uuid4().hex[:8]}",
            source=source,
            subject=subject,
            participants=participants,
            origin=origin,
            scenario_id=scenario_id,
            incident_id=incident_id,
            created_at=self.now(),
        )
        self.threads[t.id] = t
        self._thread_event(t)
        return t

    def post_message(
        self,
        thread_id: str,
        author: str,
        text: str,
        role: str | None = None,
        persona_id: str | None = None,
        at: datetime | None = None,
        mirror: bool = True,
    ) -> Message:
        """Append a message (seq = len + 1, sent_at = at or now()), emit message.posted,
        call the message listeners, and (re)start the thread's idle timer for processing."""
        t = self.threads[thread_id]
        persona = self.personas.get(persona_id) if persona_id else None
        if persona:
            author, role = author or persona.name, role or persona.role
        msg = Message(
            thread_id=t.id, source=t.source, seq=len(t.messages) + 1, author=author, role=role,
            sent_at=at or self.now(), text=text,
        )
        t.messages.append(msg)
        t.last_message_at = msg.sent_at
        t.status = "active"
        self.emit("message.posted", {"thread_id": t.id, "message": msg})
        self._thread_event(t)
        for fn in list(self._listeners):
            try:
                fn(t, msg, mirror)
            except Exception as e:  # noqa: BLE001 - a listener must not break posting
                log.warning("message listener failed: %s", e)
        self.request_processing(t.id)
        return msg

    def set_thread_slack_ts(self, thread_id: str, ts: str) -> None:
        """Remember the Slack root message of a mirrored thread. Emits thread.upserted."""
        t = self.threads[thread_id]
        t.slack_ts = ts
        self._thread_event(t)

    def thread_by_slack_ts(self, ts: str) -> LiveThread | None:
        return next((t for t in self.threads.values() if t.slack_ts == ts), None)

    def add_message_listener(self, fn: MessageListener) -> None:
        self._listeners.append(fn)

    def request_processing(self, thread_id: str, immediate: bool = False) -> None:
        """Schedule the pipeline job for a thread (after idle_seconds, or now)."""
        self.processor.request(thread_id, immediate)

    def delete_thread(self, thread_id: str) -> None:
        """Remove the thread and the sources it gave to assertions."""
        if thread_id not in self.threads:
            raise KeyError(thread_id)
        self.processor.forget(thread_id)
        before = self.assertion_snapshot()
        self.processor.retract(thread_id)
        del self.threads[thread_id]
        self.emit("thread.deleted", {"id": thread_id})
        self.emit_changes(before)

    # ------------------------------------------------------------ incidents

    def open_incident(
        self,
        spec: IncidentSpec,
        origin: Origin,
        scenario_id: str | None = None,
        thread_id: str | None = None,
    ) -> Incident:
        """Emits incident.upserted."""
        inc = Incident(
            **spec.model_dump(),
            id=_next_id("inc", self.incidents),
            opened_at=self.now(),
            thread_id=thread_id,
            scenario_id=scenario_id,
            origin=origin,
        )
        self.incidents[inc.id] = inc
        self.emit("incident.upserted", inc)
        t = self.threads.get(thread_id) if thread_id else None
        if t and not t.incident_id:
            t.incident_id = inc.id
            self._thread_event(t)
        return inc

    def resolve_incident(self, incident_id: str) -> Incident:
        """Sets status=resolved and resolved_at=now(). Emits incident.upserted."""
        inc = self.incidents[incident_id]
        inc.status, inc.resolved_at = "resolved", self.now()
        self.emit("incident.upserted", inc)
        return inc

    def delete_incident(self, incident_id: str) -> None:
        del self.incidents[incident_id]
        self.emit("incident.deleted", {"id": incident_id})

    # ------------------------------------------------------------ scenarios (the simulator calls these)

    def _scenarios_event(self) -> None:
        self.emit(
            "scenarios.changed",
            {
                "scenarios": [s.model_dump(mode="json") for s in self.scenarios.values()],
                "runs": [r.model_dump(mode="json") for r in self.runs.values()],
            },
        )

    def upsert_scenario(self, scenario: Scenario) -> None:
        """Emits scenarios.changed."""
        self.scenarios[scenario.id] = scenario
        self._scenarios_event()

    def delete_scenario(self, scenario_id: str) -> None:
        del self.scenarios[scenario_id]
        self._scenarios_event()

    def upsert_run(self, run: ScenarioRun) -> None:
        """Emits scenarios.changed. Allocates the id when it is empty."""
        if not run.id:
            run.id = _next_id("run", self.runs)
        self.runs[run.id] = run
        self._scenarios_event()

    # ------------------------------------------------------------ jobs

    def new_job(self, thread_id: str) -> PipelineJob:
        job = PipelineJob(id=_next_id("job", self.jobs), thread_id=thread_id, started_at=datetime.now())
        self.jobs[job.id] = job
        while len(self.jobs) > 200:
            del self.jobs[next(iter(self.jobs))]
        return job

    # ------------------------------------------------------------ review flags and operator edits

    def add_flag(self, flag: ReviewFlag, refresh: bool = False) -> ReviewFlag | None:
        """Store a flag unless the same (kind, thread, assertion; for conflicts, the same pair) exists already (no duplicates across reruns;
        flags without an assertion also compare their message). Returns the new flag, or None when it existed.
        refresh=True updates the existing flag instead (message, job, time) and reopens it. Emits review.flag."""
        key = _flag_key(flag)
        for old in self.flags.values():
            if _flag_key(old) == key:
                if refresh:
                    old.message, old.detail, old.job_id = flag.message, flag.detail, flag.job_id
                    old.item_topic = flag.item_topic or old.item_topic
                    old.created_at, old.dismissed = flag.created_at, False
                    self.emit("review.flag", old)
                return None
        flag.id = _next_id("flag", self.flags)
        self.flags[flag.id] = flag
        self.emit("review.flag", flag)
        return flag

    def set_flag_dismissed(self, flag_id: str, dismissed: bool) -> ReviewFlag:
        flag = self.flags[flag_id]  # KeyError when unknown
        flag.dismissed = dismissed
        self.emit("review.flag", flag)
        return flag

    # ------------------------------------------------------------ outcome loop

    def add_application(self, app: RuleApplication) -> RuleApplication:
        """Store a new application (id assigned) and emit application.upserted."""
        app.id = _next_id("app", self.applications)
        self.applications[app.id] = app
        self.emit("application.upserted", app)
        return app

    def update_application(self, app_id: str, **fields: Any) -> RuleApplication:
        """Change fields of an application and emit application.upserted. KeyError: unknown id."""
        app = self.applications[app_id]
        for k, v in fields.items():
            if k not in RuleApplication.model_fields or k == "id":
                raise ValueError(f"unknown application field {k}")
            setattr(app, k, v)
        self.emit("application.upserted", app)
        return app

    def _edit_state(self, a: ContextAssertion) -> dict[str, Any]:
        """The fields an operator edit can touch, as JSON."""
        d = a.model_dump(mode="json")
        return {k: d[k] for k in ("summary", "action", "avoid", "conditions", "valid_to", "closed_by", "trust", "sources", "link_notes")}

    def edit_assertion(self, assertion_id: str, edit: OperatorEdit) -> AssertionEdit:
        """Apply an operator edit. Records an AssertionEdit, adds the "operator" source, and emits
        assertion.upserted plus a review.flag of kind operator_edit. KeyError: unknown assertion.
        ValueError: nothing to change."""
        a = self.store.assertions[assertion_id]
        given = edit.model_fields_set
        before = self._edit_state(a)
        if edit.summary is not None:
            a.summary = edit.summary
        if edit.action is not None:
            a.action = edit.action
        if edit.avoid is not None:
            a.avoid = list(edit.avoid)
        if edit.conditions is not None:
            a.conditions = list(edit.conditions)
        if "valid_to" in given:  # an explicit null reopens the assertion
            a.valid_to, a.closed_by = edit.valid_to, None
        if edit.trust_level is not None:
            a.trust = Trust(level=edit.trust_level, stated_by="operator", role="operator", evidence=a.trust.evidence)
        if edit.note:
            a.link_notes.append(f"operator note: {edit.note}")
        after = self._edit_state(a)
        if after == before:
            raise ValueError("nothing to change")
        if not any(s.source == "operator" for s in a.sources):
            a.sources.append(SourceRef(source="operator", file="operator", seq=[]))
            after = self._edit_state(a)
        changed = [k for k in after if after[k] != before[k]]  # the record holds only the fields the edit touched
        rec = AssertionEdit(
            id=_next_id("edit", self.edits), assertion_id=a.id, ts=datetime.now(), note=edit.note,
            before={k: before[k] for k in changed}, after={k: after[k] for k in changed},
        )
        self.edits[rec.id] = rec
        self.emit("assertion.upserted", a)
        thread_id = next((s.file for s in a.sources if s.file != "operator"), "operator")
        job_id = self.threads[thread_id].last_job_id if thread_id in self.threads else None
        self.add_flag(
            ReviewFlag(
                id="", kind="operator_edit", thread_id=thread_id, job_id=job_id or "", assertion_id=a.id, item_topic=a.topic,
                message=f"An operator changed '{a.topic}' by hand. Re-processing its thread keeps this change.",
                detail=edit.note, created_at=datetime.now(),
            ),
            refresh=True,
        )
        return rec

    def assertion_history(self, assertion_id: str) -> list[AssertionEdit]:
        """Edits of an assertion, newest first. KeyError: unknown assertion."""
        if assertion_id not in self.store.assertions:
            raise KeyError(assertion_id)
        return [e for e in reversed(self.edits.values()) if e.assertion_id == assertion_id]

    def undo_edit(self, assertion_id: str, edit_id: str | None = None) -> AssertionEdit:
        """Undo an edit and mark it undone. Without `edit_id`: the latest edit not undone yet (restores its
        whole `before`). With `edit_id`: exactly that edit; when it is not the latest one, only the fields it
        touched are restored, and only if no later edit changed them since.
        KeyError: unknown assertion or edit. ValueError: nothing to undo, already undone, or not safe."""
        a = self.store.assertions[assertion_id]
        history = self.assertion_history(assertion_id)
        latest = next((e for e in history if not e.undone), None)
        if edit_id is None:
            rec, fields = latest, None
            if rec is None:
                raise ValueError("nothing to undo")
        else:
            rec = next((e for e in history if e.id == edit_id), None)
            if rec is None:
                raise KeyError(edit_id)
            if rec.undone:
                raise ValueError(f"{edit_id} is already undone")
            fields = None
            if rec is not latest:
                fields = [k for k in rec.before if rec.before[k] != rec.after.get(k)]
                if any(e is not rec and not e.undone for e in history):
                    fields = [k for k in fields if k != "sources"]  # the operator source stays while edits remain
                current = self._edit_state(a)
                busy = [k for k in fields if current[k] != rec.after.get(k)]
                if busy:
                    raise ValueError(
                        f"{edit_id} cannot be undone on its own: a later edit changed {', '.join(busy)}. "
                        "Undo the later edits first."
                    )
        restored = ContextAssertion.model_validate({**a.model_dump(mode="json"), **rec.before})
        for field in fields if fields is not None else rec.before:
            setattr(a, field, getattr(restored, field))
        rec.undone = True
        self.emit("assertion.upserted", a)
        return rec

    # ------------------------------------------------------------ reset and removal

    def _clear(self) -> None:
        self.elements, self.sites, self.links, self.personas = {}, {}, {}, {}
        self.threads, self.incidents, self.scenarios, self.runs, self.jobs = {}, {}, {}, {}, {}
        self.flags, self.edits, self.applications = {}, {}, {}
        self.processor.reset()
        old = getattr(self, "store", None)
        if old:
            self.store = WbStore(self.inventory())

    def _load_seed(self, with_threads: bool) -> None:
        data = seed.load_seed()
        self.elements = {x.id: x for x in data.elements}
        self.sites = {x.id: x for x in data.sites}
        self.links = {x.id: x for x in data.links}
        self.personas = {x.id: x for x in data.personas}
        self.scenarios = {x.id: x for x in data.scenarios}
        self.rebuild_store(classes=[], assertions=[])
        if with_threads:
            # History only: threads dated after the sim start (e.g. the firmware rollout) stay
            # available as scenarios, so knowledge never comes from the simulated future.
            start = datetime.fromisoformat(config.WORKBENCH_SIM_START)
            past = [t for t in data.threads if t.created_at <= start]
            # The seed is processed without critic and judge (no extra LLM calls at first start).
            self.processor.bootstrap_threads = {t.id for t in past}
            for t in sorted(past, key=lambda t: t.created_at):
                self.threads[t.id] = t
                t.status = "processing"
                self.request_processing(t.id, immediate=True)

    def reset(self, mode: str = "seed") -> None:
        """"seed": full seed. "empty": seed inventory, people and scenarios, nothing else."""
        self._clear()
        self._load_seed(with_threads=mode == "seed")
        self.clock.set(datetime.fromisoformat(config.WORKBENCH_SIM_START))
        self.emit("state.reset", {})

    def replace_state(self, data: dict[str, Any]) -> None:
        """Import: replace everything with an exported state.

        Raises ValueError (the HTTP layer answers 422) on dangling references, like POST /elements and /links.
        `process_on_import` (optional list of thread ids, e.g. the hand-written seed threads of a dataset sample) is
        processed right away, as the seed is at first start."""
        elements, sites = (data.get("elements") or []), (data.get("sites") or [])
        problems = persistence.validate_refs(
            [WbElement.model_validate(x) for x in elements], [WbSite.model_validate(x) for x in sites],
            [TopologyLink.model_validate(x) for x in data.get("links") or []],
        )
        if problems:
            raise ValueError("; ".join(problems[:5]) + (f" (+{len(problems) - 5} more)" if len(problems) > 5 else ""))
        self.processor.reset()
        persistence.apply_state(self, data)
        boot = [tid for tid in data.get("process_on_import") or [] if tid in self.threads]
        if boot:
            self.processor.bootstrap_threads = set(boot)
            for tid in sorted(boot, key=lambda i: self.threads[i].created_at):
                self.threads[tid].status = "processing"
                self.request_processing(tid, immediate=True)
        self.emit("state.reset", {})

    def remove_generated(self) -> dict[str, int]:
        """Delete every object whose origin is in REMOVABLE_ORIGINS. Returns the counts per kind."""
        removed: dict[str, int] = {}
        before = self.assertion_snapshot()
        n_assertions = len(self.store.assertions)

        gone_threads = [t.id for t in self.threads.values() if t.origin in REMOVABLE_ORIGINS]
        for tid in gone_threads:
            self.processor.forget(tid)
            self.processor.retract(tid)
            del self.threads[tid]
        removed["threads"] = len(gone_threads)
        removed["assertions"] = n_assertions - len(self.store.assertions)

        for kind in ("incidents", "personas", "links"):
            table = getattr(self, kind)
            ids = [i for i, x in table.items() if x.origin in REMOVABLE_ORIGINS]
            for i in ids:
                del table[i]
            removed[kind] = len(ids)

        gone_scenarios = [i for i, s in self.scenarios.items() if s.origin in REMOVABLE_ORIGINS]
        for i in gone_scenarios:
            del self.scenarios[i]
        gone_runs = [i for i, r in self.runs.items() if r.scenario_id in gone_scenarios]
        for i in gone_runs:
            del self.runs[i]
        removed["scenarios"], removed["runs"] = len(gone_scenarios), len(gone_runs)

        for kind in ("elements", "sites"):
            table = getattr(self, kind)
            ids = [i for i, x in table.items() if x.origin in REMOVABLE_ORIGINS]
            for i in ids:
                del table[i]
            removed[kind] = len(ids)
        self.links = {k: v for k, v in self.links.items() if v.a in self.elements and v.b in self.elements}
        self.rebuild_store()
        self.emit_changes(before)  # kept for completeness; clients refetch on state.reset anyway
        self.emit("state.reset", {})
        return removed
