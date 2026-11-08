"""Shared data model. This is the contract every workstream codes against (see docs/design.md)."""

from __future__ import annotations

import operator
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

SourceKind = Literal["teams", "email", "slack", "operator"]
AssertionType = Literal["workaround", "access", "fact", "invalidation"]
TrustLevel = Literal["hunch", "stated", "verified"]
BindingRole = Literal["applies_to", "observed_on", "trigger"]
Op = Literal["==", "!=", "<", "<=", ">", ">="]

TRUST_RANK = {"hunch": 0, "stated": 1, "verified": 2}

# Fields an agent can observe on a case; conditions may only check these.
OBSERVABLE_FIELDS = {
    "sfp_replaced": "bool, an optical module was just replaced",
    "interface_status": '"UP" or "DOWN"',
    "optical_levels": '"normal", "low" or "high"',
    "traffic_counters": "number, packets per second on the interface",
    "alarms": '"active" or "cleared"',
    "firmware": "string, element firmware version, e.g. '4.1' or '4.2'",
}

# ---------------------------------------------------------------- Listen


class Message(BaseModel):
    thread_id: str
    source: SourceKind
    seq: int
    author: str
    role: str | None = None
    sent_at: datetime
    text: str


class Thread(BaseModel):
    id: str  # path relative to data/, e.g. "elisa/teams_chat.json"
    source: SourceKind
    subject: str | None = None
    messages: list[Message]

    @property
    def started_at(self) -> datetime:
        return min(m.sent_at for m in self.messages)

    def render(self) -> str:
        lines = [f"Channel: {self.source}"]
        if self.subject:
            lines.append(f"Subject: {self.subject}")
        for m in self.messages:
            role = f" ({m.role})" if m.role else ""
            lines.append(f"[seq {m.seq}] {m.sent_at:%Y-%m-%d %H:%M} {m.author}{role}: {m.text}")
        return "\n".join(lines)


# ---------------------------------------------------------------- Network entities


class NetworkElement(BaseModel):
    id: str
    type: str
    model: str
    install_year: int
    firmware: str | None = None
    site_id: str | None = None
    aliases: list[str] = Field(default_factory=list)


class Site(BaseModel):
    id: str
    name: str
    region: str | None = None


class ClassCriteria(BaseModel):
    """Which elements a piece of knowledge covers, e.g. transmission nodes installed up to 2019."""

    type: str | None = None
    model: str | None = None
    install_year_min: int | None = None
    install_year_max: int | None = None

    def matches(self, el: NetworkElement) -> bool:
        if self.type and el.type != self.type:
            return False
        if self.model and el.model.lower() != self.model.lower():
            return False
        if self.install_year_min is not None and el.install_year < self.install_year_min:
            return False
        if self.install_year_max is not None and el.install_year > self.install_year_max:
            return False
        return True

    def is_specific(self) -> bool:
        """A bare type ("all transmission nodes") is too broad to bind safely."""
        return any(v is not None for v in (self.model, self.install_year_min, self.install_year_max))

    def class_id(self) -> str:
        parts = [self.type or "any"]
        if self.model:
            parts.append(self.model.lower())
        lo, hi = self.install_year_min, self.install_year_max
        if lo is not None and hi is not None:
            parts.append(f"installed-{lo}-{hi}")
        elif hi is not None:
            parts.append(f"installed-upto-{hi}")
        elif lo is not None:
            parts.append(f"installed-from-{lo}")
        return "class:" + ":".join(parts)

    def label(self) -> str:
        text = (self.type or "element").replace("_", " ") + "s"
        if self.model:
            text += f" model {self.model}"
        lo, hi = self.install_year_min, self.install_year_max
        if lo is not None and hi is not None:
            text += f" installed {lo}-{hi}"
        elif hi is not None:
            text += f" installed up to {hi}"
        elif lo is not None:
            text += f" installed from {lo}"
        return text


class ElementClass(BaseModel):
    id: str
    label: str
    criteria: ClassCriteria


# ---------------------------------------------------------------- Understand (extractor output)

_OPS = {"==": operator.eq, "!=": operator.ne, "<": operator.lt, "<=": operator.le, ">": operator.gt, ">=": operator.ge}


def parse_version(v: Any) -> tuple[int, ...] | None:
    if not isinstance(v, (str, int, float)):
        return None
    nums = re.findall(r"\d+", str(v))
    return tuple(map(int, nums)) if nums else None


class Check(BaseModel):
    field: str
    op: Op
    value: Any

    def evaluate(self, observations: dict[str, Any]) -> bool | None:
        """True / False, or None when the field was not observed."""
        if self.field not in observations:
            return None
        actual, expected = observations[self.field], self.value
        if self.field == "firmware" or (isinstance(actual, str) and isinstance(expected, str) and "." in actual and "." in expected):
            v_act = parse_version(actual)
            v_exp = parse_version(expected)
            if v_act is not None and v_exp is not None:
                max_len = max(len(v_act), len(v_exp))
                p_act = v_act + (0,) * (max_len - len(v_act))
                p_exp = v_exp + (0,) * (max_len - len(v_exp))
                try:
                    return bool(_OPS[self.op](p_act, p_exp))
                except TypeError:
                    return None
        if isinstance(actual, str) and isinstance(expected, str):
            actual, expected = actual.lower(), expected.lower()
        try:
            return bool(_OPS[self.op](actual, expected))
        except TypeError:
            return None


class Condition(BaseModel):
    text: str
    check: Check | None = None


class Scope(BaseModel):
    """What the text mentions; the linker turns it into bindings."""

    instance_ids: list[str] = Field(default_factory=list)
    site_ids: list[str] = Field(default_factory=list)
    element_class: ClassCriteria | None = None
    trigger: str | None = Field(None, description="event slug, e.g. sfp-replacement")
    qualifier: str | None = Field(None, description='vague scope word as written, e.g. "old"')


class ExtractedItem(BaseModel):
    type: AssertionType
    topic: str = Field(description="short kebab-case slug; reuse a known topic for the same knowledge")
    summary: str
    scope: Scope
    conditions: list[Condition] = Field(default_factory=list)
    diagnosis: str | None = None
    action: str | None = None
    avoid: list[str] = Field(default_factory=list)
    fact: str | None = None
    trust_level: TrustLevel
    evidence: str | None = None
    stated_by: str
    cited_seq: list[int]
    evidence_quote: str | None = Field(None, description="verbatim quote from a cited message")
    confidence: float = Field(ge=0, le=1)


class ExtractionResult(BaseModel):
    items: list[ExtractedItem] = Field(default_factory=list)


# ---------------------------------------------------------------- Link / Store


class Binding(BaseModel):
    entity: str
    role: BindingRole


class Trust(BaseModel):
    level: TrustLevel
    stated_by: str  # who stated the knowledge; never replaced by who confirmed it
    role: str | None = None
    evidence: str | None = None
    confirmed_by: list[str] = Field(default_factory=list)  # other people who backed it: a field report, a repeat

    def add_confirmation(self, other: Trust) -> None:
        """`other` backed the same knowledge. The original author stays (a later disagreement from the confirmer is
        still a disagreement); the other people are added to confirmed_by; the level only goes up."""
        for who in [other.stated_by, *other.confirmed_by]:
            if who and who != self.stated_by and who not in self.confirmed_by:
                self.confirmed_by.append(who)
        if TRUST_RANK[other.level] > TRUST_RANK[self.level]:
            self.level = other.level
            self.evidence = other.evidence or self.evidence


class SourceRef(BaseModel):
    source: SourceKind
    file: str
    seq: list[int] = Field(default_factory=list)


class Outcome(BaseModel):
    """What happened when an agent applied the knowledge on a case (see mvp/feedback.py)."""

    entity: str
    at: datetime
    worked: bool
    evidence: str  # e.g. "interface_status still DOWN after the action"
    case_id: str | None = None
    source: Literal["observation", "thread"] = "observation"  # what decided it: observed state or a human reply
    application_id: str | None = None  # the RuleApplication this outcome settled (dedupe key)
    quote: str | None = None  # verbatim human words, for source "thread"


class ContextAssertion(BaseModel):
    id: str = ""
    type: AssertionType
    topic: str
    summary: str
    bound_to: list[Binding]
    conditions: list[Condition] = Field(default_factory=list)
    diagnosis: str | None = None
    action: str | None = None
    avoid: list[str] = Field(default_factory=list)
    fact: str | None = None
    valid_from: datetime
    valid_to: datetime | None = None  # None = still believed true
    closed_by: str | None = None
    trust: Trust
    sources: list[SourceRef]
    conflicts_with: list[str] = Field(default_factory=list)
    confidence: float
    link_notes: list[str] = Field(default_factory=list)
    outcomes: list[Outcome] = Field(default_factory=list)  # field feedback: did it work when applied?

    @property
    def applies_to(self) -> set[str]:
        return {b.entity for b in self.bound_to if b.role == "applies_to"}

    @property
    def about(self) -> set[str]:
        """Everything the assertion is bound to except its trigger: its scope plus the instances it was seen on."""
        return {b.entity for b in self.bound_to if b.role != "trigger"}

    def is_valid_at(self, t: datetime) -> bool:
        return self.valid_from <= t and (self.valid_to is None or t < self.valid_to)
