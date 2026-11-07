"""Idea C: conditional rules. The agent fires a rule only when its conditions hold on the case.

This checks observations an agent already has; it does not diagnose faults from telemetry.
"""

from dataclasses import dataclass, field
from typing import Any, Literal

from ..models import ContextAssertion

CheckStatus = Literal["failed", "fully checked", "not fully checked", "text only"]


@dataclass
class ConditionReport:
    applies: bool | None  # True: all checks met; False: one failed; None: nothing to check or not observed
    met: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    unknown: list[str] = field(default_factory=list)
    checks: int = 0  # conditions with a machine check
    to_read: list[str] = field(default_factory=list)  # fields the agent can read to finish the open checks

    @property
    def status(self) -> CheckStatus:
        """How far the rule was checked against the case. Facts about the case, not a weight.

        - "failed": a check is false, the rule does not apply;
        - "fully checked": every machine check ran and passed;
        - "not fully checked": some checks could not run (field not observed); see `to_read`;
        - "text only": no machine check (no conditions, or conditions only in words, e.g. "after a storm").
        """
        if self.failed:
            return "failed"
        if not self.checks:
            return "text only"
        return "not fully checked" if self.to_read else "fully checked"


def evaluate(assertion: ContextAssertion, observations: dict[str, Any]) -> ConditionReport:
    report = ConditionReport(applies=None)
    for cond in assertion.conditions:
        result = cond.check.evaluate(observations) if cond.check else None
        {True: report.met, False: report.failed, None: report.unknown}[result].append(cond.text)
        if cond.check:
            report.checks += 1
            if result is None and cond.check.field not in report.to_read:
                report.to_read.append(cond.check.field)
    if report.failed:
        report.applies = False
    elif report.met and not report.unknown:
        report.applies = True
    return report
