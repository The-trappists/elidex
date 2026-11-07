"""Field feedback accuracy: when an agent applies knowledge and it does not work, do we learn it?

1. Judgment: for each labelled outcome, does `feedback.judge` say worked / did not work / no verdict, as labelled?
2. Contested flag: after replaying the outcomes, does each retrieval case flag exactly the expected rules as
   "contested" (and no others: a false alarm would hide good advice behind a warning)?
"""

from __future__ import annotations

from ..agent import Case, run_agent
from ..mvp import feedback
from .kb import EvalSpec, KnowledgeBase, key
from .retrieval import label_key


def replay_outcomes(kb: KnowledgeBase, spec: EvalSpec) -> list[dict]:
    """Record every labelled outcome on the rule it is about. Returns one row per outcome."""
    rows = []
    for o in sorted(spec.outcomes, key=lambda o: o.at):
        targets = [a for a in kb.store.assertions.values()
                   if key(a.type, a.topic) == o.rule and any(s.file == o.source for s in a.sources)]
        if not targets:
            rows.append({"id": o.id, "expected": o.expect_worked, "got": "rule not found", "right": False})
            continue
        got = None
        for a in targets:
            recorded = feedback.record(a, kb.store.resolve(o.entity_id), o.at, o.after, case_id=o.id)
            got = recorded.worked if recorded else None
        rows.append({"id": o.id, "expected": o.expect_worked, "got": got, "right": got == o.expect_worked})
    return rows


def score_outcomes(kb: KnowledgeBase, spec: EvalSpec, label_of: dict) -> dict:
    rows = replay_outcomes(kb, spec)
    cases = []
    for c in spec.cases:
        case = Case(id=c.id, title=c.why, entity_id=c.entity_id, at=c.at, description=c.why, observations=c.observations)
        hits = run_agent(kb.store, case, use_conditions=True).hits
        contested = sorted({label_key(h.assertion, label_of) for h in hits
                            if feedback.track_record(h.assertion, c.at).status == "contested"})
        cases.append({"id": c.id, "expected": sorted(c.expect_contested), "got": contested,
                      "right": contested == sorted(c.expect_contested)})
    n_right = sum(r["right"] for r in rows)
    return {
        "judgment_right": round(n_right / len(rows), 3) if rows else None,
        "outcomes": rows,
        "contested_right": round(sum(c["right"] for c in cases) / len(cases), 3) if cases else None,
        "false_alarms": sum(len(set(c["got"]) - set(c["expected"])) for c in cases),
        "contested_cases": [c for c in cases if c["expected"] or c["got"]],
    }
