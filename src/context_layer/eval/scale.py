"""Retrieval accuracy at company scale, on the generated dataset (docs/dataset.md, docs/evaluation.md part 3).

The labelled set (part 2) has 26 cases over 23 assertions: it cannot show what happens when one element is covered by
hundreds of rules, or when the chats are a haystack of millions of threads. This evaluation uses the ground truth of
`ctx dataset generate` instead (`ctx dataset eval out/dataset/large`):

1. Knowledge base: every knowledge thread of the dataset, in time order, through the real linker, store and
   lifecycle. The extractor is the ground truth itself (an oracle): this isolates linking, time and retrieval from the
   LLM, which `ctx eval --extractor llm` measures on hand-written chats.
2. Linking: the elements each stored assertion reaches vs. the ground-truth reach.
3. Lifecycle: closures (valid_to), expert conflicts and hunch -> verified, vs. the ground truth.
4. Retrieval: thousands of cases (element, time, problem in words, built from data/eval/scale_problems.json), run
   through five pipelines, from naive RAG over the raw chats to graph + time + conditions + problem relevance.

Each returned item is classed as: relevant (the knowledge for this problem, valid here and now), acceptable (same
problem family, or site access), other problem (valid here, but about another symptom), stale (about this element
but closed, or not said yet, at the case time), wrong scope (does not apply to this element), haystack (a chat with
no knowledge). Accuracy = the right knowledge came back (or nothing, when nothing applies) and no noise.
"""

from __future__ import annotations

import json
import random
import statistics
import time
from array import array
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from .. import config
from ..agent import Case, run_agent
from ..link import Inventory, Linker
from ..models import ExtractedItem, Message, Thread
from ..mvp import relevance
from ..mvp.lifecycle import fix_predates, reconcile
from ..store import ContextStore

PROBLEMS_FILE = config.DATA_DIR / "eval" / "scale_problems.json"
T_END = datetime(2026, 11, 6, 23, 59)  # end of the dataset's history (dataset/world.py T1)
CLASSES = ("relevant", "acceptable", "other problem", "stale", "wrong scope", "haystack")
NOISE = ("other problem", "stale", "wrong scope", "haystack")


# ---------------------------------------------------------------- ground truth


@dataclass
class GroundTruth:
    facts: dict[str, dict]
    reach: dict[str, frozenset[str]]  # fact id -> elements it covers
    el_facts: dict[str, list[str]]  # element -> facts that cover it
    vf: dict[str, datetime]
    vt: dict[str, datetime | None]
    problem: dict[str, str]  # fact id -> problem key ("access" for site access and its changes)
    family: dict[str, str]  # problem key -> family

    def answer(self, element: str, at: datetime, problem: str) -> tuple[set, set, set]:
        """(relevant, acceptable, applicable) fact ids for a case."""
        applicable = {f for f in self.el_facts.get(element, []) if self.vf[f] <= at and (self.vt[f] is None or at < self.vt[f])}
        fam = self.family.get(problem, problem)
        relevant = {f for f in applicable if self.problem[f] == problem}
        acceptable = {f for f in applicable - relevant if self.family.get(self.problem[f], self.problem[f]) == fam or self.problem[f] == "access"}
        return relevant, acceptable, applicable


def load_ground_truth(root: Path, inventory: Inventory, problems: dict) -> GroundTruth:
    facts = {}
    with open(root / "ground_truth" / "facts.jsonl", encoding="utf-8") as fh:
        for line in fh:
            f = json.loads(line)
            facts[f["fact_id"]] = f
    on_site: dict[str, list[str]] = defaultdict(list)
    for el in inventory.elements.values():
        if el.site_id:
            on_site[el.site_id].append(el.id)
    reach, el_facts, vf, vt, problem = {}, defaultdict(list), {}, {}, {}
    for fid, f in facts.items():
        ids = f["reach"]["entity_ids"]
        els = frozenset(on_site.get(ids[0], [])) if f["reach"]["kind"] == "site" else frozenset(ids)
        reach[fid] = els
        for e in els:
            el_facts[e].append(fid)
        vf[fid] = datetime.fromisoformat(f["valid_from"])
        vt[fid] = datetime.fromisoformat(f["valid_to"]) if f["valid_to"] else None
        problem[fid] = "access" if f["family"].startswith("site_access") else f["item"]["topic"]
    family = {k: v.get("family", k) for k, v in problems.items()}
    return GroundTruth(facts, reach, dict(el_facts), vf, vt, problem, family)


# ---------------------------------------------------------------- reading the shards


def _thread(d: dict) -> Thread:
    msgs = [Message(thread_id=d["id"], source=d["source"], seq=m["seq"], author=m["author"], role=m.get("role"),
                    sent_at=datetime.fromisoformat(m["sent_at"]), text=m["text"]) for m in d["messages"]]
    return Thread(id=d["id"], source=d["source"], subject=d.get("subject"), messages=msgs)


def thread_text(d: dict) -> str:
    """A thread as one document, with a contextual prefix (channel, subject), as contextual retrieval does."""
    return " ".join([d["source"], d.get("subject") or "", *(m["text"] for m in d["messages"])])


def scan(root: Path, on_knowledge, on_haystack=None, haystack_every: int = 10, log=print) -> dict:
    """Stream every shard once. Knowledge threads go to `on_knowledge(thread_dict)`; one in `haystack_every` of the
    other threads (a systematic sample) to `on_haystack(thread_dict)`. Only those lines are parsed."""
    stats = Counter()
    shards = sorted((root / "conversations").glob("threads-*.jsonl"))
    for i, shard in enumerate(shards, 1):
        with open(shard, encoding="utf-8") as fh:
            for line in fh:
                stats["threads"] += 1
                if "/k" in line[7:32]:  # knowledge thread ids look like "slack/2025-02/k000021-1"
                    stats["knowledge_threads"] += 1
                    on_knowledge(json.loads(line))
                elif on_haystack and stats["threads"] % haystack_every == 0:
                    stats["haystack_sampled"] += 1
                    on_haystack(json.loads(line))
        log(f"  scanned {shard.name} ({i}/{len(shards)}), {stats['threads']:,} threads")
    return dict(stats)


# ---------------------------------------------------------------- knowledge base (oracle extractor)


@dataclass
class ScaleKB:
    store: ContextStore
    inventory: Inventory
    a2f: dict[str, set[str]]  # assertion id -> ground-truth facts it stands for
    f2a: dict[str, set[str]]  # fact id -> assertions
    link: dict
    lifecycle: dict
    build_s: float


def oracle_items(d: dict, gt: GroundTruth, sources_of: dict) -> list[tuple[ExtractedItem, str]]:
    """What a perfect extractor returns for this thread: the ground-truth items it states. An echo ("as X said...")
    names no element, so a perfect extractor cannot scope it either: skipped. For hunch -> verified, the first thread
    gives the asker's guess and the second the expert's confirmation (the fact keeps the final, verified form)."""
    out = []
    for fid, k in sources_of.get(d["id"], []):
        f = gt.facts[fid]
        item = dict(f["item"])
        if f.get("trust_history"):
            if k == 0:
                seq = item["cited_seq"][0]
                item.update(trust_level="hunch", stated_by=d["messages"][seq - 1]["author"], confidence=0.5)
            elif k == 1:
                item.update(cited_seq=f["sources"][1]["seq"])
            else:
                continue
        elif k > 0:
            continue
        out.append((ExtractedItem.model_validate(item), fid))
    return out


def build_kb(root: Path, gt: GroundTruth, inventory: Inventory, threads: list[dict], log=print) -> ScaleKB:
    t0 = time.perf_counter()
    sources_of: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for fid, f in gt.facts.items():
        for k, s in enumerate(f["sources"]):
            sources_of[s["thread_id"]].append((fid, k))
    store, linker = ContextStore(inventory), Linker(inventory)
    a2f, f2a = defaultdict(set), defaultdict(set)
    abstained, notes = Counter(), Counter()
    linked_first = set()
    events = Counter()
    for n, d in enumerate(sorted(threads, key=lambda d: d["messages"][0]["sent_at"]), 1):
        thread = _thread(d)
        for item, fid in oracle_items(d, gt, sources_of):
            res = linker.link(item, thread)
            for note in res.notes:
                notes[note.split("'")[0].split(" SITE-")[0].split(" TRN-")[0].strip()[:60]] += 1
            if res.assertion is None:
                abstained[res.notes[-1].split(": ", 1)[-1][:70] if res.notes else "?"] += 1
                continue
            for cls in res.classes:
                store.add_class(cls)
            stored, is_new = store.add_assertion(res.assertion)
            a2f[stored.id].add(fid)
            f2a[fid].add(stored.id)
            if gt.facts[fid]["sources"][0]["thread_id"] == d["id"]:
                linked_first.add(fid)
            if is_new:
                for e in reconcile(store, stored):
                    events["closed" if " closed " in e else "kept open" if "kept open" in e else "conflict" if "disagree" in e else "other"] += 1
            else:
                events["merged"] += 1
        if n % 500 == 0:
            log(f"  {n:,}/{len(threads):,} knowledge threads, {len(store.assertions):,} assertions")
    kb = ScaleKB(store, inventory, dict(a2f), dict(f2a), {}, {}, 0.0)
    kb.link = score_linking(kb, gt, linked_first, abstained, notes)
    kb.lifecycle = score_lifecycle(kb, gt) | {"events": dict(events)}
    kb.build_s = round(time.perf_counter() - t0, 1)
    return kb


def score_linking(kb: ScaleKB, gt: GroundTruth, linked: set, abstained: Counter, notes: Counter) -> dict:
    """Element-level reach of each fact's assertion vs. the ground truth."""
    exact = over = under = 0
    tp = fp = fn = 0
    by_kind = defaultdict(lambda: [0, 0])  # kind -> [facts, exact]
    for fid in linked:
        want = gt.reach[fid]
        got = set().union(*(kb.store.reach(kb.store.assertions[a]) for a in kb.f2a[fid] if a in kb.store.assertions))
        got = {e for e in got if e in kb.inventory.elements}
        kind = gt.facts[fid]["reach"]["kind"]
        by_kind[kind][0] += 1
        if got == want:
            exact += 1
            by_kind[kind][1] += 1
        over += bool(got - want)
        under += bool(want - got)
        tp, fp, fn = tp + len(got & want), fp + len(got - want), fn + len(want - got)
    n = len(gt.facts)
    return {
        "facts": n, "linked": len(linked), "abstained": n - len(linked), "abstain_reasons": dict(abstained.most_common(8)),
        "reach_exact": _r(exact, len(linked)), "over_reach_facts": over, "under_reach_facts": under,
        "element_precision": _r(tp, tp + fp), "element_recall": _r(tp, tp + fn),
        "by_kind": {k: {"facts": v[0], "exact": _r(v[1], v[0])} for k, v in sorted(by_kind.items())},
        "notes": dict(notes.most_common(10)),
    }


def score_lifecycle(kb: ScaleKB, gt: GroundTruth) -> dict:
    st = kb.store
    closed_ok = closed_missed = false_closed = 0
    for fid, f in gt.facts.items():
        if f["family"] in ("firmware_fix", "site_access_change"):
            continue
        aids = [a for a in kb.f2a.get(fid, ()) if a in st.assertions]
        if not aids:
            continue
        closed = [st.assertions[a].valid_to for a in aids]
        if f["valid_to"]:
            ok = all(c is not None and abs((c - gt.vt[fid]).total_seconds()) < 60 for c in closed)
            closed_ok += ok
            closed_missed += not ok
        else:
            false_closed += any(c is not None for c in closed)
    pairs = {frozenset((fid, o)) for fid, f in gt.facts.items() for o in f["conflicts_with"]}
    found = 0
    for p in pairs:
        f1, f2 = tuple(p)
        a1, a2 = kb.f2a.get(f1, set()), kb.f2a.get(f2, set())
        found += any(b in st.assertions[a].conflicts_with for a in a1 if a in st.assertions for b in a2)
    flagged = {frozenset((a.id, b)) for a in st.assertions.values() for b in a.conflicts_with}
    false_conf = 0
    for p in flagged:
        x, y = tuple(p)
        fx, fy = kb.a2f.get(x, set()), kb.a2f.get(y, set())
        false_conf += not any(frozenset((u, v)) in pairs for u in fx for v in fy)
    hv = [fid for fid, f in gt.facts.items() if f.get("trust_history")]
    merged = sum(1 for fid in hv if len(kb.f2a.get(fid, ())) == 1)
    verified = sum(1 for fid in hv if kb.f2a.get(fid) and all(st.assertions[a].trust.level == "verified" for a in kb.f2a[fid]))
    closable = closed_ok + closed_missed
    # Assertion level: repeated reports of one bug merge into one assertion, which must close at the first fix
    # (the ground truth gives each repeated report its own, independent fix date).
    a_exp = a_ok = a_false = blind = 0
    for aid, fids in kb.a2f.items():
        a = st.assertions.get(aid)
        if a is None or a.type == "invalidation":
            continue
        ends = [gt.vt[f] for f in fids if gt.vt[f] is not None]
        if ends:
            a_exp += 1
            a_ok += a.valid_to is not None and abs((a.valid_to - min(ends)).total_seconds()) < 60
        elif a.valid_to is not None:
            a_false += 1
        if a.closed_by and a.closed_by in st.assertions and fix_predates(a, st.assertions[a.closed_by]):
            blind += 1
    return {
        "closures_expected": closable, "closures_found": closed_ok, "closure_recall": _r(closed_ok, closable),
        "false_closures": false_closed,
        "assertion_closures_expected": a_exp, "assertion_closures_right": a_ok, "assertion_false_closures": a_false,
        "closed_by_older_release": blind,
        "conflict_pairs_expected": len(pairs), "conflict_pairs_found": found, "conflict_recall": _r(found, len(pairs)),
        "false_conflict_pairs": false_conf,
        "hunch_to_verified": len(hv), "hv_one_assertion": merged, "hv_all_verified": verified,
    }


# ---------------------------------------------------------------- cases


@dataclass
class ScaleCase:
    id: str
    kind: str
    element: str
    at: datetime
    problem: str
    observations: dict = field(default_factory=dict)

    def description(self, problems: dict, inventory: Inventory, split: str) -> str:
        el = inventory.elements.get(self.element)
        site = inventory.sites.get(el.site_id).name if el and el.site_id in inventory.sites else "the site"
        return problems[self.problem][split].format(el=self.element, site=site)


def _when(rng: random.Random, lo: datetime, hi: datetime) -> datetime | None:
    if hi <= lo:
        return None
    return lo + timedelta(seconds=rng.randrange(int((hi - lo).total_seconds())))


def make_cases(gt: GroundTruth, inventory: Inventory, problems: dict, seed: int = 7, nothing_known: int = 1500) -> list[ScaleCase]:
    """Cases built from the ground truth, one family of probes per fact:

    - similar case: another element the knowledge covers (the brief's step 3), at a time it is valid;
    - near miss: same model, outside the class's install years (over-linking probe);
    - other unit, same site: an instance rule must not spread to the neighbour;
    - after closure: the knowledge was closed (firmware fix, key moved) before the case;
    - before it was said: the case happens before anyone stated it;
    - nothing known: random elements and problems.
    """
    rng = random.Random(seed)
    by_model, by_site = defaultdict(list), defaultdict(list)
    for el in sorted(inventory.elements.values(), key=lambda e: e.id):
        by_model[el.model].append(el)
        if el.site_id:
            by_site[el.site_id].append(el)
    pool = defaultdict(list)
    for key, p in problems.items():
        for t in p["types"]:
            pool[t].append(key)
    cases: list[ScaleCase] = []

    def add(kind, el, at, prob):
        if at is not None and prob in problems:
            cases.append(ScaleCase(f"c{len(cases):05d}", kind, el, at, prob, dict(problems[prob]["observations"])))

    t_start = datetime(2025, 1, 6)
    for fid in sorted(gt.facts):
        f = gt.facts[fid]
        if f["family"] in ("firmware_fix", "site_access_change"):
            continue  # an invalidation is an answer, not a problem
        prob, vf, vt = gt.problem[fid], gt.vf[fid], gt.vt[fid]
        els = sorted(gt.reach[fid])
        if not els:
            continue
        observed = set(f["item"]["scope"]["instance_ids"])
        e = rng.choice([x for x in els if x not in observed] or els)
        kind = {"class": "similar case, same class", "instance": "same unit", "site": "dispatch to the site"}[f["reach"]["kind"]]
        add(kind, e, _when(rng, vf + timedelta(hours=1), min(vt or T_END, T_END)), prob)
        if f["reach"]["kind"] == "class":
            model = f["item"]["scope"]["element_class"]["model"]
            outside = [x.id for x in by_model[model] if x.id not in gt.reach[fid]]
            if outside:
                add("near miss, same model", rng.choice(outside), _when(rng, vf + timedelta(hours=1), min(vt or T_END, T_END)), prob)
        if f["reach"]["kind"] == "instance":
            target = inventory.elements.get(els[0])
            nb = [x.id for x in by_site.get(target.site_id, []) if x.id != target.id] if target else []
            if nb:
                add("other unit, same site", rng.choice(nb), _when(rng, vf + timedelta(hours=1), min(vt or T_END, T_END)), prob)
        if vt:
            add("after closure", e, _when(rng, vt + timedelta(minutes=5), min(vt + timedelta(days=90), T_END)), prob)
        add("before it was said", e, _when(rng, max(t_start, vf - timedelta(days=90)), vf - timedelta(minutes=5)), prob)
    els = sorted(inventory.elements)
    for _ in range(nothing_known):
        el = inventory.elements[rng.choice(els)]
        probs = pool.get(el.type, []) + pool.get("*", [])
        if probs:
            add("random element", el.id, _when(rng, t_start, T_END), rng.choice(probs))
    return cases


# ---------------------------------------------------------------- naive RAG over the raw chats


class ThreadIndex:
    """BM25 (k1 1.2, b 0.75) over whole threads with their contextual prefix, the same domain thesaurus as the
    relevance step, element ids kept as tokens. A strong text baseline, not a straw man."""

    def __init__(self):
        self.vocab: dict[str, int] = {}
        self.docs: list[list[int]] = []
        self.tfs: list[array] = []
        self.doc_len = array("i")
        self.doc_time = array("q")
        self.doc_ids: list[str] = []

    def add(self, d: dict) -> None:
        counts = Counter(relevance.terms(thread_text(d), keep_ids=True))
        n = len(self.doc_ids)
        for term, tf in counts.items():
            tid = self.vocab.setdefault(term, len(self.vocab))
            if tid == len(self.docs):
                self.docs.append(array("i"))
                self.tfs.append(array("H"))
            self.docs[tid].append(n)
            self.tfs[tid].append(min(tf, 65535))
        self.doc_len.append(sum(counts.values()))
        self.doc_time.append(int(datetime.fromisoformat(d["messages"][0]["sent_at"]).timestamp()))
        self.doc_ids.append(d["id"])

    def finalize(self) -> None:
        import numpy as np

        self.np = np
        self.N = len(self.doc_ids)
        self.dl = np.frombuffer(self.doc_len, dtype=np.int32).astype(np.float32)
        self.avgdl = float(self.dl.mean()) if self.N else 1.0
        self.times = np.frombuffer(self.doc_time, dtype=np.int64)
        self.p_docs = [np.frombuffer(a, dtype=np.int32) for a in self.docs]
        self.p_tfs = [np.frombuffer(a, dtype=np.uint16).astype(np.float32) for a in self.tfs]
        self.idf = [float(np.log(1 + (self.N - len(a) + 0.5) / (len(a) + 0.5))) for a in self.docs]

    def search(self, query: str, before: datetime, k: int = 5) -> list[str]:
        np = self.np
        scores = np.zeros(self.N, dtype=np.float32)
        for term in set(relevance.terms(query, keep_ids=True)):
            tid = self.vocab.get(term)
            if tid is None:
                continue
            docs, tf = self.p_docs[tid], self.p_tfs[tid]
            norm = 1.2 * (0.25 + 0.75 * self.dl[docs] / self.avgdl)
            scores[docs] += self.idf[tid] * tf * 2.2 / (tf + norm)
        scores[self.times >= int(before.timestamp())] = 0
        top = np.argpartition(-scores, min(k, self.N - 1))[:k]
        top = top[np.argsort(-scores[top])]
        return [self.doc_ids[i] for i in top if scores[i] > 0]


# ---------------------------------------------------------------- pipelines and scoring


def _r(num: float, den: float) -> float | None:
    return round(num / den, 4) if den else None


def _ms(values: list[float]) -> dict:
    if not values:
        return {}
    v = sorted(values)
    return {"p50_ms": round(statistics.median(v) * 1000, 2), "p95_ms": round(v[max(0, int(len(v) * 0.95) - 1)] * 1000, 2)}


def classify(fids: set[str] | None, element: str, rel: set, acc: set, app: set, gt: GroundTruth) -> str:
    if not fids:
        return "haystack"
    if fids & rel:
        return "relevant"
    if fids & acc:
        return "acceptable"
    if fids & app:
        return "other problem"
    if any(element in gt.reach[f] for f in fids):
        return "stale"
    return "wrong scope"


def _advice(a) -> tuple:
    return (a.topic, " ".join((a.action or a.fact or a.summary or "").lower().split()))


class Pipelines:
    """Each pipeline returns what the agent is told to act on, as a list of (fact ids or None, advice key)."""

    def __init__(self, kb: ScaleKB, problems: dict, split: str, threshold: float, threads: ThreadIndex | None,
                 thread_facts: dict[str, set[str]]):
        self.kb, self.problems, self.split, self.threshold = kb, problems, split, threshold
        self.threads, self.thread_facts = threads, thread_facts
        self.index = relevance.index_for(kb.store)
        self.valid_list = list(kb.store.assertions.values())

    def _items(self, assertions) -> list[tuple]:
        return [(self.kb.a2f.get(a.id), _advice(a)) for a in assertions]

    def case(self, c: ScaleCase) -> Case:
        desc = c.description(self.problems, self.kb.inventory, self.split)
        return Case(id=c.id, title=c.kind, entity_id=c.element, at=c.at, description=desc, observations=c.observations)

    def graph_time(self, c: ScaleCase):
        return self._items(h.assertion for h in self.kb.store.get_context(c.element, at=c.at))

    def conditions(self, c: ScaleCase):
        return self._items(h.assertion for h in run_agent(self.kb.store, self.case(c), use_conditions=True).hits)

    def relevance(self, c: ScaleCase, strict: bool = True):
        rep = run_agent(self.kb.store, self.case(c), use_conditions=True, use_relevance=True, relevance_threshold=self.threshold)
        return self._items(h.assertion for h in rep.matching(strict=strict))

    def relevance_fallback(self, c: ScaleCase):
        return self.relevance(c, strict=False)

    def knowledge_rag(self, c: ScaleCase, k: int = 5):
        """Top-k extracted rules by problem match over the whole knowledge base, valid at t, no graph scope: a vector
        store of perfectly extracted knowledge."""
        el = self.kb.inventory.elements.get(c.element)
        site = self.kb.inventory.sites.get(el.site_id) if el and el.site_id else None
        q = self.index.problem_concepts(self.case(c).description, [site.name] if site else [])
        scored =[(self.index.score(a, q)[0], a.id, a) for a in self.valid_list if a.is_valid_at(c.at)] if q else []
        scored.sort(key=lambda x: (-x[0], x[1]))
        return self._items(a for s, _, a in scored[:k] if s > 0)

    def naive_rag(self, c: ScaleCase, k: int = 5):
        hits = self.threads.search(self.case(c).description, before=c.at, k=k)
        return [(self.thread_facts.get(t), ("thread", t)) for t in hits]


def run_pipeline(name: str, fn, cases: list[ScaleCase], gt: GroundTruth) -> dict:
    agg = Counter()
    per_kind: dict[str, Counter] = defaultdict(Counter)
    sizes, advices, lat = [], [], []
    examples = []
    for c in cases:
        rel, acc, app = gt.answer(c.element, c.at, c.problem)
        t = time.perf_counter()
        items = fn(c)
        lat.append(time.perf_counter() - t)
        classes = Counter(classify(f, c.element, rel, acc, app, gt) for f, _ in items)
        got = set().union(*(f for f, _ in items if f)) if items else set()
        found = bool(rel & got)
        noise = sum(classes[k] for k in NOISE)
        correct = (found if rel else True) and noise == 0
        sizes.append(len(items))
        advices.append(len({adv for f, adv in items if f and f & (rel | acc)}))
        for k_, row in (("all", agg), (c.kind, per_kind[c.kind])):
            row["cases"] += 1
            row["correct"] += correct
            row["with_answer"] += bool(rel)
            row["found"] += found
            row["full_recall"] += bool(rel) and rel <= got
            row["silent_ok"] += (not rel) and noise == 0
            row["items"] += len(items)
            row["useful"] += classes["relevant"] + classes["acceptable"]
            for cl in CLASSES:
                row[cl] += classes[cl]
        if not correct and len(examples) < 6:
            examples.append({"case": c.id, "kind": c.kind, "element": c.element, "at": c.at.isoformat(timespec="minutes"),
                             "problem": c.problem, "expected": sorted(rel)[:5], "classes": dict(classes)})

    def summary(row: Counter) -> dict:
        n, wa = row["cases"], row["with_answer"]
        return {
            "cases": n, "accuracy": _r(row["correct"], n), "solution_found": _r(row["found"], wa),
            "full_recall": _r(row["full_recall"], wa), "correct_silence": _r(row["silent_ok"], n - wa),
            "precision": _r(row["useful"], row["items"]), "items_per_case": _r(row["items"], n),
            **{f"noise_{k.replace(' ', '_')}": row[k] for k in NOISE},
        }

    s = sorted(sizes)
    return {
        "pipeline": name, **summary(agg),
        "items_p50": s[len(s) // 2] if s else 0, "items_p95": s[max(0, int(len(s) * 0.95) - 1)] if s else 0,
        "distinct_advices_p50": statistics.median(advices) if advices else 0,
        **_ms(lat), "by_kind": {k: summary(v) for k, v in sorted(per_kind.items())}, "wrong_examples": examples,
    }


# ---------------------------------------------------------------- driver


def run_scale_eval(root: Path, split: str = "test", haystack_every: int = 10, naive_cases: int = 2000,
                   threshold: float | None = None, seed: int = 7, log=print) -> dict:
    problems = json.loads(PROBLEMS_FILE.read_text(encoding="utf-8"))["problems"]
    t0 = time.perf_counter()
    inventory = Inventory.load(root / "network")
    gt = load_ground_truth(root, inventory, problems)
    log(f"inventory {len(inventory.elements):,} elements, {len(inventory.sites):,} sites; {len(gt.facts):,} facts")

    knowledge: list[dict] = []
    threads = ThreadIndex() if naive_cases else None
    log("scanning the conversations (knowledge threads + haystack sample for the naive RAG baseline)")
    scan_stats = scan(root, lambda d: (knowledge.append(d), threads.add(d) if threads else None),
                      threads.add if threads else None, haystack_every, log)
    if threads:
        threads.finalize()
    log(f"building the knowledge base from {len(knowledge):,} knowledge threads")
    kb = build_kb(root, gt, inventory, knowledge, log)
    log(f"  {len(kb.store.assertions):,} assertions in {kb.build_s} s; linking {kb.link['reach_exact']}, lifecycle {kb.lifecycle}")

    cases = make_cases(gt, inventory, problems, seed)
    thread_facts: dict[str, set[str]] = defaultdict(set)
    for fid, f in gt.facts.items():
        for s in f["sources"]:
            thread_facts[s["thread_id"]].add(fid)
    log(f"{len(cases):,} cases ({dict(Counter(c.kind for c in cases))})")

    # Problem-match threshold: chosen on the dev wording, reported on the test wording.
    sweep = []
    if threshold is None:
        dev = Pipelines(kb, problems, "dev", 0.5, None, thread_facts)
        sample = random.Random(seed).sample(cases, min(3000, len(cases)))
        for th in (0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7):
            dev.threshold = th
            r = run_pipeline(f"relevance {th}", dev.relevance, sample, gt)
            sweep.append({"threshold": th, "accuracy": r["accuracy"], "solution_found": r["solution_found"], "precision": r["precision"]})
            log(f"  dev threshold {th}: accuracy {r['accuracy']}, solution found {r['solution_found']}, precision {r['precision']}")
        # A lost answer is worse than noise (docs/evaluation.md, part 2 section 3): the most accurate threshold that
        # keeps at least 97% of the solutions, else the one that keeps the most.
        keeps = [s for s in sweep if (s["solution_found"] or 0) >= 0.97]
        threshold = (max(keeps, key=lambda x: x["accuracy"] or 0) if keeps else max(sweep, key=lambda x: x["solution_found"] or 0))["threshold"]

    p = Pipelines(kb, problems, split, threshold, threads, thread_facts)
    rng = random.Random(seed + 1)
    naive_sample = rng.sample(cases, min(naive_cases, len(cases))) if threads else []
    results = []
    plan = [("naive RAG over raw chats (BM25, top 5)", p.naive_rag, naive_sample),
            ("RAG over extracted knowledge, no graph (top 5)", p.knowledge_rag, cases),
            ("graph scope + time (today, plain)", p.graph_time, cases),
            ("+ condition checks (today, with conditions)", p.conditions, cases),
            ("+ problem relevance, all rules when none matches (new, default)", p.relevance_fallback, cases),
            ("+ problem relevance, strict (new)", p.relevance, cases)]
    for name, fn, cs in plan:
        if not cs:
            continue
        log(f"pipeline: {name} on {len(cs):,} cases")
        results.append(run_pipeline(name, fn, cs, gt))
        r = results[-1]
        log(f"  accuracy {r['accuracy']}, solution found {r['solution_found']}, precision {r['precision']}, items/case {r['items_per_case']}")
    # The same pipelines on the naive sample, so the first row compares like with like.
    paired = [run_pipeline(name, fn, naive_sample, gt) for name, fn, _ in plan[1:]] if naive_sample else []
    return {
        "run_at": datetime.now().isoformat(timespec="seconds"), "dataset": str(root), "split": split, "threshold": threshold,
        "threshold_sweep_dev": sweep, "scan": scan_stats, "haystack_every": haystack_every,
        "haystack_threads": threads.N if threads else 0,
        "knowledge_base": {"knowledge_threads": len(knowledge), "assertions": len(kb.store.assertions),
                           "classes": len(kb.store.classes), "build_s": kb.build_s},
        "linking": kb.link, "lifecycle": kb.lifecycle, "cases": len(cases),
        "case_kinds": dict(Counter(c.kind for c in cases)), "retrieval": results, "naive_sample_paired": paired,
        "total_s": round(time.perf_counter() - t0, 1),
    }


def _pct(v) -> str:
    return "n/a" if v is None else f"{v * 100:.1f}%"


def render(r: dict) -> str:
    lk, lc = r["linking"], r["lifecycle"]
    sc = r["scan"]
    lines = [
        f"# Retrieval accuracy at company scale ({r['split']} wording, {r['run_at']})",
        "",
        f"Dataset `{r['dataset']}`: {sc['threads']:,} threads scanned, {r['knowledge_base']['knowledge_threads']:,} carry knowledge "
        f"({sc['knowledge_threads'] / sc['threads'] * 100:.2f}%). Knowledge base: {r['knowledge_base']['assertions']:,} assertions, "
        f"{r['knowledge_base']['classes']:,} classes, built in {r['knowledge_base']['build_s']} s through the real linker, store and lifecycle "
        "(ground truth as the extractor). Problem-match threshold "
        f"{r['threshold']} (chosen on the dev wording). Total run {r['total_s']} s.",
        "",
        f"## Retrieval: {r['cases']:,} cases",
        "",
        "| Pipeline | Cases | Accuracy | Solution found | Correct silence | Precision | Items per case (p50 / p95) | Other problem | Stale | Wrong scope | Haystack | Latency p50 / p95 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for x in r["retrieval"]:
        lines.append(f"| {x['pipeline']} | {x['cases']:,} | **{_pct(x['accuracy'])}** | {_pct(x['solution_found'])} | {_pct(x['correct_silence'])} | "
                     f"{_pct(x['precision'])} | {x['items_p50']} / {x['items_p95']} | {x['noise_other_problem']:,} | {x['noise_stale']:,} | "
                     f"{x['noise_wrong_scope']:,} | {x['noise_haystack']:,} | {x.get('p50_ms', '')} / {x.get('p95_ms', '')} ms |")
    if r["naive_sample_paired"]:
        lines += ["", f"Same pipelines on the {r['naive_sample_paired'][0]['cases']:,} cases of the naive-RAG sample (like with like):", "",
                  "| Pipeline | Accuracy | Solution found | Precision | Stale | Wrong scope |", "| --- | --- | --- | --- | --- | --- |"]
        first = r["retrieval"][0]
        lines.append(f"| {first['pipeline']} | {_pct(first['accuracy'])} | {_pct(first['solution_found'])} | {_pct(first['precision'])} | {first['noise_stale']:,} | {first['noise_wrong_scope']:,} |")
        for x in r["naive_sample_paired"]:
            lines.append(f"| {x['pipeline']} | {_pct(x['accuracy'])} | {_pct(x['solution_found'])} | {_pct(x['precision'])} | {x['noise_stale']:,} | {x['noise_wrong_scope']:,} |")
    best = r["retrieval"][-1]
    safe = next((x for x in r["retrieval"] if "default" in x["pipeline"]), best)
    lines += ["", "Accuracy by kind of case:", "",
              "| Kind | Cases | Graph + time + conditions (today) | Relevance, default | Relevance, strict | Solution found (strict) |",
              "| --- | --- | --- | --- | --- | --- |"]
    base = next(x for x in r["retrieval"] if x["pipeline"].startswith("+ condition"))
    for kind, v in best["by_kind"].items():
        b, s = base["by_kind"].get(kind, {}), safe["by_kind"].get(kind, {})
        lines.append(f"| {kind} | {v['cases']:,} | {_pct(b.get('accuracy'))} | {_pct(s.get('accuracy'))} | {_pct(v['accuracy'])} | {_pct(v['solution_found'])} |")
    if r["threshold_sweep_dev"]:
        lines += ["", "Threshold sweep on the dev wording (3,000 cases):", "", "| Threshold | Accuracy | Solution found | Precision |", "| --- | --- | --- | --- |"]
        lines += [f"| {s['threshold']} | {_pct(s['accuracy'])} | {_pct(s['solution_found'])} | {_pct(s['precision'])} |" for s in r["threshold_sweep_dev"]]
    lines += [
        "", "## Linking (right entities)", "",
        f"{lk['linked']:,} of {lk['facts']:,} facts linked, {lk['abstained']:,} abstained. Reach exact: **{_pct(lk['reach_exact'])}**; "
        f"element precision {_pct(lk['element_precision'])}, recall {_pct(lk['element_recall'])}; over-reach {lk['over_reach_facts']} facts, "
        f"under-reach {lk['under_reach_facts']}.", "",
        "| Kind | Facts | Reach exact |", "| --- | --- | --- |",
        *(f"| {k} | {v['facts']:,} | {_pct(v['exact'])} |" for k, v in lk["by_kind"].items()),
    ]
    if lk["abstain_reasons"]:
        lines += ["", "Abstained because: " + "; ".join(f"{k} ({v})" for k, v in lk["abstain_reasons"].items())]
    lines += [
        "", "## Lifecycle (right time, right trust)", "",
        "| Measure | Expected | Found | Wrong |", "| --- | --- | --- | --- |",
        f"| Closures per ground-truth fact (firmware fix, key moved) | {lc['closures_expected']} | {lc['closures_found']} ({_pct(lc['closure_recall'])}) | {lc['false_closures']} closed that should stay open |",
        f"| Closures per assertion (repeated reports merged, closed at the first fix) | {lc['assertion_closures_expected']} | {lc['assertion_closures_right']} | {lc['assertion_false_closures']} closed that should stay open; {lc['closed_by_older_release']} closed by a release not newer than their firmware |",
        f"| Expert disagreements flagged | {lc['conflict_pairs_expected']} | {lc['conflict_pairs_found']} ({_pct(lc['conflict_recall'])}) | {lc['false_conflict_pairs']} false pairs |",
        f"| Hunch later verified: one assertion | {lc['hunch_to_verified']} | {lc['hv_one_assertion']} | {lc['hunch_to_verified'] - lc['hv_one_assertion']} split in two |",
        f"| Hunch later verified: trust is verified | {lc['hunch_to_verified']} | {lc['hv_all_verified']} | |",
    ]
    return "\n".join(lines) + "\n"
