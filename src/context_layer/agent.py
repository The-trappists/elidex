"""Demo agent: on a new case, retrieve human context and propose what to do.

Deterministic by default (template); `use_llm=True` lets the LLM phrase the plan from the same context.
"""

import json
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
        return f"No human context for {case.entity_id} at {case.at:%Y-%m-%d}. Follow the standard procedure."
    return f"Human context for {case.entity_id} ({len(hits)}):\n" + "\n".join(
        describe(h, checks.get(h.assertion.id), case.at) for h in hits)


AGENT_PROMPT = """You are a network operations assistant. Propose the next steps for the case, using only the human context given.
Cite assertion ids. If an assertion lists things to avoid, say so. If there is no context, say the standard procedure applies.
If an assertion has check_status "not fully checked", say which fields (to_read) must be read before acting on it.
If an assertion's track_record status is "contested", warn that it failed in the field (say where) before proposing it.
Answer in 3-6 short lines."""


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
