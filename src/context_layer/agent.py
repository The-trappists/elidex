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
from .mvp import conditions, feedback, guard, relevance
from .mvp.relevance import RelevanceReport
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
    relevance: dict[str, RelevanceReport] = field(default_factory=dict)  # assertion id -> problem match
    recommendation: str = ""

    def matching(self, strict: bool = False) -> list[ContextHit]:
        """Hits whose rule is about the case's problem (all hits when relevance was not assessed). When no rule
        matches, the description did not say what the problem is in words the knowledge base uses, so all hits are
        returned, as without relevance: a lost answer is worse than noise. `strict` returns nothing instead."""
        if not self.relevance:
            return self.hits
        hits = [h for h in self.hits if self.relevance[h.assertion.id].status != "other problem"]
        return hits if hits or strict else self.hits
    verdict: guard.Verdict | None = None


def relevance_fields(report: AgentReport, assertion_id: str) -> dict:
    """The problem match of one hit, as the API, MCP and the LLM agent receive it (empty when not assessed)."""
    r = report.relevance.get(assertion_id)
    if r is None:
        return {}
    return {"problem_match": r.status, "problem_match_score": r.score, "problem_matched": r.matched}


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
Assertions come with problem_match: "matches the problem" ones are about the case's symptom; "other problem" ones are about another symptom of the same element, so rely on them only if nothing matches.
Answer in 1-2 short sentences and no more than 5 short lines (at most 30 words). No preamble, headings, or repeated observations."""


def cited_assertion_ids(recommendation: str, hits: list[ContextHit]) -> list[str]:
    """Return only assertion citations that were actually retrieved for this run."""
    found = set(re.findall(r"\[(ctx_[0-9]+)\]", recommendation))
    return [h.assertion.id for h in hits if h.assertion.id in found]


def _llm(case: Case, hits: list[ContextHit], checks: dict[str, conditions.ConditionReport],
         matches: dict[str, RelevanceReport] | None = None) -> str:
    context = []
    for h in hits:
        item = h.assertion.model_dump(mode="json", exclude={"link_notes", "outcomes"})
        tr = feedback.track_record(h.assertion, case.at)
        item["track_record"] = tr.to_dict()
        if (c := checks.get(h.assertion.id)) is not None:
            item |= {"check_status": c.status, "to_read": c.to_read}
        if matches and (r := matches.get(h.assertion.id)) is not None:
            item |= {"problem_match": r.status, "problem_match_score": r.score, "problem_matched": r.matched}
        context.append(item)
    user = json.dumps({"case": case.model_dump(mode="json"), "human_context": context}, ensure_ascii=False)
    return llm.complete(AGENT_PROMPT, user)


def _case_observations(case: Case) -> dict[str, Any]:
    """Combine explicit observations with facts stated plainly in the case description."""
    text = case.description.lower()
    inferred: dict[str, Any] = {}
    if re.search(r"\b(no|without)\s+(an?\s+)?sfp\s+(was\s+)?(changed|replaced|swapped)", text):
        inferred["sfp_replaced"] = False
    elif re.search(r"\bsfp\s+(was\s+)?(replaced|swapped|changed)\b", text):
        inferred["sfp_replaced"] = True
    if re.search(r"\b(interface|link)\s+(is\s+)?up\b", text):
        inferred["interface_status"] = "UP"
    elif re.search(r"\b(interface|link)\s+(is\s+)?down\b", text):
        inferred["interface_status"] = "DOWN"
    if re.search(r"\b(optics|optical levels?)\s+(are\s+)?normal\b", text):
        inferred["optical_levels"] = "normal"
    elif re.search(r"\b(optics|optical levels?)\s+(are\s+)?low\b", text):
        inferred["optical_levels"] = "low"
    elif re.search(r"\b(optics|optical levels?)\s+(are\s+)?high\b", text):
        inferred["optical_levels"] = "high"
    if re.search(r"\b(counters?|traffic)\s+(remain|stay|stuck)\s+at\s+zero\b|\bzero\s+(traffic\s+)?counters?\b|\bno traffic\b", text):
        inferred["traffic_counters"] = 0
    elif re.search(r"\b(counters?|traffic)\s+(are\s+)?(increasing|moving|flowing)\b|\btraffic counters?\s+(are\s+)?(increasing|moving|flowing)\b", text):
        inferred["traffic_counters"] = 1
    if re.search(r"\balarms?\s+(are\s+)?cleared\b", text):
        inferred["alarms"] = "cleared"
    elif re.search(r"\balarms?\s+(are\s+)?(active|firing)\b", text):
        inferred["alarms"] = "active"
    return {**inferred, **case.observations}


def run_agent(
    store: ContextStore,
    case: Case,
    use_conditions: bool = False,
    use_guard: bool = False,
    use_llm: bool = False,
    use_relevance: bool = False,
    relevance_threshold: float = relevance.DEFAULT_THRESHOLD,
) -> AgentReport:
    """`use_relevance` tags each kept rule with whether it is about the case's problem (mvp/relevance.py). Nothing
    is dropped: rules about another problem stay in `hits`, after the matching ones, and `matching()` lists the
    rules the agent should act on."""
    retrieved = store.get_context(case.entity_id, at=case.at)
    report = AgentReport(case=case, hits=[])
    observations = _case_observations(case) if use_conditions else case.observations
    for hit in retrieved:
        assertion = hit.assertion
        cr = conditions.evaluate(assertion, observations, case.description)
        if use_conditions:
            report.checks[assertion.id] = cr  # also for rules without conditions ("text only", see check_line)
        if not use_conditions or not assertion.conditions:
            report.hits.append(hit)
            continue
        if cr.failed:
            report.skipped.append((hit, f"{assertion.topic}: condition not met: " + "; ".join(cr.failed)))
        else:
            report.hits.append(hit)
    if use_relevance:
        report.relevance = relevance.assess_for(store, case.entity_id, [h.assertion for h in report.hits], case.description,
                                                relevance_threshold)
        report.hits.sort(key=lambda h: report.relevance[h.assertion.id].status == "other problem")  # stable: matches first
    if use_llm:
        report.recommendation = _llm(case, report.hits, report.checks, report.relevance)
    else:
        report.recommendation = _template(case, report.matching(), report.checks)
    if use_guard and case.planned_action:
        report.verdict = guard.check(
            store,
            case.planned_action,
            case.entity_id,
            at=case.at,
            observations=observations if use_conditions else None,
            context_hits=report.hits,
        )
    return report
