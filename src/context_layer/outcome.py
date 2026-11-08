"""Passive outcome loop (loop v2, L3): the loop closes itself, nobody is asked to confirm anything.

1. The demo agent applies knowledge to a case and says so in a thread, like a colleague would
   (`post_application`, called by POST /agent/run). One RuleApplication per assertion the recommendation cites
   (not every retrieved one: a "fixed" reply must not verify noise), outcome "pending".
2. The technician's next messages in that thread ("traffic is back", "still down") are read after the thread's
   job stored its knowledge (hook `after_store`). One LLM call per pending application decides worked / failed /
   unclear; without an LLM (or when it fails) a small keyword heuristic decides.
3. The verdict is recorded in the one ledger (`Assertion.outcomes`, source "thread") and settled by `settle`: the same
   rule as POST /agent/outcome (see docs/outcome-unification.md). unclear: nothing changes, the application stays pending.

Everything is behind Settings.use_outcome_loop. A failure here is noted in the job and never blocks it.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, Field

from . import config
from .models import ExtractedItem, SourceRef, Trust

if TYPE_CHECKING:
    from .dashboard.processor import HookContext
    from .dashboard.state import Dashboard

log = logging.getLogger(__name__)

OPS_PERSONA_ID = "ops-agent"
OPS_NAME = "Ops agent"
OPS_ROLE = "AI operations agent"
FAILED_CONFIDENCE_FACTOR = 0.7
MAX_QUOTE = 300

# ---------------------------------------------------------------- posting the application


def _text_for(a, entity_id: str) -> str:
    what = (a.action or a.fact or a.summary).strip().rstrip(".")
    line = f"Applied {a.id} on {entity_id}: {what}."
    if a.avoid:
        line += " Avoid: " + "; ".join(x.strip().rstrip(".") for x in a.avoid) + "."
    return line


def find_thread_id(wb: Dashboard, entity_id: str) -> str | None:
    """The thread of the newest open incident on this entity (any incident as a second choice)."""
    incidents = [i for i in wb.incidents.values() if i.entity_id == entity_id and i.thread_id in wb.threads]
    incidents.sort(key=lambda i: (i.status == "open", i.opened_at), reverse=True)
    return incidents[0].thread_id if incidents else None


def post_application(wb: Dashboard, entity_id: str, assertions: list, title: str = "") -> tuple[str, list]:
    """Post ONE informative message from the ops agent and create a pending RuleApplication per assertion.
    Purely informative: it never asks anyone to reply, confirm or rate. Returns (thread id, applications)."""
    from .dashboard.contracts import RuleApplication

    thread_id = find_thread_id(wb, entity_id)
    if thread_id is None:
        subject = (title or f"Agent case on {entity_id}").strip()
        thread_id = wb.create_thread("teams", subject, [OPS_NAME], "manual").id
    text = "\n".join(_text_for(a, entity_id) for a in assertions)
    msg = wb.post_message(thread_id, OPS_NAME, text, role=OPS_ROLE, persona_id=OPS_PERSONA_ID)
    apps = [
        wb.add_application(
            RuleApplication(
                id="", assertion_id=a.id, entity_id=entity_id, thread_id=thread_id,
                applied_at=msg.sent_at, message_seq=msg.seq,
            )
        )
        for a in assertions
    ]
    return thread_id, apps


# ---------------------------------------------------------------- deciding the outcome


class OutcomeVerdict(BaseModel):
    outcome: Literal["worked", "failed", "unclear"]
    quote: str = Field("", description="verbatim quote from one of the technician messages")
    reason: str = Field("", description="one short sentence")


_SCHEMA = OutcomeVerdict.model_json_schema()

SYSTEM = """You read what people wrote in a work thread after an AI agent announced it applied a recorded piece of advice.
Decide whether the advice worked, failed, or whether the messages do not say.
- worked: someone reports the problem is gone (traffic is back, fixed, working again).
- failed: someone reports no improvement or that it made no difference (still down, did not work).
- unclear: the messages say nothing about the result, or it is ambiguous.
Only use the technician messages, never the agent message. Quote verbatim, copy the exact words of ONE message that shows the result (empty for unclear).
Answer with JSON: {"outcome": "worked"|"failed"|"unclear", "quote": "...", "reason": "one short sentence"}."""

# No bare "back" ("I'll get back to you") and no "is up" ("link is UP but still no traffic" is the symptom itself).
_WORKED = re.compile(
    r"\b(?:is|are|it'?s|came|comes?)\s+back\b|\bback\s+(?:up|online|to normal)\b"
    r"|\b(?:fixed|worked|works now|working again|solved|resolved)\b",
    re.IGNORECASE,
)
_FAILED = re.compile(
    r"still down|still no\b|no traffic|still (?:0|zero)\b|didn'?t (?:work|help)|did not (?:work|help)|doesn'?t work"
    r"|not working|not (?:fixed|resolved|solved)|no change|no difference|no luck|\bnope\b"
    r"|still the same|same as before|same problem",
    re.IGNORECASE,
)


def _call_llm(system: str, user: str, *, thread_id: str | None = None, sim_time: datetime | None = None, validate=None) -> str:
    """The one LLM call of the loop (critic role). Tests replace this function."""
    from . import llm  # lazy: tests never touch the LLM layer

    raw, _traces = llm.complete_traced(
        system, user, json_mode=True, schema=_SCHEMA, purpose="judge", thread_id=thread_id,
        sim_time=sim_time, validate=validate, role="critic",
    )
    return raw


def _clip(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MAX_QUOTE else text[: MAX_QUOTE - 1].rstrip() + "…"


def heuristic(messages: list) -> tuple[str, str, str, Any] | None:
    """(outcome, quote, reason, message) from the latest message that says something about the result, else None.
    Failure phrases are read first, and taken out before looking for success words ("not fixed" is no success).
    A message that says both ("port 1 is back, still no traffic on port 2") is unclear: None."""
    for m in reversed(messages):
        failed = bool(_FAILED.search(m.text))
        worked = bool(_WORKED.search(_FAILED.sub(" ", m.text)))
        if failed and worked:
            return None
        if failed:
            return "failed", _clip(m.text), "keyword match: the message reports no improvement", m
        if worked:
            return "worked", _clip(m.text), "keyword match: the message reports the problem is gone", m
    return None


def _norm(s: str) -> str:
    return " ".join(s.lower().split())


def _decide(app, assertion, announce: str, messages: list, sim_time) -> tuple[str, str, str, str, Any] | None:
    """Blocking. Returns (outcome, quote, reason, method, message) or None for unclear."""
    import json

    user = json.dumps(
        {
            "applied_advice": {"id": assertion.id, "summary": assertion.summary, "action": assertion.action, "avoid": assertion.avoid},
            "agent_message": announce,
            "technician_messages": [{"seq": m.seq, "author": m.author, "text": m.text} for m in messages],
        },
        ensure_ascii=False,
    )
    try:
        if not config.llm_configured():
            raise RuntimeError("no LLM key")  # skip the call: the heuristic decides
        raw = _call_llm(SYSTEM, user, thread_id=app.thread_id, sim_time=sim_time, validate=OutcomeVerdict.model_validate_json)
        v = OutcomeVerdict.model_validate_json(raw)
        if v.outcome == "unclear":
            return None
        owner = next((m for m in messages if v.quote and _norm(v.quote) in _norm(m.text)), None)
        if owner is None:
            raise ValueError("quote is not verbatim")
        return v.outcome, _clip(v.quote), v.reason or "decided by the model", "llm", owner
    except Exception as e:  # noqa: BLE001 - no LLM, bad answer: the heuristic takes over
        log.info("outcome LLM unavailable (%s), using the heuristic", e)
    h = heuristic(messages)
    if h is None:
        return None
    outcome, quote, reason, msg = h
    return outcome, quote, reason, "heuristic", msg


# ---------------------------------------------------------------- applying it (one ledger, one rule)


def settle(
    wb: Dashboard, a, o, *, thread_id: str, job_id: str, author: str | None = None, role: str | None = None,
    source_ref: SourceRef | None = None, reason: str = "", method: str = "",
) -> None:
    """The effects of ONE freshly recorded outcome (`o` is already in `a.outcomes`), applied once, never again.
    failed: confidence x0.7 and a flag. worked from a human (`author`) and no failure in the ledger: trust verified
    with the human's words, the human added to confirmed_by (stated_by is kept), thread added as a source. worked with a failure in the ledger: mixed evidence, trust is
    not upgraded. worked from observation: trust unchanged. A rule is never dropped."""
    from .mvp import feedback
    from .dashboard.contracts import ReviewFlag

    kind, detail = "judge_decision", f"{reason} ({method})" if reason else method
    who = f"{author}: “{o.quote}”" if author and o.quote else f"observed: {o.evidence}"
    if not o.worked:
        a.confidence = round(a.confidence * FAILED_CONFIDENCE_FACTOR, 3)
        text = (
            f"Did not help in the field: '{a.topic}' on {o.entity}, so the system trusts it less "
            f"({round(a.confidence * 100)}%). {who}"
        )
        kind = "low_confidence"
    elif feedback.track_record(a).failed:
        tr = feedback.track_record(a)
        text = (
            f"Mixed evidence: '{a.topic}' worked on {o.entity} but failed {tr.failed} time(s) elsewhere, "
            f"so its trust level is not upgraded. {who}"
        )
    elif author:
        # The technician confirms; the expert who stated the rule stays its author (docs/backend-review.md, finding 4).
        a.trust.add_confirmation(Trust(level="verified", stated_by=author, role=role or "", evidence=o.quote or o.evidence))
        a.trust.evidence = o.quote or o.evidence  # the latest field report is the evidence, even if already verified
        if source_ref is not None and not any(s.file == source_ref.file and set(source_ref.seq) <= set(s.seq) for s in a.sources):
            a.sources.append(source_ref)
        text = f"Confirmed in the field: '{a.topic}' worked on {o.entity}. {who}"
    else:
        return  # observed success: the track record counts it, nobody's word to upgrade trust with
    wb.add_flag(
        ReviewFlag(
            id="", kind=kind, thread_id=thread_id, job_id=job_id, assertion_id=a.id, item_topic=a.topic, message=text,
            detail=detail, created_at=datetime.now(),
        ),
        refresh=True,
    )


def _apply(wb: Dashboard, ctx: HookContext, app, outcome: str, quote: str, reason: str, method: str, msg) -> None:
    from .mvp import feedback

    a = wb.store.assertions.get(app.assertion_id)
    when = wb.now()
    if a is not None:
        rec = feedback.record(
            a, app.entity_id, when, {}, worked=outcome == "worked", source="thread", application_id=app.id, quote=quote
        )
        if rec is not None:  # None: this application is already in the ledger, it is never counted twice
            rec.evidence = f"{msg.author}: {reason}"
            settle(
                wb, a, rec, thread_id=ctx.thread.id, job_id=ctx.job.id, author=msg.author, role=msg.role,
                source_ref=SourceRef(source=ctx.thread.source, file=ctx.thread.id, seq=[msg.seq]), reason=reason, method=method,
            )
            ctx.job.events.append(f"outcome {outcome} for {a.id} on {app.entity_id} ({method})")
    wb.update_application(
        app.id, outcome=outcome, outcome_quote=quote, outcome_reason=reason, outcome_at=when, method=method
    )


def record_observation(wb: Dashboard, a, entity_id: str, at: datetime, after: dict, worked: bool | None):
    """POST /agent/outcome: record through the same ledger and settle the same effects. A pending application of
    this assertion and entity is the same real event: it is resolved here (method "observation"), so a later
    reply in its thread does not count it again."""
    from .mvp import feedback

    entity = wb.store.resolve(entity_id)
    apps = [
        x for x in wb.applications.values()
        if x.assertion_id == a.id and x.outcome == "pending" and wb.store.resolve(x.entity_id) == entity
    ]
    rec = feedback.record(a, entity, at, after, worked=worked, application_id=apps[0].id if apps else None)
    if rec is None:
        return None
    settle(wb, a, rec, thread_id=apps[0].thread_id if apps else "agent", job_id="", reason=rec.evidence, method="observation")
    for x in apps:
        wb.update_application(
            x.id, outcome="worked" if rec.worked else "failed", outcome_quote=None, outcome_reason=rec.evidence,
            outcome_at=at, method="observation",
        )
    return rec


def _restore_sources(ctx: HookContext, worked: list) -> None:
    """A job removes its thread's sources before storing. Put back the source of an outcome already decided
    (no LLM call, nothing is decided again)."""
    for app in worked:
        a = ctx.wb.store.assertions.get(app.assertion_id)
        msg = next((m for m in ctx.thread.messages if m.author != OPS_NAME and app.outcome_quote and _norm(app.outcome_quote) in _norm(m.text)), None)
        if a is not None and msg is not None and not any(s.file == ctx.thread.id for s in a.sources):
            a.sources.append(SourceRef(source=ctx.thread.source, file=ctx.thread.id, seq=[msg.seq]))


async def after_store(ctx: HookContext) -> None:
    """Decide the pending applications of the processed thread. Never raises."""
    wb = ctx.wb
    if not wb.settings.use_outcome_loop:
        return
    mine = [x for x in wb.applications.values() if x.thread_id == ctx.thread.id]
    _restore_sources(ctx, [x for x in mine if x.outcome == "worked"])
    pending = [x for x in mine if x.outcome == "pending"]
    if not pending:
        return  # no pending application: no LLM call, nothing touched
    for app in pending:
        try:
            msgs = ctx.thread.messages
            announce = next((m.text for m in msgs if m.seq == app.message_seq), "")
            humans = [
                m for m in msgs
                if m.author != OPS_NAME and (m.seq > app.message_seq if app.message_seq is not None else m.sent_at > app.applied_at)
            ]
            a = wb.store.assertions.get(app.assertion_id)
            if not humans or a is None:
                continue
            decided = await asyncio.to_thread(_decide, app, a, announce, humans, wb.now())
            if decided is not None:
                _apply(wb, ctx, app, *decided)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - the loop must never block a job
            ctx.job.notes.append(f"outcome loop failed for {app.id} ({type(e).__name__}: {e})")
            log.warning("outcome loop failed for %s: %s", app.id, e)


def drop_agent_items(ctx: HookContext) -> list[ExtractedItem] | None:
    """The agent's own announcement is not human knowledge: drop items that only cite its messages."""
    ops = {m.seq for m in ctx.thread.messages if m.author == OPS_NAME}
    if not ops:
        return None
    kept = [i for i in ctx.items if not (i.cited_seq and set(i.cited_seq) <= ops) and i.stated_by != OPS_NAME]
    if len(kept) == len(ctx.items):
        return None
    ctx.job.notes.append(f"ignored {len(ctx.items) - len(kept)} item(s) taken from the ops agent's own messages")
    return kept


def install() -> None:
    from .dashboard.processor import register_hook

    register_hook("after_understand", drop_agent_items)
    register_hook("after_store", after_store)
