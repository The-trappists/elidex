"""Idea D: knowledge lifecycle, silently.

A later message closes `valid_to` (firmware fix, new lock); two experts who disagree are both
kept with a conflict flag. No "is this still true?" prompt to a human.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..models import ContextAssertion
    from ..store import ContextStore


def _norm(text: str | None) -> str:
    return " ".join((text or "").lower().split())


def reconcile(store: ContextStore, new: ContextAssertion) -> list[str]:
    """Update older assertions on the same topic and scope. Returns what changed."""
    events = []
    for old in store.assertions.values():
        if old.id == new.id or old.topic != new.topic or not (old.applies_to & new.applies_to):
            continue
        if new.type == "invalidation":
            # Only knowledge that is older than the invalidation can be closed. The replacement knowledge given
            # in the same message (same time) must stay open, even if the extractor gave it the same topic.
            if old.type == "invalidation" or old.valid_to is not None or old.valid_from >= new.valid_from:
                continue
            old.valid_to = new.valid_from
            old.closed_by = new.id
            events.append(f"{old.id} closed at {new.valid_from:%Y-%m-%d %H:%M} by {new.id} ({new.trust.stated_by})")
        elif new.type != "invalidation" and (
            old.valid_to is None  # closed knowledge is no longer in conflict with anything
            and new.valid_to is None
            and old.type == new.type
            and _norm(old.action) != _norm(new.action)
            and old.trust.stated_by != new.trust.stated_by
        ):
            old.conflicts_with.append(new.id)
            new.conflicts_with.append(old.id)
            events.append(f"{old.id} and {new.id} disagree: both kept, flagged")
    return events
