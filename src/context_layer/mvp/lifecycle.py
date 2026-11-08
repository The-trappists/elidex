"""Idea D: knowledge lifecycle, silently.

A later message closes `valid_to` (firmware fix, new lock); two experts who disagree are both
kept with a conflict flag. No "is this still true?" prompt to a human.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from ..models import Check, Condition

if TYPE_CHECKING:
    from ..models import ContextAssertion
    from ..store import ContextStore


def _norm(text: str | None) -> str:
    return " ".join((text or "").lower().split())


def _different_advice(old: ContextAssertion, new: ContextAssertion) -> bool:
    """Actions differ; with no action on either side (facts), the facts differ (same rule as store.same_knowledge)."""
    if old.action or new.action:
        return _norm(old.action) != _norm(new.action)
    return _norm(old.fact) != _norm(new.fact)


def reconcile(store: ContextStore, new: ContextAssertion) -> list[str]:
    """Update older assertions on the same topic and scope. Returns what changed.

    An invalidation closes an older rule when it covers every element the rule reaches (`ContextStore.reach`), not
    when their binding ids are equal: "TX-3000 up to 2018" is closed by "transmission nodes up to 2019". A rule it
    covers only in part stays open (closing it would end it for elements nobody spoke about); that is noted.
    """
    events = []
    new_reach = store.reach(new) if new.type == "invalidation" else set()
    for old in store.assertions.values():
        if old.id == new.id or old.topic != new.topic:
            continue
        if new.type == "invalidation":
            # Only knowledge that is older than the invalidation can be closed. The replacement knowledge given
            # in the same message (same time) must stay open, even if the extractor gave it the same topic.
            if old.type == "invalidation" or old.valid_to is not None or old.valid_from >= new.valid_from:
                continue
            old_reach = store.reach(old)
            if not old_reach or not (old_reach & new_reach):
                continue
            if not old_reach <= new_reach:
                left = sorted(old_reach - new_reach)
                events.append(
                    f"{old.id} kept open: {new.id} covers {len(old_reach) - len(left)} of its {len(old_reach)} "
                    f"elements, not {', '.join(left[:4])}{', ...' if len(left) > 4 else ''}"
                )
                continue
            fw_match = re.search(r"\bfirmware\s+([\d.]+)", f"{new.summary} {new.fact or ''} {new.diagnosis or ''}", re.IGNORECASE)
            if fw_match:
                fw_ver = fw_match.group(1)
                fw_cond = Condition(text=f"firmware < {fw_ver}", check=Check(field="firmware", op="<", value=fw_ver))
                if not any(c.check and c.check.field == "firmware" for c in old.conditions):
                    old.conditions.append(fw_cond)
            old.valid_to = new.valid_from
            old.closed_by = new.id
            events.append(f"{old.id} closed at {new.valid_from:%Y-%m-%d %H:%M} by {new.id} ({new.trust.stated_by})")
        elif new.type != "invalidation" and (
            # Two experts who scope their advice to different class ids (TX-3000 vs TX-3000 up to 2019) still
            # disagree when they gave it for the same node or site, so the instances count here.
            (old.about & new.about)
            and old.valid_to is None  # closed knowledge is no longer in conflict with anything
            and new.valid_to is None
            and old.type == new.type
            and _different_advice(old, new)
            and old.trust.stated_by != new.trust.stated_by
        ):
            if new.id in old.conflicts_with:
                continue
            old.conflicts_with.append(new.id)
            new.conflicts_with.append(old.id)
            events.append(f"{old.id} and {new.id} disagree: both kept, flagged")
    return events
