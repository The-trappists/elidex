"""Dedupe: keep the store small by folding a near-duplicate into the older, valid assertion.

A new assertion is a near-duplicate of an existing one when ALL of this holds (a wrong merge is worse than none):

- same type (never an invalidation), both still valid (no valid_to), neither conflicts with the other;
- same scope: the same equipment/site/class the advice applies to (or the same reach), and the same trigger;
- no contradiction: the same `avoid` list, the same condition checks, the same numbers (5 min is not 15 min),
  and neither text negates what the other asserts ("do" vs "do not");
- the advice reads the same (action, avoid, conditions, fact) with a similarity of at least DEDUPE_THRESHOLD:
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
from datetime import datetime
from typing import TYPE_CHECKING

from .. import config
from ..models import ContextAssertion
from ..mvp.patterns import _STOP, _jaccard, _stem
from .contracts import DedupeMerge, DedupeReport

if TYPE_CHECKING:
    from .state import Workbench

log = logging.getLogger(__name__)

DEDUPE_THRESHOLD = 0.85  # minimum similarity (words or embedding) to call two texts the same advice
CONFIDENCE_BOOST = 0.03  # per new independent person
CONFIDENCE_CAP = 0.95
MAX_MERGES = 200  # kept in memory and in the state file
REPORT_RECENT = 50
MAX_VECTORS = 2000

_NEGATIONS = {"not", "no", "never", "dont", "don't", "cannot", "can't", "without", "avoid", "stop"}
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


def _negated(text: str) -> bool:
    return bool(set(_tokens(text)) & _NEGATIONS)


def _numbers(a: ContextAssertion) -> set[str]:
    return set(_NUMBER.findall(advice_text(a).lower()))


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


def compare(store, old: ContextAssertion, new: ContextAssertion) -> tuple[float, str, str] | None:
    """(similarity, method, reason) when `new` is a near-duplicate of `old`, else None."""
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
    if not t_old or not t_new or _negated(t_old) != _negated(t_new):
        return None
    if _norm(t_old) == _norm(t_new):
        return 1.0, "exact", "same advice, word for word"
    sim = _jaccard(_words(t_old), _words(t_new))
    if sim >= DEDUPE_THRESHOLD:
        return round(sim, 3), "words", f"same scope and {round(sim * 100)}% of the same words"
    v_old, v_new = _vectors.get(t_old), _vectors.get(t_new)
    if v_old and v_new:
        cos = _cosine(v_old, v_new)
        if cos >= DEDUPE_THRESHOLD:
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
        threshold=DEDUPE_THRESHOLD,
    )
