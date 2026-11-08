"""Retrieval accuracy: when a problem happens on an element, does the agent get the right solution, and only that?

Each labelled case is run through the demo agent (`agent.run_agent`, the same code the demo uses), with and
without condition checks. What comes back is compared, as (type, topic) keys, with the labels:

- expected: must come back (a miss is a wrong answer);
- acceptable: related knowledge, neither required nor counted as noise;
- anything else: noise, i.e. useless information handed to the agent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations

from ..agent import Case, run_agent
from ..models import ContextAssertion
from .kb import EvalSpec, KnowledgeBase, key


@dataclass
class CaseScore:
    id: str
    entity_id: str
    expected: list[str]
    retrieved: list[str]
    found: list[str] = field(default_factory=list)
    missed: list[str] = field(default_factory=list)
    noise: list[str] = field(default_factory=list)

    @property
    def correct(self) -> bool:
        return not self.missed and not self.noise


@dataclass
class RetrievalScore:
    mode: str
    cases: list[CaseScore]

    def summary(self) -> dict:
        n = len(self.cases)
        with_answer = [c for c in self.cases if c.expected]
        without = [c for c in self.cases if not c.expected]
        found = sum(len(c.found) for c in self.cases)
        noise = sum(len(c.noise) for c in self.cases)
        missed = sum(len(c.missed) for c in self.cases)
        return {
            "mode": self.mode,
            "cases": n,
            "accuracy": _ratio(sum(c.correct for c in self.cases), n),
            "solution_found": _ratio(sum(not c.missed for c in with_answer), len(with_answer)),
            "clean_answers": _ratio(sum(not c.noise for c in self.cases), n),
            "correct_silence": _ratio(sum(not c.noise for c in without), len(without)),
            "precision": _ratio(found, found + noise),
            "recall": _ratio(found, found + missed),
            "noise_items": noise,
        }


def _ratio(num: int, den: int) -> float | None:
    return round(num / den, 3) if den else None


def label_key(a: ContextAssertion, label_of: dict[tuple[str, str, str], str]) -> str:
    """The label an assertion stands for; its own key when it matched no label."""
    for src in a.sources:
        if (src.file, a.type, a.topic) in label_of:
            return label_of[(src.file, a.type, a.topic)]
    return key(a.type, a.topic)


def score_retrieval(kb: KnowledgeBase, spec: EvalSpec, label_of: dict, use_conditions: bool,
                    use_relevance: bool = False) -> RetrievalScore:
    """With `use_relevance`, what counts is what the agent acts on: the rules that match the case's problem (all of
    them when none does). The case descriptions here are the labellers' notes, a hard test for relevance."""
    out = []
    for c in spec.cases:
        case = Case(id=c.id, title=c.why, entity_id=c.entity_id, at=c.at, description=c.why, observations=c.observations)
        report = run_agent(kb.store, case, use_conditions=use_conditions, use_relevance=use_relevance)
        got = sorted({label_key(h.assertion, label_of) for h in report.matching()})
        expected, acceptable = set(c.expect), set(c.acceptable)
        out.append(CaseScore(
            id=c.id, entity_id=c.entity_id, expected=sorted(expected), retrieved=got,
            found=sorted(expected & set(got)), missed=sorted(expected - set(got)),
            noise=sorted(set(got) - expected - acceptable),
        ))
    mode = "with conditions" if use_conditions else "plain"
    return RetrievalScore(mode + (" + relevance" if use_relevance else ""), out)


def score_missing_observations(kb: KnowledgeBase, spec: EvalSpec, label_of: dict) -> dict:
    """Edge cases: the agent often knows less than the labelled case. Rerun every case with every subset of its
    observations (all combinations, no sampling) and measure:

    - accuracy and lost solutions by number of missing observations;
    - precision by check status: is "fully checked" knowledge safe to act on, and where is the noise?
    """
    by_missing: dict[int, list[int]] = {}  # missing -> [runs, correct, solution lost]
    by_status: dict[str, list[int]] = {}  # status -> [useful, noise]
    for c in spec.cases:
        fields = list(c.observations)
        expected, ok = set(c.expect), set(c.expect) | set(c.acceptable)
        for k in range(len(fields) + 1):
            for subset in combinations(fields, k):
                obs = {f: c.observations[f] for f in subset}
                case = Case(id=c.id, title=c.why, entity_id=c.entity_id, at=c.at, description=c.why, observations=obs)
                report = run_agent(kb.store, case, use_conditions=True)
                got = set()
                for h in report.hits:
                    label = label_key(h.assertion, label_of)
                    got.add(label)
                    by_status.setdefault(report.checks[h.assertion.id].status, [0, 0])[label not in ok] += 1
                row = by_missing.setdefault(len(fields) - k, [0, 0, 0])
                row[0] += 1
                row[1] += expected <= got and not (got - ok)
                row[2] += bool(expected - got)
    return {
        "by_missing": [{"missing": m, "runs": r, "accuracy": _ratio(ok_, r), "solution_lost": lost}
                       for m, (r, ok_, lost) in sorted(by_missing.items())],
        "by_status": [{"status": s, "items": u + n, "noise": n, "precision": _ratio(u, u + n)}
                      for s, (u, n) in sorted(by_status.items())],
    }
