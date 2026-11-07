"""Pure evaluation helpers: match extracted items to expected items, score linking.

Matching is on (type, normalised scope, action similarity), not on the topic slug: two models name the same
knowledge differently, but they should bind to the same things and advise the same action.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from typing import Any

from .models import ContextAssertion, ExtractedItem

ACTION_THRESHOLD = 0.5
Binding3 = tuple[str, str, str]  # (assertion type, entity, role)


def tokens(text: str | None) -> frozenset[str]:
    return frozenset(re.findall(r"[a-z0-9]+", (text or "").lower()))


def action_similarity(a: str | None, b: str | None) -> float:
    """Token Jaccard of two actions. Both empty counts as identical (1.0), one empty as 0.0."""
    ta, tb = tokens(a), tokens(b)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def match_items(
    got: list[ExtractedItem],
    want: list[ExtractedItem],
    scope_key: Callable[[ExtractedItem], Any],
) -> dict[str, list[str]]:
    """Greedy, deterministic, one-to-one matching in three passes.

    1. same type, same scope, action Jaccard >= 0.5 (or both actions empty): matched.
    2. same type and scope, different action: binding_diffs.
    3. same type, same action, different scope: binding_diffs (over/under-linking signal).

    Returns {"matched", "missed", "unexpected", "binding_diffs"}: matched/missed use the expected topic,
    unexpected the extracted topic. Items paired in pass 2 or 3 appear only in binding_diffs.
    """
    free_got = list(range(len(got)))
    free_want = list(range(len(want)))
    matched: list[str] = []
    diffs: list[str] = []

    def take(score_fn: Callable[[ExtractedItem, ExtractedItem], float | None]) -> list[tuple[int, int]]:
        pairs = []
        for wi in list(free_want):
            best, best_score = None, None
            for gi in free_got:
                score = score_fn(got[gi], want[wi])
                if score is not None and (best_score is None or score > best_score):
                    best, best_score = gi, score
            if best is not None:
                free_want.remove(wi)
                free_got.remove(best)
                pairs.append((wi, best))
        return pairs

    def pass1(g: ExtractedItem, w: ExtractedItem) -> float | None:
        if g.type != w.type or scope_key(g) != scope_key(w):
            return None
        s = action_similarity(g.action, w.action)
        return s if s >= ACTION_THRESHOLD else None

    for wi, _ in take(pass1):
        matched.append(want[wi].topic)

    def pass2(g: ExtractedItem, w: ExtractedItem) -> float | None:
        return 0.0 if g.type == w.type and scope_key(g) == scope_key(w) else None

    for wi, gi in take(pass2):
        diffs.append(
            f"{want[wi].topic}: same scope, different action "
            f"(expected {want[wi].action!r}, got {got[gi].action!r}; extracted as '{got[gi].topic}')"
        )

    def pass3(g: ExtractedItem, w: ExtractedItem) -> float | None:
        if g.type != w.type or not (g.action or w.action):
            return None
        s = action_similarity(g.action, w.action)
        return s if s >= ACTION_THRESHOLD else None

    for wi, gi in take(pass3):
        diffs.append(
            f"{want[wi].topic}: same action, different scope "
            f"(expected {scope_key(want[wi])}, got {scope_key(got[gi])}; extracted as '{got[gi].topic}')"
        )

    return {
        "matched": matched,
        "missed": [want[i].topic for i in free_want],
        "unexpected": [got[i].topic for i in free_got],
        "binding_diffs": diffs,
    }


def binding_set(assertions: Iterable[ContextAssertion]) -> set[Binding3]:
    """(type, entity, role) of every binding of the linked assertions."""
    return {(a.type, b.entity, b.role) for a in assertions for b in a.bound_to}


def link_precision(got: set[Binding3], want: set[Binding3]) -> float:
    """Share of produced bindings that are expected (over-linking lowers it). Nothing produced: 1.0 only if nothing was wanted."""
    if not got:
        return 1.0 if not want else 0.0
    return len(got & want) / len(got)


def link_recall(got: set[Binding3], want: set[Binding3]) -> float:
    """Share of expected bindings that were produced (under-linking lowers it)."""
    if not want:
        return 1.0
    return len(got & want) / len(want)
