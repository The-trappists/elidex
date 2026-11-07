"""Dedupe: keep the store small by folding a near-duplicate into the older, valid assertion.

A new assertion is a near-duplicate of an existing one when ALL of this holds (a wrong merge is worse than none):

- same type (never an invalidation), both still valid (no valid_to), neither conflicts with the other;
- same scope: the same equipment/site/class the advice applies to (or the same reach), and the same trigger;
- no contradiction: the same `avoid` list, the same condition checks, the same numbers (5 min is not 15 min),
  and neither text negates what the other asserts ("do" vs "do not");
- the advice reads the same (action, avoid, conditions, fact) with a similarity of at least DEDUPE_THRESHOLD (config, env, default 0.85):
  (a) exact after normalising, (b) word similarity (Jaccard on stemmed words), (c) embedding cosine when
  EMBEDDING_MODEL is set. Vectors come from a cache that is filled off the event loop (`warm_vectors`); without
  a model, or when the call fails, only (a) and (b) are used. This module never calls the network by itself.

On a merge the older assertion is kept. The newer one's sources, confirmations and outcomes move into it, trust
never goes down, and confidence rises by CONFIDENCE_BOOST only when a person who had not backed it before joins
(capped at CONFIDENCE_CAP). Re-processing a thread removes its source refs first, so the merge is repeated on the
same terms and is idempotent (a known person adds no second boost).
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import datetime
from typing import TYPE_CHECKING

from .. import config
from ..models import ContextAssertion
from ..mvp.patterns import _STOP, _jaccard, _stem
from .contracts import DedupeMerge, DedupeReport

if TYPE_CHECKING:
    from .state import Workbench

log = logging.getLogger(__name__)

EMBEDDING_ONLY_BELOW = 0.5  # word similarity under this: only the embedding says "same", so the strict rule applies
CONFIDENCE_BOOST = 0.03  # per new independent person
CONFIDENCE_CAP = 0.95
MAX_MERGES = 200  # kept in memory and in the state file
REPORT_RECENT = 50
MAX_VECTORS = 2000

_NEGATIONS = {"not", "no", "never", "dont", "don't", "cannot", "can't", "without", "avoid", "stop"}
# Small words the similarity ignores but that change what the advice says ("only if" vs "if", "before" vs "after"):
# both texts must use the same ones.
_LOGIC = {"only", "or", "if", "unless", "until", "before", "after", "when", "while", "except", "instead", "but"}
_TOKEN = re.compile(r"[a-z0-9][a-z0-9.']*")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_vectors: dict[str, list[float]] = {}


# ---------------------------------------------------------------- text helpers


def _norm(text: str | None) -> str:
    return " ".join((text or "").lower().split())


def advice_text(a: ContextAssertion) -> str:
    """What is compared: the advice itself (action, fact), what to avoid and the conditions."""
    parts = [a.action, a.fact, *a.avoid, *[c.text for c in a.conditions]]
    return ". ".join(p.strip().rstrip(".") for p in parts if p and p.strip())


def _tokens(text: str) -> list[str]:
    return [t.strip(".'") for t in _TOKEN.findall(text.lower().replace("-", " ").replace("_", " "))]


def _words(text: str) -> set[str]:
    return {_stem(w) for w in _tokens(text) if w not in _STOP or w.isdigit()} - _NEGATIONS - {""}


def _negation_count(text: str) -> Counter:
    return Counter(t for t in _tokens(text) if t in _NEGATIONS)


def _logic(text: str) -> set[str]:
    return set(_tokens(text)) & _LOGIC


_NUMBER_WORDS = {
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "ten": "10", "eleven": "11", "twelve": "12", "fifteen": "15", "twenty": "20", "thirty": "30", "sixty": "60",
}


def _numbers(a: ContextAssertion) -> set[str]:
    """Digits and spelled-out numbers ("five" and "5" are the same, "five" and "fifteen" are not)."""
    text = advice_text(a).lower()
    return set(_NUMBER.findall(text)) | {_NUMBER_WORDS[t] for t in _tokens(text) if t in _NUMBER_WORDS}




def _checks(a: ContextAssertion) -> set[tuple[str, str, str]]:
    return {(c.check.field, c.check.op, str(c.check.value).lower()) for c in a.conditions if c.check}


def _trigger(a: ContextAssertion) -> set[str]:
    return {b.entity for b in a.bound_to if b.role == "trigger"}


# ---------------------------------------------------------------- embeddings (cache only)


def _cosine(u: list[float], v: list[float]) -> float:
    return sum(x * y for x, y in zip(u, v))


def warm_vectors(texts: list[str]) -> None:
    """Fill the vector cache for `texts`. Blocking network call: run it in a thread. Never raises; does nothing
    without EMBEDDING_MODEL."""
    if not config.EMBEDDING_MODEL:
        return
    try:
        from .. import embed

        missing = sorted({t for t in texts if t and t not in _vectors})
        if missing:
            if len(_vectors) + len(missing) > MAX_VECTORS:
                _vectors.clear()
            for t, v in zip(missing, embed.embed(missing)):
                _vectors[t] = v
    except BaseException as e:  # noqa: BLE001 - embed() may raise SystemExit; fall back to words
        if isinstance(e, KeyboardInterrupt):
            raise
        log.warning("dedupe embeddings unavailable (%s: %s): words only", type(e).__name__, e)


# ---------------------------------------------------------------- the rule


def _same_scope(store, old: ContextAssertion, new: ContextAssertion) -> bool:
    """Same trigger, and the same things it applies to (or, bound differently, the very same elements)."""
    if _trigger(old) != _trigger(new):
        return False
    if old.applies_to and old.applies_to == new.applies_to:
        return True
    reach = store.reach(old)
    return bool(reach) and reach == store.reach(new)


def _strict_scope(old: ContextAssertion, new: ContextAssertion) -> bool:
    """Embedding-only rule: exactly the same things named, not merely the same reach."""
    a, b = {_norm(x) for x in old.applies_to}, {_norm(x) for x in new.applies_to}
    return bool(a) and a == b and _trigger(old) == _trigger(new)


def compare(
    store, old: ContextAssertion, new: ContextAssertion, threshold: float | None = None, vectors: dict[str, list[float]] | None = None
) -> tuple[float, str, str] | None:
    """(similarity, method, reason) when `new` is a near-duplicate of `old`, else None.

    An embedding alone (words below EMBEDDING_ONLY_BELOW) may only merge advice with the identical scope, avoid list,
    condition checks, numbers and negation words: a vector never merges advice that differs in a specific."""
    threshold = config.DEDUPE_THRESHOLD if threshold is None else threshold
    vectors = _vectors if vectors is None else vectors
    if old.id == new.id or old.type != new.type or new.type == "invalidation":
        return None
    if old.valid_to is not None or new.valid_to is not None:
        return None
    if old.id in new.conflicts_with or new.id in old.conflicts_with:
        return None
    if not _same_scope(store, old, new):
        return None
    if {_norm(x) for x in old.avoid} != {_norm(x) for x in new.avoid}:
        return None
    if _checks(old) != _checks(new) or _numbers(old) != _numbers(new):
        return None
    t_old, t_new = advice_text(old), advice_text(new)
    if not t_old or not t_new or _negation_count(t_old) != _negation_count(t_new) or _logic(t_old) != _logic(t_new):
        return None
    if _norm(t_old) == _norm(t_new):
        return 1.0, "exact", "same advice, word for word"
    sim = _jaccard(_words(t_old), _words(t_new))
    if sim >= threshold:
        return round(sim, 3), "words", f"same scope and {round(sim * 100)}% of the same words"
    v_old, v_new = vectors.get(t_old), vectors.get(t_new)
    if v_old and v_new:
        cos = _cosine(v_old, v_new)
        if cos >= threshold:
            if sim < EMBEDDING_ONLY_BELOW and not (_strict_scope(old, new) and _negation_count(t_old) == _negation_count(t_new)):
                return None
            return round(cos, 3), "embedding", f"same scope and embedding similarity {round(cos * 100)}%"
    return None


def find_duplicate(store, new: ContextAssertion, skip_ids: set[str] = frozenset()) -> tuple[ContextAssertion, float, str, str] | None:
    """The best older near-duplicate of `new` in the store (oldest wins a tie), or None."""
    best = None
    for old in store.assertions.values():
        if old.id in skip_ids:
            continue
        hit = compare(store, old, new)
        if hit and (best is None or hit[0] > best[1]):
            best = (old, *hit)
    return best


def warm_for(store, new_list: list[ContextAssertion]) -> None:
    """Embed the new assertions and the stored ones of the same type (one batch, a thread helps)."""
    if not config.EMBEDDING_MODEL:
        return
    types = {a.type for a in new_list}
    warm_vectors([advice_text(a) for a in [*new_list, *[o for o in store.assertions.values() if o.type in types]]])


# ---------------------------------------------------------------- the merge


def _log(wb: Workbench) -> list[DedupeMerge]:
    if not hasattr(wb, "dedupe_merges"):
        wb.dedupe_merges, wb.dedupe_total = [], 0
    return wb.dedupe_merges


def fold(wb: Workbench, kept: ContextAssertion, dup: ContextAssertion, sim: float, method: str, reason: str) -> DedupeMerge:
    """Fold `dup` into the older `kept` and record it. Trust never goes down; confidence rises only through
    a person who had not backed `kept` before."""
    known = {kept.trust.stated_by, *kept.trust.confirmed_by}
    newcomers = {p for p in [dup.trust.stated_by, *dup.trust.confirmed_by] if p and p not in known}
    seen = {(o.application_id, o.entity, o.at, o.worked) for o in kept.outcomes}
    for o in dup.outcomes:
        if (o.application_id, o.entity, o.at, o.worked) not in seen:
            kept.outcomes.append(o)
    wb.store.merge_into(kept.id, dup)  # sources deduped, trust only up, confidence = max, edges moved
    if newcomers:
        kept.confidence = max(kept.confidence, round(min(CONFIDENCE_CAP, kept.confidence + CONFIDENCE_BOOST), 4))
    merge = DedupeMerge(kept_id=kept.id, merged_id=dup.id, similarity=sim, method=method, reason=reason, at=datetime.now())  # type: ignore[arg-type]
    merges = _log(wb)
    merges.insert(0, merge)
    del merges[MAX_MERGES:]
    wb.dedupe_total += 1
    return merge


def dedupe_new(wb: Workbench, new: ContextAssertion, skip_ids: set[str] = frozenset()) -> DedupeMerge | None:
    """If `new` (already in the store) duplicates an older assertion, fold it in. Returns the merge."""
    hit = find_duplicate(wb.store, new, skip_ids | {new.id})
    if hit is None:
        return None
    old, sim, method, reason = hit
    return fold(wb, old, new, sim, method, reason)


def dedupe_store(wb: Workbench) -> list[DedupeMerge]:
    """One-shot over the whole store, oldest first. Emits the changes. Returns the merges made."""
    before = wb.assertion_snapshot()
    warm_for(wb.store, list(wb.store.assertions.values()))
    merges = []
    order = list(wb.store.assertions)  # oldest first; a merged one is only folded into an older one
    for i, aid in enumerate(order):
        a = wb.store.assertions.get(aid)
        if a is None:
            continue
        hit = None
        for oid in order[:i]:
            old = wb.store.assertions.get(oid)
            c = compare(wb.store, old, a) if old else None
            if c and (hit is None or c[0] > hit[1]):
                hit = (old, *c)
        if hit:
            merges.append(fold(wb, hit[0], a, hit[1], hit[2], hit[3]))
    wb.emit_changes(before)
    return merges


def report(wb: Workbench) -> DedupeReport:
    _log(wb)
    return DedupeReport(
        enabled=wb.settings.use_dedupe, merged_total=wb.dedupe_total, recent=wb.dedupe_merges[:REPORT_RECENT],
        threshold=config.DEDUPE_THRESHOLD,
    )


# ---------------------------------------------------------------- calibration (offline pairs, optional real embeddings)

THRESHOLDS = (0.70, 0.75, 0.80, 0.85, 0.90, 0.95)


class _NoGraph:
    """Stand-in store for the evaluation: scope is only the named elements."""

    def reach(self, a: ContextAssertion) -> set[str]:
        return set()


def _pair_assertion(i: str, side: dict) -> ContextAssertion:
    from ..models import Binding, SourceRef, Trust

    return ContextAssertion(
        id=i, type="workaround", topic="eval", summary="eval", action=side["action"], avoid=list(side.get("avoid", [])),
        bound_to=[Binding(entity=e, role="applies_to") for e in side.get("applies_to", [])],
        valid_from=datetime(2026, 1, 1), trust=Trust(level="stated", stated_by="eval"), confidence=0.8,
        sources=[SourceRef(source="teams", file="eval", seq=[1])],
    )


def load_pairs() -> list[dict]:
    """data/eval/dedupe_pairs.json plus look-alikes made from every scenario's expected action (number changed,
    negated, other element): all of them must stay apart."""
    import json

    pairs = list(json.loads((config.DATA_DIR / "eval" / "dedupe_pairs.json").read_text(encoding="utf-8"))["pairs"])
    for f in sorted((config.DATA_DIR / "workbench" / "scenarios").glob("*.json")):
        for it in (json.loads(f.read_text(encoding="utf-8")).get("expected") or {}).get("items", []):
            act = it.get("action")
            if not act:
                continue
            ap = (it.get("scope") or {}).get("instance_ids") or ["SITE-X"]
            a = {"action": act, "avoid": it.get("avoid") or [], "applies_to": ap}
            src = f"mutation of {f.name}"
            if _NUMBER.search(act):
                bumped = _NUMBER.sub(lambda m: str(int(float(m.group())) + 7), act, count=1)
                pairs.append({"same": False, "why": "number changed", "source": src, "a": a, "b": {**a, "action": bumped}})
            pairs.append({"same": False, "why": "negated", "source": src, "a": a,
                          "b": {**a, "action": "Do not " + act[0].lower() + act[1:]}})
            pairs.append({"same": False, "why": "other element", "source": src, "a": a, "b": {**a, "applies_to": ["ZZZ-999"]}})
    return pairs


def evaluate(pairs: list[dict], embedder=None, thresholds: tuple[float, ...] = THRESHOLDS) -> dict:
    """Precision and recall per threshold. `words`: stemmed-word Jaccard of the advice text alone. `rule`: the full
    compare() with the scope, avoid, number and negation gates (what the store does, words and, when `embedder`
    is given, embeddings). `embedder` maps a list of texts to vectors (unit length); None = words only."""
    store = _NoGraph()
    items = []
    for n, p in enumerate(pairs):
        a, b = _pair_assertion(f"a{n}", p["a"]), _pair_assertion(f"b{n}", p["b"])
        items.append((p, a, b, advice_text(a), advice_text(b)))
    vectors: dict[str, list[float]] = {}
    if embedder is not None:
        texts = sorted({t for *_, ta, tb in items for t in (ta, tb)})
        vectors = dict(zip(texts, embedder(texts)))
    rows = []
    for t in thresholds:
        row: dict = {"threshold": t}
        for name in ("words", "rule", *(["cosine"] if embedder else [])):
            tp = fp = fn = 0
            for p, a, b, ta, tb in items:
                if name == "words":
                    hit = _jaccard(_words(ta), _words(tb)) >= t or _norm(ta) == _norm(tb)
                elif name == "cosine":
                    hit = _cosine(vectors[ta], vectors[tb]) >= t
                else:
                    hit = compare(store, a, b, threshold=t, vectors=vectors) is not None
                tp += hit and p["same"]
                fp += hit and not p["same"]
                fn += (not hit) and p["same"]
            row[name] = {"tp": tp, "fp": fp, "fn": fn, "precision": tp / (tp + fp) if tp + fp else 1.0,
                         "recall": tp / (tp + fn) if tp + fn else 1.0}
        rows.append(row)
    return {"n_same": sum(p["same"] for p in pairs), "n_different": sum(not p["same"] for p in pairs), "rows": rows}


def render_table(result: dict) -> str:
    cols = [c for c in ("words", "rule", "cosine") if c in result["rows"][0]]
    names = {"words": "words only (text)", "rule": "full rule (store)", "cosine": "embedding only (text)"}
    out = [f"{result['n_same']} same-advice pairs, {result['n_different']} look-alike pairs",
           "| threshold | " + " | ".join(f"{names[c]}: FP / precision / recall" for c in cols) + " |",
           "| --- |" + " --- |" * len(cols)]
    for r in result["rows"]:
        cells = [f"{r[c]['fp']} / {r[c]['precision']:.2f} / {r[c]['recall']:.2f}" for c in cols]
        out.append(f"| {r['threshold']:.2f} | " + " | ".join(cells) + " |")
    return "\n".join(out)
