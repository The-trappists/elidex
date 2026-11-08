"""Critic: a second model double-checks the items the extractor produced, before they are linked.

Step A (deterministic): the verbatim evidence quote must appear in one of the cited messages.
Step B (one LLM call per thread, role "critic"): is the scope no wider than what the speakers stated, does a
vague word ("old", "legacy") hide in the class, does the cited text really support the action?
Verdicts: keep, downgrade (lower confidence) or reject (item removed). The loop is automated: every outcome is
informational (ReviewFlag), nothing waits for a click, and a critic failure never blocks the pipeline.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from . import llm
from .models import ExtractedItem, Thread
from .dashboard.contracts import CriticVerdict, ReviewFlag
from .dashboard.processor import agents_quiet

log = logging.getLogger(__name__)

EVIDENCE_PENALTY = 0.7  # confidence factor when a quote is not found in the cited messages
DOWNGRADE_DEFAULT = 0.7  # confidence factor when the model downgrades without giving a number

SYSTEM_PROMPT = """You are a strict reviewer of knowledge extracted from a chat or email thread between network specialists. An extractor turned the thread into items; you check each item against the messages. You do not extract anything new and you never diagnose faults.

For each item, check:
1. Scope: is it no wider than what the speakers actually stated? Reject or downgrade when the item reaches more elements than the text supports (a whole model or install-year range inferred from one element, a site used as scope when the advice is about one unit).
2. Vague words: a word such as "old", "legacy", "older units", "the new ones" must not be turned into a precise class (model, year range) the text does not state. Downgrade (or reject when the action would then be applied to the wrong elements).
3. Support: do the cited messages really support the summary and the action? Reject an item whose action or fact is not in the cited text.

Verdicts:
- "keep": faithful and not wider than stated.
- "downgrade": probably right but too wide or too uncertain. Give confidence_after, lower than the item's confidence.
- "reject": not supported by the text, or wrong.
Reason: one plain sentence a non-expert can read, quoting the message words that matter.

Reply with JSON only, with exactly one verdict per item index.
JSON schema:
{schema}"""


class _Verdict(BaseModel):
    index: int
    verdict: Literal["keep", "downgrade", "reject"]
    reason: str = ""
    confidence_after: float | None = Field(None, ge=0, le=1)


class CriticResult(BaseModel):
    verdicts: list[_Verdict] = Field(default_factory=list)


def _norm(text: str) -> str:
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip().casefold()


def _cited_messages(item: ExtractedItem, thread: Thread):
    return [m for m in thread.messages if m.seq in item.cited_seq] or thread.messages


def evidence_found(item: ExtractedItem, thread: Thread) -> bool:
    """True when the quote appears (whitespace and case normalised) in a cited message.
    No quote (old cached extractions) cannot be checked and counts as found."""
    if not item.evidence_quote or not item.evidence_quote.strip():
        return True
    quote = _norm(item.evidence_quote)
    return any(quote in _norm(m.text) for m in _cited_messages(item, thread))


def _parse(raw: str) -> CriticResult:
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip()
    return CriticResult.model_validate_json(raw)


def _render_items(items: list[ExtractedItem], found: list[bool]) -> str:
    rows = []
    for i, (it, ok) in enumerate(zip(items, found)):
        rows.append(
            {
                "index": i,
                "topic": it.topic,
                "type": it.type,
                "summary": it.summary,
                "action": it.action,
                "avoid": it.avoid,
                "fact": it.fact,
                "scope": it.scope.model_dump(mode="json"),
                "stated_by": it.stated_by,
                "cited_seq": it.cited_seq,
                "evidence_quote": it.evidence_quote,
                "quote_found_in_cited_messages": ok,
                "confidence": it.confidence,
            }
        )
    return json.dumps(rows, ensure_ascii=False, indent=1)


def _flag(kind: str, thread: Thread, job_id: str, message: str, detail: str | None, item_topic: str | None = None) -> ReviewFlag:
    return ReviewFlag(
        id="flag_" + uuid.uuid4().hex[:10],
        kind=kind,  # type: ignore[arg-type]
        thread_id=thread.id,
        job_id=job_id,
        message=message,
        detail=detail,
        item_topic=item_topic,
        created_at=datetime.now(),
    )


def critique(
    items: list[ExtractedItem],
    thread: Thread,
    *,
    job_id: str = "",
    sim_time: datetime | None = None,
    traces: list[dict[str, Any]] | None = None,
) -> tuple[list[ExtractedItem], list[CriticVerdict], list[ReviewFlag]]:
    """Check items against the thread. Returns (kept items, one verdict per input item, flags).

    Blocking (one LLM call): run it in a worker thread from async code. Raises when the LLM call fails or
    returns invalid JSON; the install() hook turns that into a job note and keeps the items unchanged.
    `traces`, when given, receives the LLM trace dicts of the call."""
    if not items:
        return [], [], []
    found = [evidence_found(it, thread) for it in items]
    schema = CriticResult.model_json_schema()
    raw, call_traces = llm.complete_traced(
        SYSTEM_PROMPT.format(schema=json.dumps(schema)),
        f"Thread:\n{thread.render()}\n\nItems to check:\n{_render_items(items, found)}",
        json_mode=True,
        schema=schema,
        purpose="critic",
        thread_id=thread.id,
        sim_time=sim_time,
        validate=_parse,
        role="critic",
    )
    if traces is not None:
        traces.extend(call_traces)
    by_index = {v.index: v for v in _parse(raw).verdicts}

    kept: list[ExtractedItem] = []
    verdicts: list[CriticVerdict] = []
    flags: list[ReviewFlag] = []
    for i, item in enumerate(items):
        v = by_index.get(i) or _Verdict(index=i, verdict="keep", reason="no verdict returned by the critic")
        quote = f' Evidence: "{item.evidence_quote}".' if item.evidence_quote else ""
        detail = f"stated_by {item.stated_by}, cited seq {item.cited_seq}"
        if v.verdict == "reject":
            verdicts.append(CriticVerdict(item_topic=item.topic, verdict="reject", reason=v.reason, evidence_found=found[i]))
            flags.append(_flag("critic_rejected", thread, job_id, f"Dropped '{item.topic}': {v.reason}{quote}", detail, item.topic))
            continue
        confidence, reason, lowered = item.confidence, v.reason, False
        if v.verdict == "downgrade":
            lowered = True
            after = v.confidence_after if v.confidence_after is not None else item.confidence * DOWNGRADE_DEFAULT
            confidence = round(min(after, item.confidence), 4)
        if not found[i]:
            lowered = True
            confidence = round(min(confidence, item.confidence * EVIDENCE_PENALTY), 4)
            reason = (reason + " " if reason else "") + "The quoted evidence was not found in the cited messages."
        if lowered:
            verdicts.append(
                CriticVerdict(item_topic=item.topic, verdict="downgrade", reason=reason, evidence_found=found[i], confidence_after=confidence,
                    confidence_before=item.confidence)
            )
            flags.append(
                _flag(
                    "over_reach" if found[i] else "low_confidence",
                    thread,
                    job_id,
                    f"Lowered confidence of '{item.topic}' from {item.confidence} to {confidence}: {reason}{quote}",
                    detail,
                    item.topic,
                )
            )
            kept.append(item.model_copy(update={"confidence": confidence}))
        else:
            verdicts.append(CriticVerdict(item_topic=item.topic, verdict="keep", reason=reason, evidence_found=found[i]))
            kept.append(item)
    return kept, verdicts, flags


async def _after_understand(ctx) -> list[ExtractedItem] | None:
    """Hook: runs only when settings.use_critic is on. Any failure keeps the items and adds a job note."""
    if ctx.settings is None or not ctx.settings.use_critic or not ctx.items:
        return None
    if agents_quiet(ctx):
        return None  # quiet: no key (scripted mode) or seed bootstrap (no extra LLM calls)
    job = ctx.job
    if not job.extractor.startswith("llm"):
        return None  # scripted or cached items: nothing for a second model to check
    traces: list[dict[str, Any]] = []
    try:
        kept, verdicts, flags = await asyncio.to_thread(
            critique, ctx.items, ctx.core, job_id=job.id, sim_time=ctx.wb.now(), traces=traces
        )
    except Exception as e:  # noqa: BLE001 - the critic must never block the pipeline
        job.notes.append(f"critic failed ({type(e).__name__}: {str(e)[:200]}), items kept unchanged")
        log.warning("critic failed: %s", e)
        return None
    finally:
        job.llm_call_ids += [t["id"] for t in traces]
    job.critic = verdicts
    job.flags += flags
    n_down = sum(v.verdict == "downgrade" for v in verdicts)
    job.notes.append(f"critic: {len(kept)} kept ({n_down} downgraded), {len(ctx.items) - len(kept)} rejected")
    return kept


def install() -> None:
    from .dashboard.processor import register_hook

    register_hook("after_understand", _after_understand)
