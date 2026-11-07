"""Idea C: conditional rules. The agent fires a rule only when its conditions hold on the case.

This checks observations an agent already has; it does not diagnose faults from telemetry.
"""

from dataclasses import dataclass, field
import re
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


_STOPWORDS = {
    "a", "an", "and", "are", "after", "before", "but", "by", "does", "for", "from",
    "if", "in", "is", "it", "of", "on", "or", "the", "then", "to", "when", "with",
    "unit", "units", "node", "nodes", "stay", "stays", "remain", "remains",
}


def _text_check(text: str, description: str) -> bool | None:
    """Return True only when all meaningful condition words are stated in the case."""
    if not description:
        return None
    words = [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOPWORDS]
    case_words = re.findall(r"[a-z0-9]+", description.lower())
    positions = [i for i, word in enumerate(case_words) if word in words]
    if words and all(word in case_words for word in words):
        negations = {"no", "not", "never", "without", "neither"}
        if any(negations.intersection(case_words[max(0, i - 3):i]) for i in positions):
            return False
        return True
    return None


def evaluate(
    assertion: ContextAssertion,
    observations: dict[str, Any],
    description: str = "",
) -> ConditionReport:
    report = ConditionReport(applies=None)
    for cond in assertion.conditions:
        result = cond.check.evaluate(observations) if cond.check else _text_check(cond.text, description)
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
