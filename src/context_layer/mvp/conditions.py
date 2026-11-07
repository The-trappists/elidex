"""Idea C: conditional rules. The agent fires a rule only when its conditions hold on the case.

This checks observations an agent already has; it does not diagnose faults from telemetry.
"""

from dataclasses import dataclass, field
from typing import Any

from ..models import ContextAssertion


@dataclass
class ConditionReport:
    applies: bool | None  # True: all checks met; False: one failed; None: nothing to check or not observed
    met: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    unknown: list[str] = field(default_factory=list)


def evaluate(assertion: ContextAssertion, observations: dict[str, Any]) -> ConditionReport:
    report = ConditionReport(applies=None)
    for cond in assertion.conditions:
        result = cond.check.evaluate(observations) if cond.check else None
        {True: report.met, False: report.failed, None: report.unknown}[result].append(cond.text)
    if report.failed:
        report.applies = False
    elif report.met and not report.unknown:
        report.applies = True
    return report
