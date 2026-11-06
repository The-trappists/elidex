"""Workbench facade: the one live state, mutated only from the asyncio loop thread.

PHASE 0 STUB. Signatures and docstrings are the contract the simulator and the Slack bridge code
against. Owner: backend-core agent (implements the bodies, may add private helpers and extra
public methods, must not change these signatures).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

from ..link import Inventory
from ..models import Message
from ..store import ContextStore
from .bus import EventBus
from .clock import SimClock
from .contracts import (
    Incident,
    IncidentSpec,
    LiveThread,
    LlmCall,
    Origin,
    Persona,
    PipelineJob,
    Scenario,
    ScenarioRun,
    Settings,
    StateSnapshot,
    ThreadSource,
    TopologyLink,
    WbElement,
    WbSite,
)

# fn(thread, message, mirror): called after every post_message. mirror=False means the message came
# from Slack (or another outside channel) and must not be sent back there.
MessageListener = Callable[[LiveThread, Message, bool], None]


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
    llm_calls: list[LlmCall]  # last 500 in memory; all of them in out/workbench/llm_calls.jsonl
    store: ContextStore  # core store, rebuilt when the inventory changes

    def __init__(self, clock: SimClock | None = None, state_file=None, seed: bool = True):
        raise NotImplementedError

    # ------------------------------------------------------------ basics

    def now(self) -> datetime:
        """Simulated now."""
        raise NotImplementedError

    def emit(self, type: str, data: Any) -> None:
        """Publish an event on the bus (loop thread only) and mark the state dirty for saving."""
        raise NotImplementedError

    def inventory(self) -> Inventory:
        """Core Inventory built from the current elements and sites."""
        raise NotImplementedError

    def persona(self, persona_id: str) -> Persona | None:
        raise NotImplementedError

    def persona_by_name(self, name: str) -> Persona | None:
        raise NotImplementedError

    def snapshot(self) -> StateSnapshot:
        raise NotImplementedError

    # ------------------------------------------------------------ threads and messages

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
        raise NotImplementedError

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
        raise NotImplementedError

    def set_thread_slack_ts(self, thread_id: str, ts: str) -> None:
        """Remember the Slack root message of a mirrored thread. Emits thread.upserted."""
        raise NotImplementedError

    def thread_by_slack_ts(self, ts: str) -> LiveThread | None:
        raise NotImplementedError

    def add_message_listener(self, fn: MessageListener) -> None:
        raise NotImplementedError

    def request_processing(self, thread_id: str, immediate: bool = False) -> None:
        """Schedule the pipeline job for a thread (after idle_seconds, or now)."""
        raise NotImplementedError

    # ------------------------------------------------------------ incidents

    def open_incident(
        self,
        spec: IncidentSpec,
        origin: Origin,
        scenario_id: str | None = None,
        thread_id: str | None = None,
    ) -> Incident:
        """Emits incident.upserted."""
        raise NotImplementedError

    def resolve_incident(self, incident_id: str) -> Incident:
        """Sets status=resolved and resolved_at=now(). Emits incident.upserted."""
        raise NotImplementedError

    # ------------------------------------------------------------ scenarios (the simulator calls these)

    def upsert_scenario(self, scenario: Scenario) -> None:
        """Emits scenarios.changed."""
        raise NotImplementedError

    def upsert_run(self, run: ScenarioRun) -> None:
        """Emits scenarios.changed."""
        raise NotImplementedError
