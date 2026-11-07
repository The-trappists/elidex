"""Workbench contract: every model the backend, the simulator, the Slack bridge and the web UI share.

Mirrored by hand in web/src/api/types.ts. Change both together, and tell the team first.
All datetimes are naive and in *simulated* time unless the field says "wall".
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..models import ContextAssertion, ElementClass, ExtractionResult, ExtractedItem, Message, NetworkElement, Site

Origin = Literal["elisa", "synthetic", "generated", "manual", "slack"]
# Origins removed by "DELETE /api/data/generated".
REMOVABLE_ORIGINS: set[str] = {"generated", "manual", "slack"}

ThreadSource = Literal["teams", "email", "slack"]
ThreadStatus = Literal["active", "idle", "processing", "processed", "error"]
ExtractorMode = Literal["auto", "llm", "scripted"]
StageName = Literal["listen", "understand", "link", "store", "reconcile"]
StageStatus = Literal["pending", "running", "done", "skipped", "error"]
Severity = Literal["minor", "major", "critical"]
IncidentStatus = Literal["open", "resolved"]
LinkKind = Literal["fiber", "microwave", "backhaul"]
LlmPurpose = Literal["extract", "generate_scenario", "agent", "check"]
JsonMode = Literal["json_object", "json_schema", "prompt"]

STAGES: list[str] = ["listen", "understand", "link", "store", "reconcile"]

# ---------------------------------------------------------------- inventory and people


class WbElement(NetworkElement):
    origin: Origin = "synthetic"


class WbSite(Site):
    origin: Origin = "synthetic"
    lat: float | None = None
    lon: float | None = None


class TopologyLink(BaseModel):
    id: str
    a: str  # element id
    b: str  # element id
    kind: LinkKind = "fiber"
    origin: Origin = "synthetic"


class Persona(BaseModel):
    id: str  # slug, e.g. "erkki"
    name: str  # display name, also the message author
    role: str  # e.g. "Network Expert"
    team: str | None = None
    avatar_color: str = "#6366f1"  # hex, used by the UI and for Slack icons
    expertise: str = ""  # free text, fed to the LLM generator
    style: str = ""  # how they write, fed to the LLM generator
    origin: Origin = "synthetic"


# ---------------------------------------------------------------- incidents (scripted, never detected)


class IncidentSpec(BaseModel):
    """What a scenario opens. Scripted ground truth (as-observed layer), not fault detection."""

    entity_id: str
    kind: str  # slug, e.g. "traffic-loss-after-sfp-swap"
    severity: Severity = "major"
    summary: str
    observations: dict[str, Any] = Field(default_factory=dict)  # keys from models.OBSERVABLE_FIELDS


class Incident(IncidentSpec):
    id: str  # "inc_0001"
    status: IncidentStatus = "open"
    opened_at: datetime
    resolved_at: datetime | None = None
    thread_id: str | None = None
    scenario_id: str | None = None
    origin: Origin = "synthetic"


# ---------------------------------------------------------------- scenarios


class ScenarioMessage(BaseModel):
    persona: str  # Persona.id
    delay_s: float = 5  # simulated seconds after the previous message
    text: str


class Scenario(BaseModel):
    id: str
    title: str
    description: str = ""
    channel: ThreadSource = "teams"
    subject: str | None = None
    incident: IncidentSpec | None = None
    participants: list[str] = Field(default_factory=list)  # Persona ids
    messages: list[ScenarioMessage]
    resolves_incident_at_seq: int | None = None  # 1-based seq of the message that resolves it
    expected: ExtractionResult | None = None  # ground truth: used by "scripted" mode and for eval
    tags: list[str] = Field(default_factory=list)
    origin: Origin = "synthetic"


class ScenarioRun(BaseModel):
    id: str  # "run_0001"
    scenario_id: str
    thread_id: str
    incident_id: str | None = None
    started_at: datetime  # sim
    next_seq: int = 1  # next message to post
    done: bool = False


# ---------------------------------------------------------------- threads


class LiveThread(BaseModel):
    """core models.Thread plus workbench fields. Build a core Thread with to_thread()."""

    id: str  # "live/<8 hex>" for live threads, "elisa/teams_chat.json" for seeded files
    source: ThreadSource
    subject: str | None = None
    messages: list[Message] = Field(default_factory=list)
    participants: list[str] = Field(default_factory=list)  # Persona ids or display names
    origin: Origin = "synthetic"
    status: ThreadStatus = "active"
    scenario_id: str | None = None
    incident_id: str | None = None
    slack_ts: str | None = None  # root message ts when mirrored to Slack
    created_at: datetime
    last_message_at: datetime | None = None
    last_job_id: str | None = None

    def to_thread(self):
        from ..models import Thread

        return Thread(id=self.id, source=self.source, subject=self.subject, messages=self.messages)


# ---------------------------------------------------------------- pipeline jobs


class Stage(BaseModel):
    stage: StageName
    status: StageStatus = "pending"
    detail: str = ""
    duration_ms: int | None = None


class EvalResult(BaseModel):
    """Extraction vs. the scenario's expected items, matched on (type, topic)."""

    matched: list[str] = Field(default_factory=list)  # topics
    missed: list[str] = Field(default_factory=list)
    unexpected: list[str] = Field(default_factory=list)
    binding_diffs: list[str] = Field(default_factory=list)  # human-readable notes


class PipelineJob(BaseModel):
    id: str  # "job_0001"
    thread_id: str
    started_at: datetime  # wall
    finished_at: datetime | None = None  # wall
    extractor: str = ""  # "llm:<model>", "scripted", "cache", "none"
    stages: list[Stage] = Field(default_factory=lambda: [Stage(stage=s) for s in STAGES])  # type: ignore[arg-type]
    items: list[ExtractedItem] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)  # linker notes, skipped items
    assertion_ids: list[str] = Field(default_factory=list)  # created or merged
    removed_assertion_ids: list[str] = Field(default_factory=list)  # dropped on re-processing
    events: list[str] = Field(default_factory=list)  # lifecycle: closed, conflict, merged
    llm_call_ids: list[str] = Field(default_factory=list)
    eval: EvalResult | None = None
    error: str | None = None


# ---------------------------------------------------------------- LLM trace


class LlmUsage(BaseModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cost: float | None = None  # USD when the provider returns it


class LlmCall(BaseModel):
    """One line of out/workbench/llm_calls.jsonl. Never holds an API key."""

    id: str  # "llm_<12 hex>"
    ts: datetime  # wall
    sim_time: datetime | None = None
    purpose: LlmPurpose
    thread_id: str | None = None
    provider: str  # "primary" or "fallback"
    base_url: str
    model: str
    json_mode: JsonMode | None = None
    system: str
    user: str
    raw_response: str | None = None
    parsed_ok: bool | None = None  # set by the caller once it parsed the response
    parse_error: str | None = None
    latency_ms: int | None = None
    usage: LlmUsage = Field(default_factory=LlmUsage)
    fallback_used: bool = False
    error: str | None = None


# ---------------------------------------------------------------- settings, clock, snapshot, events


class Settings(BaseModel):
    extractor_mode: ExtractorMode = "auto"
    lifecycle: bool = True
    idle_seconds: float = 8  # wall seconds without a new message before a thread is processed
    use_conditions: bool = True
    use_guard: bool = True
    slack_mirror: bool = True
    auto_sim: bool = False  # start a random scenario every auto_every_s wall seconds
    auto_every_s: float = 45
    # read-only, filled by the backend
    llm_configured: bool = False
    llm_model: str | None = None
    llm_fallback_model: str | None = None
    slack_connected: bool = False


class ClockState(BaseModel):
    sim_now: datetime
    speed: float = 1  # simulated seconds per wall second
    running: bool = False


class StateSnapshot(BaseModel):
    clock: ClockState
    settings: Settings
    elements: list[WbElement]
    sites: list[WbSite]
    links: list[TopologyLink]
    personas: list[Persona]
    threads: list[LiveThread]
    incidents: list[Incident]
    assertions: list[ContextAssertion]
    classes: list[ElementClass]
    jobs: list[PipelineJob]  # last 50, newest last
    scenarios: list[Scenario]
    runs: list[ScenarioRun]
    llm_calls: list[LlmCall]  # last 50, newest last


EventType = Literal[
    "clock",
    "settings.changed",
    "message.posted",  # data: {"thread_id": str, "message": Message}
    "thread.upserted",  # data: LiveThread (without messages: "messages": [])
    "thread.deleted",  # data: {"id": str}
    "incident.upserted",  # data: Incident
    "incident.deleted",  # data: {"id": str}
    "pipeline.job",  # data: PipelineJob (whole job, on every stage change)
    "assertion.upserted",  # data: ContextAssertion
    "assertion.deleted",  # data: {"id": str}
    "class.upserted",  # data: ElementClass
    "inventory.changed",  # data: {"elements": [...], "sites": [...], "links": [...]}
    "personas.changed",  # data: {"personas": [...]}
    "scenarios.changed",  # data: {"scenarios": [...], "runs": [...]}
    "slack.status",  # data: {"connected": bool, "channel": str | None, "error": str | None}
    "llm.call",  # data: LlmCall
    "state.reset",  # data: {} -> clients refetch GET /api/state
    "log",  # data: {"level": "info" | "warning" | "error", "text": str}
]


class WbEvent(BaseModel):
    id: int
    ts: datetime  # wall
    sim_time: datetime
    type: EventType
    data: Any


# ---------------------------------------------------------------- request bodies


class SpeedBody(BaseModel):
    speed: float


class ClockBody(BaseModel):
    at: datetime


class GenerateBody(BaseModel):
    entity_id: str | None = None
    hint: str | None = None


class NewThreadBody(BaseModel):
    source: ThreadSource = "teams"
    subject: str | None = None
    participants: list[str] = Field(default_factory=list)


class PostMessageBody(BaseModel):
    persona_id: str | None = None  # either a persona ...
    author: str | None = None  # ... or a free author name
    role: str | None = None
    text: str


class NewIncidentBody(IncidentSpec):
    pass


class GuardBody(BaseModel):
    action: str
    entity_id: str
    at: datetime | None = None  # default: sim now
    observations: dict[str, Any] | None = None


class AgentRunBody(BaseModel):
    entity_id: str
    observations: dict[str, Any] = Field(default_factory=dict)
    planned_action: str | None = None
    description: str = ""
    at: datetime | None = None  # default: sim now
    use_llm: bool = False


class AgentRunResult(BaseModel):
    recommendation: str
    hits: list[dict[str, Any]]  # {"matched_via": str, **assertion}
    skipped: list[dict[str, Any]]  # {"assertion_id": str, "reason": str}
    verdict: dict[str, Any] | None = None  # {"decision", "action", "steps", "reasons"}
    cited_assertion_ids: list[str] = Field(default_factory=list)
    evidence_confidence: float | None = None


class OutcomeBody(BaseModel):
    """After acting on an assertion: what the agent observes now (see mvp/feedback.py)."""

    assertion_id: str
    entity_id: str
    after: dict[str, Any] = Field(default_factory=dict)
    worked: bool | None = None  # overrides the judgment from `after`
    at: datetime | None = None  # default: sim now


class ResetBody(BaseModel):
    mode: Literal["seed", "empty"] = "seed"


class SettingsPatch(BaseModel):
    extractor_mode: ExtractorMode | None = None
    lifecycle: bool | None = None
    idle_seconds: float | None = None
    use_conditions: bool | None = None
    use_guard: bool | None = None
    slack_mirror: bool | None = None
    auto_sim: bool | None = None
    auto_every_s: float | None = None


class LlmCheckResult(BaseModel):
    provider: str
    base_url: str
    model: str
    ping_ok: bool
    modes: dict[str, dict[str, Any]]  # mode -> {"ok": bool, "latency_ms": int, "error": str | None, "items": int}
    recommended_mode: JsonMode | None = None
