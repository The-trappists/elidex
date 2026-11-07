"""Idea B: ask-before-act guard.

Before an agent acts ("reboot TRN-117", "dispatch engineer to RAD-221"), look up human knowledge
and return go or adapt, citing the source. This is a mock agent step, not Elisa's workflow.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from ..store import ContextHit, ContextStore
from . import conditions, feedback

# Small verb vocabulary: enough for the demo, extend as needed.
VERBS = {
    "reboot": ["reboot", "restart", "power cycle", "power-cycle"],
    "replace": ["replace", "swap", "change"],
    "dispatch": ["dispatch", "send", "visit", "drive"],
}


def verbs_in(text: str) -> set[str]:
    text = text.lower()
    return {verb for verb, words in VERBS.items() if any(re.search(rf"\b{re.escape(w)}", text) for w in words)}


@dataclass
class Verdict:
    decision: Literal["go", "adapt"]
    action: str
    steps: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)


def _cite(hit: ContextHit) -> str:
    a = hit.assertion
    srcs = ", ".join(s.file for s in a.sources)
    return f"{a.id} ({a.trust.level}, {a.trust.stated_by}; {srcs})"


def check(
    store: ContextStore,
    action: str,
    entity_id: str,
    at: datetime | None = None,
    observations: dict[str, Any] | None = None,
    context_hits: list[ContextHit] | None = None,
) -> Verdict:
    planned = verbs_in(action)
    steps, reasons = [], []
    hits = context_hits if context_hits is not None else store.get_context(entity_id, at=at)
    for hit in hits:
        a = hit.assertion
        if observations is not None and conditions.evaluate(a, observations).applies is False:
            continue
        if a.type == "workaround" and planned & verbs_in(" ".join(a.avoid)):
            steps.append(a.action or a.summary)
            reasons.append(f"Human knowledge says avoid '{'; '.join(a.avoid)}' here: {_cite(hit)}")
            if (tr := feedback.track_record(a, at)).status == "contested":
                reasons.append(f"But {a.id} is contested in the field: {tr.line()}")
        elif a.type == "access" and "dispatch" in planned:
            steps.append(a.action or a.fact or a.summary)
            reasons.append(f"Site access: {a.fact or a.summary} {_cite(hit)}")
    if not steps:
        return Verdict("go", action, [action], ["No human knowledge against this action."])
    final = f"Only if that fails: {action}" if "dispatch" not in planned else action
    return Verdict("adapt", action, steps + [final], reasons)
