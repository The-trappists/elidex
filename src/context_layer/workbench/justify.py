"""Justification: why an assertion has its trust level and its confidence.

Deterministic. Every sentence comes from something the pipeline recorded (the assertion itself, the job that
created it, the critic and judge verdicts, the outcome ledger, the operator edits). When a record is gone (jobs are
capped in memory) the factor says "not recorded" instead of guessing.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..mvp import feedback
from ..models import ContextAssertion
from .contracts import Justification, JustificationFactor, PipelineJob, VerdictNote

if TYPE_CHECKING:
    from .state import Workbench

QUALIFIER_FACTOR = 0.8  # link.py: class wider than stated
FAILED_FACTOR = 0.7  # outcome.py: one failed application


def _f(label: str, effect: str, detail: str) -> JustificationFactor:
    return JustificationFactor(label=label, effect=effect, detail=detail)  # type: ignore[arg-type]


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def jobs_of(wb: Workbench, assertion_id: str) -> list[PipelineJob]:
    """Jobs that created or touched the assertion, oldest first."""
    return [j for j in wb.jobs.values() if assertion_id in j.assertion_ids]


def people(a: ContextAssertion) -> list[str]:
    """Independent people behind the assertion: the author and the people who backed it."""
    return [a.trust.stated_by, *[p for p in a.trust.confirmed_by if p != a.trust.stated_by]]


def _trust_factors(wb: Workbench, a: ContextAssertion) -> list[JustificationFactor]:
    t, out = a.trust, []
    role = f" ({t.role})" if t.role else ""
    persona = wb.persona_by_name(t.stated_by)
    if persona is not None and persona.role:
        role = f" ({persona.role})"
    level_text = {
        "hunch": "marked as a hunch: the author guessed, nothing was checked",
        "stated": "stated as a fact or a rule by the author, without a field check",
        "verified": "verified: someone confirmed it on the equipment or from a field report",
    }[t.level]
    effect = {"hunch": "limits", "stated": "neutral", "verified": "supports"}[t.level]
    quote = f' Evidence: "{t.evidence}".' if t.evidence else ""
    out.append(_f(f"Level is {t.level}", effect, f"{t.stated_by}{role} {level_text}.{quote}"))
    if t.confirmed_by:
        out.append(_f("Backed by others", "supports", f"Also backed by {', '.join(t.confirmed_by)}."))
    else:
        out.append(_f("Single voice", "limits", f"Only {t.stated_by} said it so far; nobody else backed it."))
    # operator edits
    edits = [e for e in wb.edits.values() if e.assertion_id == a.id and not e.undone]
    if edits:
        trust_edits = [e for e in edits if "trust" in e.after]
        detail = f"{len(edits)} operator edit(s) kept"
        if trust_edits:
            detail += f"; the trust level was set by an operator ({trust_edits[-1].note or 'no note'})"
        out.append(_f("Edited by an operator", "neutral", detail + "."))
    # outcomes
    tr = feedback.track_record(a)
    if tr.worked or tr.failed:
        where = f", failed on {', '.join(tr.failed_on)}" if tr.failed_on else ""
        eff = "limits" if tr.failed else "supports"
        out.append(_f("Track record in the field", eff, f"Applied {tr.worked + tr.failed} time(s): {tr.worked} worked, {tr.failed} failed{where}."))
        human = [o for o in a.outcomes if o.source == "thread" and o.quote]
        if human:
            out.append(_f("Human field report", "supports" if human[-1].worked else "limits", f'“{human[-1].quote}”'))
    else:
        out.append(_f("Never applied yet", "neutral", "No outcome is recorded for this knowledge."))
    # contradictions and lifecycle
    if a.conflicts_with:
        out.append(_f("Contradicted", "limits", f"Disagrees with {', '.join(a.conflicts_with)}; both are kept."))
    if a.closed_by or a.valid_to:
        by = f" by {a.closed_by}" if a.closed_by else ""
        out.append(_f("No longer valid", "limits", f"Closed at {a.valid_to:%Y-%m-%d %H:%M}{by}." if a.valid_to else f"Closed{by}."))
    return out


def _verdict_notes(wb: Workbench, a: ContextAssertion, jobs: list[PipelineJob]) -> tuple[VerdictNote | None, list[VerdictNote], list[PipelineJob]]:
    critic, judge, with_critic = None, [], []
    for j in jobs:
        for v in j.critic:
            if v.item_topic == a.topic:
                critic = VerdictNote(verdict=v.verdict, reason=v.reason)
                with_critic.append(j)
        for v in j.judge:
            if a.id in (v.new_assertion_id, v.other_assertion_id):
                other = v.other_assertion_id if v.new_assertion_id == a.id else v.new_assertion_id
                note = VerdictNote(verdict=v.verdict, reason=v.reason, other_assertion_id=other)
                if note not in judge:
                    judge.append(note)
    return critic, judge, with_critic


def _confidence_factors(
    wb: Workbench, a: ContextAssertion, jobs: list[PipelineJob], critic: VerdictNote | None, judge: list[VerdictNote]
) -> list[JustificationFactor]:
    out: list[JustificationFactor] = []
    item = next((i for j in reversed(jobs) for i in j.items if i.topic == a.topic), None)
    if item is not None:
        out.append(_f("Extractor confidence", "neutral", f"The extraction step gave {_pct(item.confidence)} to this item."))
    else:
        out.append(_f("Extractor confidence", "neutral", "Not recorded: the job that created it is no longer in memory."))
    # critic
    if critic is not None:
        v = next((v for j in reversed(jobs) for v in j.critic if v.item_topic == a.topic), None)
        after = f" Confidence after the critic: {_pct(v.confidence_after)}." if v and v.confidence_after is not None else ""
        effect = {"keep": "supports", "downgrade": "limits", "reject": "limits"}.get(critic.verdict, "neutral")
        out.append(_f(f"Critic: {critic.verdict}", effect, f"{critic.reason or 'no reason given'}{after}"))
    else:
        out.append(_f("Critic", "neutral", "Not recorded: no critic verdict (critic off, scripted items or job gone)."))
    # linker
    for note in a.link_notes:
        low = note.lower()
        if "wider than stated" in low:
            out.append(_f("Scope wider than stated", "limits", f"{note}; confidence multiplied by {QUALIFIER_FACTOR}."))
        else:
            out.append(_f("Linker note", "limits" if "not bound" in low else "neutral", note))
    # binding
    classes = sorted(e for e in a.applies_to if e.startswith("class:"))
    instances = sorted(e for e in a.applies_to if not e.startswith("class:"))
    if classes:
        out.append(_f("Bound to a class", "neutral", f"Applies to {', '.join(classes)}: every equipment that matches, not only the ones named."))
    if instances:
        out.append(_f("Bound to named equipment", "supports", f"Applies to {', '.join(instances)}, named in the conversation."))
    if not a.applies_to:
        out.append(_f("No scope binding", "limits", "It is bound only to where it was observed."))
    # sources
    who = people(a)
    files = sorted({s.file for s in a.sources})
    out.append(_f(
        "Independent sources", "supports" if len(who) > 1 else "limits",
        f"{len(a.sources)} source reference(s) in {len(files)} thread(s) from {len(who)} person(s): {', '.join(who)}.",
    ))
    # judge
    for n in judge:
        eff = {"supports": "supports", "contradicts": "limits", "supersedes": "neutral"}.get(n.verdict, "neutral")
        out.append(_f(f"Judge: {n.verdict} {n.other_assertion_id}", eff, n.reason or "no reason given"))
    if not judge:
        out.append(_f("Judge", "neutral", "Not recorded: no judge verdict for this assertion."))
    # failed outcomes
    tr = feedback.track_record(a)
    if tr.failed:
        out.append(_f("Failed in the field", "limits", f"{tr.failed} failed application(s); each one multiplies confidence by {FAILED_FACTOR}."))
    return out


def justify(wb: Workbench, assertion_id: str) -> Justification:
    """Raises KeyError for an unknown assertion."""
    a = wb.store.assertions[assertion_id]
    jobs = jobs_of(wb, a.id)
    critic, judge, _ = _verdict_notes(wb, a, jobs)
    trust_factors = _trust_factors(wb, a)
    conf_factors = _confidence_factors(wb, a, jobs, critic, judge)
    t = a.trust
    n_people = len(people(a))
    trust_summary = (
        f"Trust is {t.level}: {t.stated_by} stated it"
        + (f" and {n_people - 1} other person(s) backed it" if n_people > 1 else ", nobody else backed it")
        + (f"; {sum(o.worked for o in a.outcomes)} of {len(a.outcomes)} field outcome(s) worked" if a.outcomes else "")
        + "."
    )
    limits = [f.label for f in conf_factors if f.effect == "limits"]
    confidence_summary = f"Confidence is {_pct(a.confidence)}" + (f"; held back by: {', '.join(limits)}." if limits else ".")
    tr = feedback.track_record(a)
    return Justification(
        assertion_id=a.id, trust_level=t.level, trust_summary=trust_summary, trust_factors=trust_factors,
        confidence=a.confidence, confidence_summary=confidence_summary, confidence_factors=conf_factors,
        critic=critic, judge=judge, n_sources=len(a.sources), source_thread_ids=sorted({s.file for s in a.sources}),
        track_record=tr.to_dict() if (tr.worked or tr.failed) else None,
    )
