"""Demo agent: on a new case, retrieve human context and propose what to do.

Deterministic by default (template); `use_llm=True` lets the LLM phrase the plan from the same context.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from . import config, llm
from .mvp import conditions, guard
from .store import ContextHit, ContextStore


class Case(BaseModel):
    id: str
    title: str
    entity_id: str
    at: datetime
    description: str
    observations: dict[str, Any] = Field(default_factory=dict)
    planned_action: str | None = None


def load_cases(path: Path = config.CASES_FILE) -> list[Case]:
    return [Case.model_validate(c) for c in json.loads(path.read_text(encoding="utf-8"))]


@dataclass
class AgentReport:
    case: Case
    hits: list[ContextHit]
    skipped: list[tuple[ContextHit, str]] = field(default_factory=list)
    recommendation: str = ""
    verdict: guard.Verdict | None = None


def describe(hit: ContextHit) -> str:
    a = hit.assertion
    who = a.trust.stated_by + (f", {a.trust.role}" if a.trust.role else "")
    until = f" until {a.valid_to:%Y-%m-%d %H:%M}" if a.valid_to else ""
    lines = [
        f"[{a.id}] {a.type} · trust {a.trust.level} ({who}) · valid from {a.valid_from:%Y-%m-%d %H:%M}{until} · via {hit.matched_via}",
        f"  {a.summary}",
    ]
    if a.conditions:
        lines.append("  When: " + "; ".join(c.text for c in a.conditions))
    if a.fact and a.fact != a.summary:
        lines.append(f"  Fact: {a.fact}")
    if a.action:
        lines.append(f"  Do: {a.action}")
    if a.avoid:
        lines.append("  Avoid: " + "; ".join(a.avoid))
    if a.conflicts_with:
        lines.append("  Conflicts with: " + ", ".join(a.conflicts_with))
    srcs = " | ".join(f"{s.source} {s.file}" + (f" seq {','.join(map(str, s.seq))}" if s.source == "teams" else "") for s in a.sources)
    lines.append(f"  Sources: {srcs}")
    return "\n".join(lines)


def _template(case: Case, hits: list[ContextHit]) -> str:
    if not hits:
        return f"No applicable human knowledge was found for {case.entity_id}. Follow the standard procedure."
    best = max(hits, key=lambda h: (h.assertion.trust.level == "verified", h.assertion.confidence, len(h.assertion.sources)))
    assertion = best.assertion
    action = assertion.action or assertion.summary
    warning = f" Avoid: {', '.join(assertion.avoid)}." if assertion.avoid else ""
    return f"{action} [{assertion.id}].{warning}"


AGENT_PROMPT = """You are a network operations assistant. Recommend one concise next step using only the human context given.
Cite every assertion you rely on using its exact id in square brackets, for example [ctx_0001]. Do not cite assertions that do not support the recommendation. Mention a key condition or warning only when it changes what the operator should do. If there is no applicable context, say so and recommend the standard procedure.
Answer in 1-2 short sentences and no more than 5 short lines (at most 30 words). No preamble, headings, or repeated observations."""


def cited_assertion_ids(recommendation: str, hits: list[ContextHit]) -> list[str]:
    """Return only assertion citations that were actually retrieved for this run."""
    found = set(re.findall(r"\[(ctx_[0-9]+)\]", recommendation))
    return [h.assertion.id for h in hits if h.assertion.id in found]


def _llm(case: Case, hits: list[ContextHit]) -> str:
    context = [h.assertion.model_dump(mode="json", exclude={"link_notes"}) for h in hits]
    user = json.dumps({"case": case.model_dump(mode="json"), "human_context": context}, ensure_ascii=False)
    return llm.complete(AGENT_PROMPT, user)


def run_agent(
    store: ContextStore,
    case: Case,
    use_conditions: bool = False,
    use_guard: bool = False,
    use_llm: bool = False,
) -> AgentReport:
    report = AgentReport(case=case, hits=store.get_context(case.entity_id, at=case.at))
    if use_conditions:
        kept = []
        for hit in report.hits:
            cr = conditions.evaluate(hit.assertion, case.observations)
            if cr.applies is False:
                report.skipped.append((hit, "condition not met: " + "; ".join(cr.failed)))
            else:
                kept.append(hit)
        report.hits = kept
    report.recommendation = _llm(case, report.hits) if use_llm else _template(case, report.hits)
    if use_guard and case.planned_action:
        obs = case.observations if use_conditions else None
        report.verdict = guard.check(store, case.planned_action, case.entity_id, at=case.at, observations=obs)
    return report
