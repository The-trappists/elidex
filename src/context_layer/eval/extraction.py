"""Exchange accuracy: did the extractor keep the right information from each conversation, and only that?

Three levels, against the scenario labels:
- items: right knowledge found (recall), nothing invented (precision), noise threads left empty;
- messages: of the messages it cited as carrying knowledge, how many really did (signal vs. useless chatter);
- linking: for the items it found, the same element, site and class as the label.

Topic slugs written by an LLM rarely match the labels word for word, so an extracted item is matched to a
label by type and scope (shared element, site or class), then by overlap of cited messages.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..link import Inventory
from ..models import ExtractedItem
from .kb import KnowledgeBase, key


def _scope(item: ExtractedItem, inv: Inventory) -> tuple[frozenset, frozenset, str | None]:
    inst = frozenset((inv.resolve_element(r).id if inv.resolve_element(r) else r.lower()) for r in item.scope.instance_ids)
    sites = frozenset((inv.resolve_site(r).id if inv.resolve_site(r) else r.lower()) for r in item.scope.site_ids)
    cls = item.scope.element_class.class_id() if item.scope.element_class else None
    return inst, sites, cls


def _overlap(a: ExtractedItem, b: ExtractedItem, inv: Inventory) -> bool:
    ia, sa, ca = _scope(a, inv)
    ib, sb, cb = _scope(b, inv)
    return bool(ia & ib or sa & sb or (ca and ca == cb))


def _jaccard(a: list[int], b: list[int]) -> float:
    sa, sb = set(a), set(b)
    return len(sa & sb) / len(sa | sb) if sa | sb else 1.0


def match_items(got: list[ExtractedItem], want: list[ExtractedItem], inv: Inventory) -> list[tuple[int, int]]:
    """Greedy one-to-one (got index, want index) pairs: same type, overlapping scope, best cited-message overlap."""
    pairs = []
    for gi, g in enumerate(got):
        for wi, w in enumerate(want):
            if g.type == w.type and (_overlap(g, w, inv) or g.topic == w.topic):
                pairs.append((_jaccard(g.cited_seq, w.cited_seq) + (g.stated_by == w.stated_by), gi, wi))
    used_g, used_w, out = set(), set(), []
    for _, gi, wi in sorted(pairs, reverse=True):
        if gi not in used_g and wi not in used_w:
            used_g.add(gi)
            used_w.add(wi)
            out.append((gi, wi))
    return out


@dataclass
class ThreadScore:
    scenario: str
    expected: int
    extracted: int
    matched: int
    binding_exact: int
    trust_right: int
    msg_tp: int
    msg_fp: int
    msg_fn: int
    missed: list[str] = field(default_factory=list)
    invented: list[str] = field(default_factory=list)
    binding_diffs: list[str] = field(default_factory=list)
    conf_matched: list[float] = field(default_factory=list)  # confidence of items that matched a label
    conf_invented: list[float] = field(default_factory=list)  # confidence of items that matched none


@dataclass
class ExtractionScore:
    threads: list[ThreadScore]
    label_of: dict[tuple[str, str, str], str]  # (thread id, type, extracted topic) -> label key

    def _sum(self, attr: str) -> int:
        return sum(getattr(t, attr) for t in self.threads)

    def summary(self) -> dict:
        exp, ext, m = self._sum("expected"), self._sum("extracted"), self._sum("matched")
        tp, fp, fn = self._sum("msg_tp"), self._sum("msg_fp"), self._sum("msg_fn")
        noise = [t for t in self.threads if t.expected == 0]
        right = [c for t in self.threads for c in t.conf_matched]
        wrong = [c for t in self.threads for c in t.conf_invented]
        return {
            # Is the LLM's self-reported confidence informative? Right items should score higher than invented ones.
            "avg_confidence_right_items": round(sum(right) / len(right), 3) if right else None,
            "avg_confidence_invented_items": round(sum(wrong) / len(wrong), 3) if wrong else None,
            "threads": len(self.threads),
            "item_recall": _ratio(m, exp),
            "item_precision": _ratio(m, ext),
            "message_precision": _ratio(tp, tp + fp),
            "message_recall": _ratio(tp, tp + fn),
            "binding_exact": _ratio(self._sum("binding_exact"), m),
            "trust_right": _ratio(self._sum("trust_right"), m),
            "noise_threads_left_empty": _ratio(sum(t.extracted == 0 for t in noise), len(noise)),
        }


def _ratio(num: int, den: int) -> float | None:
    return round(num / den, 3) if den else None


def score_extraction(kb: KnowledgeBase) -> ExtractionScore:
    inv, threads, label_of = kb.inventory, [], {}
    for run in kb.runs:
        want = list(run.scenario.expected.items) if run.scenario.expected else []
        got = run.extracted
        pairs = match_items(got, want, inv)
        exact = trust = 0
        diffs = []
        for gi, wi in pairs:
            g, w = got[gi], want[wi]
            label_of[(run.thread.id, g.type, g.topic)] = key(w.type, w.topic)
            if _scope(g, inv) == _scope(w, inv):
                exact += 1
            else:
                diffs.append(f"{w.topic}: expected {_fmt(_scope(w, inv))}, got {_fmt(_scope(g, inv))}")
            trust += g.trust_level == w.trust_level
        got_msgs = {s for g in got for s in g.cited_seq}
        want_msgs = {s for w in want for s in w.cited_seq}
        threads.append(ThreadScore(
            scenario=run.scenario.id, expected=len(want), extracted=len(got), matched=len(pairs),
            binding_exact=exact, trust_right=trust,
            msg_tp=len(got_msgs & want_msgs), msg_fp=len(got_msgs - want_msgs), msg_fn=len(want_msgs - got_msgs),
            missed=[want[i].topic for i in range(len(want)) if i not in {wi for _, wi in pairs}],
            invented=[got[i].topic for i in range(len(got)) if i not in {gi for gi, _ in pairs}],
            binding_diffs=diffs,
            conf_matched=[got[gi].confidence for gi, _ in pairs],
            conf_invented=[got[i].confidence for i in range(len(got)) if i not in {gi for gi, _ in pairs}],
        ))
    return ExtractionScore(threads, label_of)


def _fmt(scope: tuple) -> str:
    inst, sites, cls = scope
    return "/".join(filter(None, [",".join(sorted(inst)), ",".join(sorted(sites)), cls or ""])) or "nothing"
