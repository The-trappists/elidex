"""Field feedback: learn, without a human, that a piece of knowledge does not work in reality.

After an agent applies a rule, it compares what it observes with the rule's own checks. The checks describe the
problem ("interface DOWN", "counters stay at 0"), so:

- every symptom check still holds after the action -> the problem is still there -> it did not work;
- at least one symptom check no longer holds -> the state changed -> it worked;
- no symptom check observed after the action -> no verdict (we do not guess).

The rule is never dropped or closed on feedback: one failure can have another cause. It is flagged "contested" once
it has failed at least twice and more often than it worked, and the agent sees where it failed.
This reuses observations the agent already has; it does not diagnose faults.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from ..models import ContextAssertion, Outcome

# Fields that say what happened, not the state of the problem: they stay true after any fix.
EVENT_FIELDS = {"sfp_replaced"}
CONTESTED_MIN_FAILURES = 2


def judge(assertion: ContextAssertion, after: dict[str, Any]) -> tuple[bool | None, str]:
    """(worked?, evidence) from the observations taken after the action."""
    symptoms = [c.check for c in assertion.conditions if c.check and c.check.field not in EVENT_FIELDS]
    results = [(chk, chk.evaluate(after)) for chk in symptoms]
    observed = [(chk, r) for chk, r in results if r is not None]
    if not observed:
        return None, "no symptom observed after the action"
    changed = [chk for chk, r in observed if r is False]
    if changed:
        return True, "; ".join(f"{c.field} now {after[c.field]!r}" for c in changed)
    return False, "; ".join(f"{c.field} still {after[c.field]!r}" for c, _ in observed) + " after the action"


def record(
    assertion: ContextAssertion,
    entity: str,
    at: datetime,
    after: dict[str, Any],
    worked: bool | None = None,
    case_id: str | None = None,
    *,
    source: Literal["observation", "thread"] = "observation",
    application_id: str | None = None,
    quote: str | None = None,
) -> Outcome | None:
    """Record an outcome on the assertion. `worked` overrides the judgment (e.g. the ticket was closed).

    Returns None, and records nothing, when there is no verdict, or when `application_id` is already in the
    ledger (one application is one event: it is never counted twice).
    """
    if application_id and any(o.application_id == application_id for o in assertion.outcomes):
        return None
    verdict, evidence = judge(assertion, after)
    if worked is not None:
        verdict, evidence = worked, f"reported by the agent; {evidence}"
    if verdict is None:
        return None
    outcome = Outcome(
        entity=entity, at=at, worked=verdict, evidence=evidence, case_id=case_id,
        source=source, application_id=application_id, quote=quote,
    )
    assertion.outcomes.append(outcome)
    return outcome


@dataclass
class TrackRecord:
    worked: int = 0
    failed: int = 0
    failed_on: list[str] = field(default_factory=list)
    thread: int = 0  # how many of the outcomes came from a human reply in a thread
    last_at: datetime | None = None

    @property
    def status(self) -> Literal["untested", "ok", "contested"]:
        if not self.worked and not self.failed:
            return "untested"
        if self.failed >= CONTESTED_MIN_FAILURES and self.failed > self.worked:
            return "contested"
        return "ok"

    def to_dict(self) -> dict[str, Any]:
        """The one JSON shape of a track record (API, LLM payload, UI)."""
        return {
            "status": self.status, "worked": self.worked, "failed": self.failed, "failed_on": self.failed_on,
            "thread": self.thread, "last_at": self.last_at.isoformat() if self.last_at else None,
        }

    def line(self) -> str:
        where = f" (failed on {', '.join(self.failed_on)})" if self.failed_on else ""
        flag = " CONTESTED: check before acting" if self.status == "contested" else ""
        return f"Track record: worked {self.worked}/{self.worked + self.failed}{where}{flag}"


def track_record(assertion: ContextAssertion, at: datetime | None = None) -> TrackRecord:
    """Outcomes known at time `at` (default: all)."""
    tr = TrackRecord()
    for o in assertion.outcomes:
        if at is not None and o.at > at:
            continue
        tr.thread += o.source == "thread"
        if tr.last_at is None or o.at > tr.last_at:
            tr.last_at = o.at
        if o.worked:
            tr.worked += 1
        else:
            tr.failed += 1
            if o.entity not in tr.failed_on:
                tr.failed_on.append(o.entity)
    return tr
