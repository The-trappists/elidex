"""Review flags: what the loop did that an operator may want to look at.

Informational only. Nothing here blocks, delays or changes an assertion: flags are created after a job
finished, and the knowledge is already live.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import TYPE_CHECKING

from ..graph import KnowledgeGraph
from ..graph import schema as S
from .contracts import PipelineJob, ReviewFlag

if TYPE_CHECKING:
    from .state import Workbench

log = logging.getLogger(__name__)

LOW_CONFIDENCE = 0.7  # stored assertions below this are flagged
OVER_REACH_MIN = 6  # flag a rule that reaches at least this many elements the thread never names

_ABSTAINED = re.compile(r"^abstained '([^']*)':\s*(.*)$")
_CONFLICT_WORDS = re.compile(r"disagree|conflict|contradict", re.IGNORECASE)
_ASSERTION_ID = re.compile(r"ctx_\d{4,}")


def _plain_reason(why: str) -> str:
    if why.startswith("confidence"):
        return "the extractor was not sure enough about it (" + why + ")"
    if "nothing to bind" in why:
        return "it could not tell which equipment or site the advice applies to"
    return why or "no reason recorded"


def _flag(
    job: PipelineJob, kind, message: str, assertion_id: str | None = None, detail: str | None = None, item_topic: str | None = None
) -> ReviewFlag:
    return ReviewFlag(
        id="", kind=kind, thread_id=job.thread_id, job_id=job.id, assertion_id=assertion_id,
        item_topic=item_topic, message=message, detail=detail, created_at=datetime.now(),
    )


def _short(text: str | None, limit: int = 80) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "..."


def _conflict_flag(job: PipelineJob, wb: Workbench, pair: tuple[str, ...]) -> ReviewFlag:
    """The flag for two assertions that disagree; names both pieces of advice. assertion_id is the first id
    of the sorted pair and detail carries both ids."""
    found = [wb.store.assertions[i] for i in pair if i in wb.store.assertions]
    first = found[0] if found else None
    topic = first.topic if first else None
    detail = f"{pair[0]} conflicts with {pair[1]}" if len(pair) > 1 else f"{pair[0]} conflicts with another piece of advice"
    if len(found) == 2:
        a, b = found
        text = lambda x: _short(x.action or x.summary)  # noqa: E731
        message = (
            f"Two people gave different advice about '{a.topic}': {a.trust.stated_by} says '{text(a)}', "
            f"{b.trust.stated_by} says '{text(b)}'. Both are kept and the agent sees both."
        )
    else:
        message = f"Two people gave different advice about '{topic}'. Both are kept and the agent sees both."
    return _flag(job, "conflict", message, pair[0], detail, topic)


def _named_in_thread(wb: Workbench, thread_id: str):
    """The graph over the live threads, and the elements and sites the given thread names."""
    threads = [t.to_thread() for t in wb.threads.values() if t.messages]
    kg = KnowledgeGraph.build(wb.store, threads)
    named: set[str] = set()
    for node, data in kg.g.nodes(data=True):
        if data.get("kind") == S.MESSAGE and data.get("file") == thread_id:
            named.update(kg._out(node, S.MENTIONS))
    return kg, named


def _over_reach(wb: Workbench, job: PipelineJob, stored: list) -> list[ReviewFlag]:
    if not stored or job.thread_id not in wb.threads:
        return []
    kg, named = _named_in_thread(wb, job.thread_id)
    for site in [n for n in named if kg.kind(n) == S.SITE]:
        named.update(kg._in(site, S.LOCATED_AT))  # naming a site names its elements
    flags = []
    for a in stored:
        elements = set(kg.reach(a.id)["elements"])
        unnamed = sorted(elements - named)
        if len(unnamed) >= OVER_REACH_MIN:
            sample = ", ".join(unnamed[:4]) + (", ..." if len(unnamed) > 4 else "")
            flags.append(
                _flag(
                    job, "over_reach",
                    f"'{a.topic}' applies to {len(elements)} elements, but the conversation only names "
                    f"{len(elements) - len(unnamed)} of them. Check that the advice really covers the others.",
                    a.id, f"Not named in the thread: {sample}", a.topic,
                )
            )
    return flags


def _folded_into_supported(wb: Workbench, job: PipelineJob, stored: list) -> set[str]:
    """Ids of stored assertions that this job folded a duplicate into (dedupe) and that at least two people back:
    the system already knows this well, so asking the operator again would only add noise."""
    folded = {m.kept_id for m in getattr(wb, "dedupe_merges", []) if m.at >= job.started_at}
    return {a.id for a in stored if a.id in folded and len({a.trust.stated_by, *a.trust.confirmed_by}) >= 2 and a.valid_to is None}


def _flagged_conflict_pairs(wb: Workbench) -> set[frozenset[str]]:
    """Pairs that already have a conflict flag in any thread, dismissed or not."""
    from .state import _flag_key

    return {frozenset(i for i in _flag_key(f)[2]) for f in wb.flags.values() if f.kind == "conflict" and f.assertion_id}


def collect_flags(job: PipelineJob, wb: Workbench) -> list[ReviewFlag]:
    """Create the review flags of a finished job: job.flags (from the critic and judge hooks) plus the rules
    below. Returns the flags that are new (a flag already known for the same kind, thread and assertion is
    kept as it is, dismissed or not). Never raises.

    Rules: abstained (a link note starting with "abstained"), low_confidence (stored confidence below
    LOW_CONFIDENCE), conflict (the assertion disagrees with another, or a lifecycle/judge event says so),
    over_reach (reaches OVER_REACH_MIN or more elements the thread never names).
    """
    try:
        candidates = list(job.flags)
        stored = [wb.store.assertions[i] for i in job.assertion_ids if i in wb.store.assertions]
        quiet = _folded_into_supported(wb, job, stored)  # merged into a well-supported assertion: no new flags
        quiet_topics = {a.topic for a in stored if a.id in quiet}

        for note in job.notes:
            if m := _ABSTAINED.match(note):
                if m.group(1) in quiet_topics:
                    continue
                candidates.append(
                    _flag(job, "abstained", f"Not stored: '{m.group(1)}', because {_plain_reason(m.group(2))}.", None, note, m.group(1))
                )
            elif note.startswith("abstained"):
                candidates.append(_flag(job, "abstained", "An item was not stored.", None, note))

        for a in stored:
            if a.confidence < LOW_CONFIDENCE and a.id not in quiet:
                candidates.append(
                    _flag(
                        job, "low_confidence",
                        f"'{a.topic}' is live, but the system is only {round(a.confidence * 100)}% sure about it.",
                        a.id, f"confidence {a.confidence}", a.topic,
                    )
                )

        stored_ids = {a.id for a in stored}
        partners: dict[str, set[str]] = {a.id: set(a.conflicts_with) for a in stored if a.conflicts_with}
        for ev in [*job.events, *(j.reason for j in job.judge if j.verdict == "contradicts")]:
            if _CONFLICT_WORDS.search(ev):
                ids = _ASSERTION_ID.findall(ev)
                for aid in ids:
                    if aid in stored_ids:
                        partners.setdefault(aid, set()).update(i for i in ids if i != aid)
        # One flag per unordered pair, not one per assertion: both sides see the same card.
        pairs: set[tuple[str, ...]] = set()
        for aid, others in partners.items():
            if others:
                pairs.update(tuple(sorted((aid, o))) for o in others)
            else:
                pairs.add((aid,))
        known_pairs = _flagged_conflict_pairs(wb)
        for pair in sorted(pairs):
            if quiet & set(pair) or (len(pair) > 1 and frozenset(pair) in known_pairs):
                continue  # a pair is flagged once, whatever the thread
            candidates.append(_conflict_flag(job, wb, pair))

        try:
            candidates += _over_reach(wb, job, [a for a in stored if a.id not in quiet])
        except Exception as e:  # noqa: BLE001 - a rule must never break the job
            log.warning("over_reach rule failed: %s", e)

        created = []
        for flag in candidates:
            if flag.item_topic is None and flag.assertion_id in wb.store.assertions:
                flag.item_topic = wb.store.assertions[flag.assertion_id].topic
            if (added := wb.add_flag(flag)) is not None:
                created.append(added)
        return created
    except Exception as e:  # noqa: BLE001
        log.warning("collect_flags failed: %s", e)
        return []
