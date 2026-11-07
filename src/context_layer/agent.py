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
from .mvp import conditions, feedback, guard
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
    checks: dict[str, conditions.ConditionReport] = field(default_factory=dict)  # assertion id -> check status
    recommendation: str = ""
    verdict: guard.Verdict | None = None


def check_line(check: conditions.ConditionReport) -> str:
    """One line for the agent: act now, or read these fields first."""
    if check.status == "fully checked":
        return f"Checks: fully checked ({len(check.met)}/{check.checks} met)"
    if check.status == "not fully checked":
        return f"Checks: not fully checked ({len(check.met)}/{check.checks} met), read first: {', '.join(check.to_read)}"
    if check.unknown:
        return "Checks: text only (conditions in words, no machine check)"
    return "Checks: none needed (no conditions)"


def describe(hit: ContextHit, check: conditions.ConditionReport | None = None, at: datetime | None = None) -> str:
    a = hit.assertion
    who = a.trust.stated_by + (f", {a.trust.role}" if a.trust.role else "")
    until = f" until {a.valid_to:%Y-%m-%d %H:%M}" if a.valid_to else ""
    lines = [
        f"[{a.id}] {a.type} · trust {a.trust.level} ({who}) · valid from {a.valid_from:%Y-%m-%d %H:%M}{until} · via {hit.matched_via}",
        f"  {a.summary}",
    ]
    if a.conditions:
        lines.append("  When: " + "; ".join(c.text for c in a.conditions))
    if check is not None:
        lines.append("  " + check_line(check))
    if a.fact and a.fact != a.summary:
        lines.append(f"  Fact: {a.fact}")
    if a.action:
        lines.append(f"  Do: {a.action}")
    if a.avoid:
        lines.append("  Avoid: " + "; ".join(a.avoid))
    if a.conflicts_with:
        lines.append("  Conflicts with: " + ", ".join(a.conflicts_with))
    if (tr := feedback.track_record(a, at)).status != "untested":
        lines.append("  " + tr.line())
    srcs = " | ".join(f"{s.source} {s.file}" + (f" seq {','.join(map(str, s.seq))}" if s.source == "teams" else "") for s in a.sources)
    lines.append(f"  Sources: {srcs}")
    return "\n".join(lines)


def _template(case: Case, hits: list[ContextHit], checks: dict[str, conditions.ConditionReport]) -> str:
    if not hits:
        return f"No applicable human knowledge was found for {case.entity_id}. Follow the standard procedure."
    best = max(hits, key=lambda h: (h.assertion.trust.level == "verified", h.assertion.confidence, len(h.assertion.sources)))
    assertion = best.assertion
    action = assertion.action or assertion.summary
    warning = f" Avoid: {', '.join(assertion.avoid)}." if assertion.avoid else ""
    # What the case says about the chosen rule (docs/evaluation.md sections 3 and 4): facts, not a re-ranking.
    check = checks.get(assertion.id)
    if check is not None and check.status == "not fully checked":
        warning += f" Read first: {', '.join(check.to_read)}."
    if (tr := feedback.track_record(assertion, case.at)).status == "contested":
        warning += f" Contested in the field: worked {tr.worked}/{tr.worked + tr.failed} (failed on {', '.join(tr.failed_on)})."
    return f"{action} [{assertion.id}].{warning}"


AGENT_PROMPT = """You are a network operations assistant. Recommend one concise next step using only the human context given.
Cite every assertion you rely on using its exact id in square brackets, for example [ctx_0001]. Do not cite assertions that do not support the recommendation. Mention a key condition or warning only when it changes what the operator should do. If there is no applicable context, say so and recommend the standard procedure.
If an assertion you rely on has check_status "not fully checked", say which fields (to_read) to read first. If its track_record status is "contested", say it failed in the field.
Answer in 1-2 short sentences and no more than 5 short lines (at most 30 words). No preamble, headings, or repeated observations."""


def cited_assertion_ids(recommendation: str, hits: list[ContextHit]) -> list[str]:
    """Return only assertion citations that were actually retrieved for this run."""
    found = set(re.findall(r"\[(ctx_[0-9]+)\]", recommendation))
    return [h.assertion.id for h in hits if h.assertion.id in found]


def _llm(case: Case, hits: list[ContextHit], checks: dict[str, conditions.ConditionReport]) -> str:
    context = []
    for h in hits:
        item = h.assertion.model_dump(mode="json", exclude={"link_notes", "outcomes"})
        tr = feedback.track_record(h.assertion, case.at)
        item["track_record"] = {"status": tr.status, "worked": tr.worked, "failed": tr.failed, "failed_on": tr.failed_on}
        if (c := checks.get(h.assertion.id)) is not None:
            item |= {"check_status": c.status, "to_read": c.to_read}
        context.append(item)
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
                report.checks[hit.assertion.id] = cr
        report.hits = kept
    report.recommendation = (_llm if use_llm else _template)(case, report.hits, report.checks)
    if use_guard and case.planned_action:
        obs = case.observations if use_conditions else None
        report.verdict = guard.check(store, case.planned_action, case.entity_id, at=case.at, observations=obs)
    return report
