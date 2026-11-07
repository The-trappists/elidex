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


def _flag(job: PipelineJob, kind, message: str, assertion_id: str | None = None, detail: str | None = None) -> ReviewFlag:
    return ReviewFlag(
        id="", kind=kind, thread_id=job.thread_id, job_id=job.id, assertion_id=assertion_id,
        message=message, detail=detail, created_at=datetime.now(),
    )


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
                    a.id, f"Not named in the thread: {sample}",
                )
            )
    return flags


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

        for note in job.notes:
            if m := _ABSTAINED.match(note):
                candidates.append(
                    _flag(job, "abstained", f"Not stored: '{m.group(1)}', because {_plain_reason(m.group(2))}.", None, note)
                )
            elif note.startswith("abstained"):
                candidates.append(_flag(job, "abstained", "An item was not stored.", None, note))

        for a in stored:
            if a.confidence < LOW_CONFIDENCE:
                candidates.append(
                    _flag(
                        job, "low_confidence",
                        f"'{a.topic}' is live, but the system is only {round(a.confidence * 100)}% sure about it.",
                        a.id, f"confidence {a.confidence}",
                    )
                )

        stored_ids = {a.id for a in stored}
        conflicted = {a.id: ", ".join(a.conflicts_with) for a in stored if a.conflicts_with}
        for ev in [*job.events, *(j.reason for j in job.judge if j.verdict == "contradicts")]:
            if _CONFLICT_WORDS.search(ev):
                for aid in _ASSERTION_ID.findall(ev):
                    if aid in stored_ids:
                        conflicted.setdefault(aid, ev)
        for a in stored:
            if a.id in conflicted:
                candidates.append(
                    _flag(
                        job, "conflict",
                        f"Two people gave different advice about '{a.topic}'. Both are kept and the agent sees both.",
                        a.id, f"conflicts with {conflicted[a.id]}",
                    )
                )

        try:
            candidates += _over_reach(wb, job, stored)
        except Exception as e:  # noqa: BLE001 - a rule must never break the job
            log.warning("over_reach rule failed: %s", e)

        created = []
        for flag in candidates:
            if (added := wb.add_flag(flag)) is not None:
                created.append(added)
        return created
    except Exception as e:  # noqa: BLE001
        log.warning("collect_flags failed: %s", e)
        return []
