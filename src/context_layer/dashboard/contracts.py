"""Dashboard contract: every model the backend, the simulator, the Slack bridge and the web UI share.

Mirrored by hand in web/src/api/types.ts. Change both together, and tell the team first.
All datetimes are naive and in *simulated* time unless the field says "wall".
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, field_serializer

from ..models import (
    Condition,
    ContextAssertion,
    ElementClass,
    ExtractionResult,
    ExtractedItem,
    Message,
    NetworkElement,
    Site,
    TrustLevel,
)

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
LlmPurpose = Literal["extract", "generate_scenario", "agent", "check", "critic", "judge"]
JsonMode = Literal["json_object", "json_schema", "prompt"]

FlagKind = Literal[
    "abstained", "low_confidence", "conflict", "over_reach", "critic_rejected", "judge_decision", "operator_edit"
]
CriticVerdictKind = Literal["keep", "downgrade", "reject"]
JudgeVerdictKind = Literal["supports", "contradicts", "supersedes", "unrelated"]


def to_local_naive(t: datetime) -> datetime:
    """Wall time as naive local time. A naive value is already local (old log lines); an aware one is converted."""
    return t.astimezone().replace(tzinfo=None) if t.tzinfo else t


def to_utc_iso(t: datetime | None) -> str | None:
    """Wall time for the API: an aware UTC ISO string ("...+00:00"). A naive value is read as local time."""
    return t.astimezone(timezone.utc).isoformat() if t is not None else None

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
    """core models.Thread plus dashboard fields. Build a core Thread with to_thread()."""

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


class ReviewFlag(BaseModel):
    """Something the loop wants the operator to see. Informational: nothing waits for a click."""

    id: str
    kind: FlagKind
    thread_id: str
    job_id: str
    assertion_id: str | None = None
    item_topic: str | None = None  # topic of the extracted item or assertion this is about, when known
    message: str  # plain language
    detail: str | None = None
    created_at: datetime  # wall
    dismissed: bool = False


class AssertionEdit(BaseModel):
    """One operator change to an assertion. `before` and `after` hold only the fields the edit touched
    (summary, action, avoid, conditions, valid_to, closed_by, trust, sources, link_notes), as JSON."""

    id: str  # "edit_0001"
    assertion_id: str
    ts: datetime  # wall
    note: str | None = None
    before: dict[str, Any]
    after: dict[str, Any]
    undone: bool = False


ApplicationOutcome = Literal["pending", "worked", "failed", "unclear"]


class RuleApplication(BaseModel):
    """The agent applied a piece of knowledge to a case and said so in a thread. The next human messages of
    that thread decide the outcome (passive outcome loop, nobody is asked anything)."""

    id: str  # "app_0001"
    assertion_id: str
    entity_id: str
    thread_id: str
    applied_at: datetime  # sim
    message_seq: int | None = None  # seq of the agent message that announced it
    outcome: ApplicationOutcome = "pending"
    outcome_quote: str | None = None  # verbatim from the human message that decided it
    outcome_reason: str | None = None
    outcome_at: datetime | None = None  # sim
    method: Literal["llm", "heuristic", "observation"] | None = None  # observation: settled by POST /agent/outcome


class CriticVerdict(BaseModel):
    """Critic pass inside understand: one verdict per extracted item."""

    item_topic: str
    verdict: CriticVerdictKind
    reason: str
    evidence_found: bool  # the evidence quote was found in a cited message
    confidence_after: float | None = None
    confidence_before: float | None = None  # the extractor value before a downgrade; None on old jobs


class JudgeVerdict(BaseModel):
    """Judge pass inside reconcile: how a new assertion relates to an existing one."""

    new_assertion_id: str
    other_assertion_id: str
    verdict: JudgeVerdictKind
    reason: str


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
    flags: list[ReviewFlag] = Field(default_factory=list)
    critic: list[CriticVerdict] = Field(default_factory=list)
    judge: list[JudgeVerdict] = Field(default_factory=list)
    error: str | None = None


# ---------------------------------------------------------------- LLM trace


class LlmUsage(BaseModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cost: float | None = None  # USD when the provider returns it


class LlmCall(BaseModel):
    """One line of out/dashboard/llm_calls.jsonl. Never holds an API key."""

    id: str  # "llm_<12 hex>"
    ts: datetime  # wall
    sim_time: datetime | None = None
    purpose: LlmPurpose
    thread_id: str | None = None
    provider: str  # "primary" or "fallback"; "critic" / "critic_fallback" for the critic role
    role: str | None = None  # "primary" or "critic"; None on old trace lines
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

    @field_serializer("ts")
    def _ts_utc(self, t: datetime) -> str | None:
        return to_utc_iso(t)


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
    use_critic: bool = True  # critic pass inside understand
    use_judge: bool = True  # judge pass inside reconcile
    use_outcome_loop: bool = True  # outcome feedback on assertions
    use_dedupe: bool = True  # fold a near-duplicate new assertion into the older one (dashboard/dedupe.py)
    use_relevance: bool = True  # agent runs tag each rule with whether it is about the case's problem (mvp/relevance.py)
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
    "review.flag",  # data: ReviewFlag (created, refreshed, dismissed or undismissed)
    "application.upserted",  # data: RuleApplication (created or outcome decided)
    "company.state",  # data: CompanyState without cycles/calls/health (status, clock, timeline)
    "company.cycle",  # data: CompanyCycle (one autonomous-system sync, every cycle_minutes of sim time)
    "agent.call",  # data: AgentCall (the autonomous system asked the context layer about one element)
    "network.status",  # data: ElementHealth (one element changed status)
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
    # outcome loop (only when settings.use_outcome_loop is on and knowledge was applied)
    thread_id: str | None = None  # the thread the agent message was posted in
    applications: list[dict[str, Any]] = Field(default_factory=list)  # RuleApplication JSON
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


MAX_PERSONAS, MAX_ELEMENTS, MAX_SITES = 100, 600, 80  # a small company: keeps memory and the graph light


class LoadDatasetBody(BaseModel):
    """POST /data/load-dataset: replace the state with a connected sample of the company dataset."""

    sites: int = Field(40, ge=9, le=MAX_SITES)  # the Elisa seed alone has 9 sites
    threads: int = Field(300, ge=0, le=1000)
    seed: int = 42


class SettingsPatch(BaseModel):
    extractor_mode: ExtractorMode | None = None
    lifecycle: bool | None = None
    idle_seconds: float | None = None
    use_conditions: bool | None = None
    use_guard: bool | None = None
    slack_mirror: bool | None = None
    auto_sim: bool | None = None
    auto_every_s: float | None = None
    use_critic: bool | None = None
    use_judge: bool | None = None
    use_outcome_loop: bool | None = None
    use_dedupe: bool | None = None
    use_relevance: bool | None = None


class LlmCheckResult(BaseModel):
    provider: str
    base_url: str
    model: str
    ping_ok: bool
    modes: dict[str, dict[str, Any]]  # mode -> {"ok": bool, "latency_ms": int, "error": str | None, "items": int}
    recommended_mode: JsonMode | None = None


class RerunBody(BaseModel):
    items: list[ExtractedItem] | None = None  # replacement items (skips understand)
    model: str | None = None  # LLM model override for this run
    from_stage: Literal["link", "store"] = "link"


class UndoBody(BaseModel):
    edit_id: str | None = None  # undo this edit; omitted: the latest one not undone


class OperatorEdit(BaseModel):
    """Fields an operator may change on an assertion. Omitted fields stay as they are."""

    summary: str | None = None
    action: str | None = None
    avoid: list[str] | None = None
    conditions: list[Condition] | None = None
    valid_to: datetime | None = None
    trust_level: TrustLevel | None = None
    note: str | None = None


# ---------------------------------------------------------------- company day (the "big boss" scenario)
# A simulated working day of the whole company: many chats in parallel, incidents opening and closing, and every
# `cycle_minutes` of sim time Elisa's autonomous network system takes the knowledge package, asks the context layer
# about each affected element and updates the network status. Incidents stay scripted ground truth (no detection).

HealthStatus = Literal["healthy", "degraded", "down", "recovering"]
CompanyStatus = Literal["idle", "running", "paused", "finished"]


class ElementHealth(BaseModel):
    element_id: str
    status: HealthStatus = "healthy"
    since: datetime  # sim
    incident_id: str | None = None
    reason: str = ""  # plain language: why this status
    applied_assertion_ids: list[str] = Field(default_factory=list)  # knowledge the autonomous system used
    recommendation: str | None = None


class AgentCall(BaseModel):
    """One question of the autonomous system to the context layer, about one element, in one cycle."""

    id: str  # "call_0001"
    cycle: int
    at: datetime  # sim
    entity_id: str
    incident_id: str | None = None
    thread_id: str | None = None
    observations: dict[str, Any] = Field(default_factory=dict)
    hit_ids: list[str] = Field(default_factory=list)  # assertions retrieved
    skipped: int = 0  # retrieved but dropped (conditions not met)
    cited_assertion_ids: list[str] = Field(default_factory=list)
    recommendation: str = ""
    verdict: str | None = None  # guard decision, when a planned action was checked
    status_before: HealthStatus = "healthy"
    status_after: HealthStatus = "healthy"
    used_llm: bool = False


class KnowledgePackage(BaseModel):
    """What the context layer hands over at each sync. Light summary; the full content is
    GET /api/company/package?cycle=N."""

    cycle: int
    at: datetime  # sim
    total: int  # assertions in the store
    valid: int  # valid at `at`
    new_ids: list[str] = Field(default_factory=list)  # created since the previous cycle
    closed_ids: list[str] = Field(default_factory=list)  # closed or superseded since the previous cycle
    classes: int = 0
    trust: dict[str, int] = Field(default_factory=dict)  # trust level -> count (valid ones)


class StatusChange(BaseModel):
    element_id: str
    from_status: HealthStatus
    to_status: HealthStatus
    reason: str = ""


class CompanyCycle(BaseModel):
    n: int  # 1-based
    at: datetime  # sim
    package: KnowledgePackage
    agent_call_ids: list[str] = Field(default_factory=list)
    status_changes: list[StatusChange] = Field(default_factory=list)
    open_incidents: int = 0
    health_counts: dict[str, int] = Field(default_factory=dict)  # status -> number of elements (healthy included)


class CompanyTimelineEntry(BaseModel):
    """One planned event of the day. `at_min` is sim minutes since the start of the day."""

    id: str
    at_min: float
    kind: Literal["chat", "incident_chat", "noise", "generated"]
    scenario_id: str
    label: str
    started: bool = False
    run_id: str | None = None


class CompanyState(BaseModel):
    status: CompanyStatus = "idle"
    started_at: datetime | None = None  # sim
    ends_at: datetime | None = None  # sim
    day_minutes: int = 480  # 0 when endless
    endless: bool = False  # no end: chats are generated in real time after the scripted timeline
    generated_count: int = 0  # chats produced by the generator so far
    cycle_minutes: int = 10
    speed: float = 120  # sim seconds per wall second while the day runs
    use_llm: bool = False  # agent calls with the LLM recommendation
    next_cycle_at: datetime | None = None  # sim
    cycles: list[CompanyCycle] = Field(default_factory=list)  # last 60
    calls: list[AgentCall] = Field(default_factory=list)  # last 200
    health: list[ElementHealth] = Field(default_factory=list)  # every element that ever left "healthy"
    timeline: list[CompanyTimelineEntry] = Field(default_factory=list)


class CompanyStartBody(BaseModel):
    speed: float = Field(120, ge=1, le=3600)
    day_minutes: int = Field(480, ge=0, le=1440)  # 0 = endless (run until stopped)
    cycle_minutes: int = Field(10, ge=1, le=60)
    reset: Literal["empty", "keep"] = "empty"  # "empty": drop threads/knowledge first so the graph grows from scratch
    clear_archive: bool = True  # with reset "empty": also empty the cold archive (files, Atlas wb_* collections, Tiger wb_company_metrics)
    use_llm: bool = False


# ---------------------------------------------------------------- knowledge polish: justification, export, dedupe, LLM log compaction
# Contract shared by the backend and the web UI (mirror: web/src/api/types.ts, section "knowledge polish").

FactorEffect = Literal["supports", "limits", "neutral"]


class JustificationFactor(BaseModel):
    label: str  # short, plain language, e.g. "Stated by a network expert"
    effect: FactorEffect = "neutral"  # raises (supports), lowers (limits) or does not move the level
    detail: str = ""  # one sentence with the evidence (names, counts, quote); never invented


class VerdictNote(BaseModel):
    verdict: str  # critic: keep|downgrade|reject; judge: supports|contradicts|supersedes|unrelated
    reason: str
    other_assertion_id: str | None = None  # judge only


class Justification(BaseModel):
    """Why the loop gave an assertion its trust level and its confidence. Built from what was recorded
    (who said it, sources, critic and judge verdicts, outcomes, link notes), never invented."""

    assertion_id: str
    trust_level: str
    trust_summary: str  # one or two sentences
    trust_factors: list[JustificationFactor] = Field(default_factory=list)
    confidence: float
    confidence_summary: str
    confidence_factors: list[JustificationFactor] = Field(default_factory=list)
    critic: VerdictNote | None = None
    judge: list[VerdictNote] = Field(default_factory=list)
    n_sources: int = 0
    source_thread_ids: list[str] = Field(default_factory=list)
    track_record: dict[str, Any] | None = None  # same shape as the agent's track_record, when outcomes exist


class DedupeMerge(BaseModel):
    kept_id: str
    merged_id: str  # the near-duplicate that was folded into kept_id (its sources moved to kept_id)
    similarity: float  # 0..1
    method: Literal["exact", "words", "embedding"]
    reason: str
    at: datetime  # wall


class DedupeReport(BaseModel):
    enabled: bool
    merged_total: int = 0
    recent: list[DedupeMerge] = Field(default_factory=list)  # newest first, last 50
    threshold: float = 0.90


class LlmSummary(BaseModel):
    """State of the AI activity log after compaction."""

    total_kept: int
    by_purpose: dict[str, int] = Field(default_factory=dict)
    errors_kept: int = 0
    oldest: datetime | None = None  # wall
    newest: datetime | None = None  # wall
    archived_total: int = 0  # moved out of the live log, still in out/dashboard/archive/llm_calls.jsonl
    last_compacted_at: datetime | None = None  # wall
    last_removed: int = 0  # moved out by the last compaction

    @field_serializer("oldest", "newest", "last_compacted_at")
    def _wall_utc(self, t: datetime | None) -> str | None:
        return to_utc_iso(t)
