"""Loop v2, lot L2: the reconcile judge.

After the store step, one LLM call per new assertion compares it with the neighbours already in the store
(same entities, class or site, by binding, never by topic slug) and says supports | contradicts | supersedes |
unrelated for each. The verdicts are applied deterministically, with no human step. If the judge or the LLM fails,
nothing changes and lifecycle.reconcile still runs afterwards as before: a job is never blocked.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


from .models import TRUST_RANK, ContextAssertion
from .store import ContextStore
from .dashboard.contracts import JudgeVerdict, ReviewFlag
from .dashboard.processor import agents_quiet

log = logging.getLogger(__name__)

MAX_CANDIDATES = 8

SYSTEM = """You are the reconcile judge of a telecom operations knowledge base. Humans share operational knowledge \
in chats and emails; each piece is stored as an assertion with a scope (network elements, a class of elements, a \
site) and a time. You get ONE new assertion and a list of existing candidate assertions. For EACH candidate decide \
how the new assertion relates to it:
- "supersedes": the new assertion makes the candidate obsolete or wrong from now on (a firmware fix removes the need \
for a workaround, a key or lock moved, a rule was replaced). The candidate must be older and cover the same situation.
- "contradicts": both claim to be valid now but give different, incompatible advice or facts (two experts disagree). \
Neither is obsolete.
- "supports": same knowledge confirmed or repeated (same scope, same advice or fact), for example a later \
confirmation by another person.
- "unrelated": anything else, including the same equipment but a different subject.
Judge the meaning of the text, not the topic labels or ids, which are unreliable. When unsure answer "unrelated". \
Give a short plain-language reason for each. Answer with JSON only: \
{"verdicts": [{"other_id": "<candidate id>", "verdict": "...", "reason": "..."}]} with one entry per candidate."""


class _Verdict(BaseModel):
    other_id: str
    verdict: Literal["supports", "contradicts", "supersedes", "unrelated"]
    reason: str = ""


class JudgeOutput(BaseModel):
    verdicts: list[_Verdict] = Field(default_factory=list)


def parse_output(raw: str) -> JudgeOutput:
    """Validate the LLM text, tolerating a code fence or text around the JSON object."""
    text = raw.strip()
    try:
        return JudgeOutput.model_validate_json(text)
    except Exception:  # noqa: BLE001
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise
        return JudgeOutput.model_validate_json(m.group(0))


# ---------------------------------------------------------------- LLM access (monkeypatched in tests)


def _call_llm(
    system: str,
    user: str,
    schema: dict | None,
    thread_id: str | None,
    sim_time: datetime | None,
    validate: Any,
) -> str:
    from . import llm  # lazy: tests never touch the LLM layer

    raw, _traces = llm.complete_traced(
        system,
        user,
        json_mode=True,
        schema=schema,
        purpose="judge",
        thread_id=thread_id,
        sim_time=sim_time,
        validate=validate,
        role="critic",
    )
    return raw


# ---------------------------------------------------------------- candidates


def _expand(store: ContextStore, a: ContextAssertion) -> set[str]:
    """What a is about plus the classes and sites of those entities."""
    out = set(a.about)
    for ent in a.about:
        out |= {t for t, _ in store.scope_of(ent)}
    return out


def candidates(store: ContextStore, new: ContextAssertion, limit: int = MAX_CANDIDATES) -> list[ContextAssertion]:
    """Open assertions that share entities, a class or a site with new. Direct overlap ranks first."""
    mine, mine_wide = new.about, _expand(store, new)
    scored = []
    for old in store.assertions.values():
        if old.id == new.id or old.valid_to is not None or old.type == "invalidation":
            continue
        related = len(mine_wide & _expand(store, old))
        if not related:
            continue
        scored.append((len(mine & old.about), related, old.valid_from, old))
    scored.sort(key=lambda t: (t[0], t[1], t[2]), reverse=True)
    return [t[3] for t in scored[:limit]]


def _describe(a: ContextAssertion) -> dict:
    return {
        "id": a.id,
        "type": a.type,
        "summary": a.summary,
        "action": a.action,
        "avoid": a.avoid,
        "fact": a.fact,
        "conditions": [c.text for c in a.conditions],
        "scope": sorted(a.about),
        "stated_by": a.trust.stated_by,
        "trust": a.trust.level,
        "valid_from": a.valid_from.isoformat(),
    }


def _prompt(new: ContextAssertion, cands: list[ContextAssertion]) -> str:
    return json.dumps(
        {"new_assertion": _describe(new), "candidates": [_describe(c) for c in cands]}, ensure_ascii=False, indent=1
    )


_SCHEMA = JudgeOutput.model_json_schema()


# ---------------------------------------------------------------- apply


def _norm(text: str | None) -> str:
    return " ".join((text or "").lower().split())


def _same_scope_and_action(old: ContextAssertion, new: ContextAssertion) -> bool:
    return (
        old.type == new.type
        and {(b.entity, b.role) for b in old.bound_to} == {(b.entity, b.role) for b in new.bound_to}
        and _norm(old.action) == _norm(new.action)
        and _norm(old.fact) == _norm(new.fact)
    )


def _short(a: ContextAssertion, n: int = 70) -> str:
    return a.summary if len(a.summary) <= n else a.summary[: n - 1] + "..."


def apply_verdicts(
    store: ContextStore,
    new: ContextAssertion,
    cands: list[ContextAssertion],
    out: JudgeOutput,
    job,
    same_job_ids: set[str] | frozenset[str] = frozenset(),
) -> ContextAssertion:
    """Apply the verdicts. Returns the assertion that now holds new (itself, or the older one it was merged into)."""
    by_id = {c.id: c for c in cands}
    chosen: dict[str, _Verdict] = {}
    for v in out.verdicts:
        if v.other_id in by_id and v.verdict != "unrelated" and v.other_id not in chosen:
            chosen[v.other_id] = v

    def record(old, verdict, reason, event, message, flag_on=None) -> None:
        job.judge.append(
            JudgeVerdict(new_assertion_id=new.id, other_assertion_id=old.id, verdict=verdict, reason=reason)
        )
        job.events.append(f"judge: {event}")
        job.flags.append(
            ReviewFlag(
                id=f"flag_{job.id}_{len(job.flags) + 1}",
                kind="judge_decision",
                thread_id=job.thread_id,
                job_id=job.id,
                assertion_id=flag_on or new.id,
                item_topic=(old if (flag_on or new.id) == old.id else new).topic,
                message=message,
                detail=f"{new.id} vs {old.id}: {verdict}. {reason}",
                created_at=datetime.now(),
            )
        )

    # Closing and conflicts first, merging last (it removes new from the store).
    supports: list[tuple[ContextAssertion, _Verdict]] = []
    for oid, v in chosen.items():
        old = by_id[oid]
        reason = v.reason or "no reason given"
        kind = v.verdict
        if kind == "supersedes":
            safe = (
                old.valid_to is None
                and old.valid_from < new.valid_from
                and old.id not in same_job_ids  # the replacement given in the same message stays open
                and old.type != "invalidation"
                and (new.type == "invalidation" or TRUST_RANK[new.trust.level] >= TRUST_RANK[old.trust.level])
            )
            if safe:
                old.valid_to = new.valid_from
                old.closed_by = new.id
                record(
                    old,
                    "supersedes",
                    reason,
                    f"{old.id} closed at {new.valid_from:%Y-%m-%d %H:%M} by {new.id} ({new.trust.stated_by}): {reason}",
                    f'Closed an older rule: "{_short(old)}" no longer applies. Reason: {reason}',
                )
                continue
            kind = "contradicts"  # cannot close it safely: keep both open and flag
            reason = f"(judge wanted to supersede, not safe to close) {reason}"
        if kind == "contradicts":
            if old.valid_to is not None or new.valid_to is not None:
                continue
            if new.id not in old.conflicts_with:
                old.conflicts_with.append(new.id)
            if old.id not in new.conflicts_with:
                new.conflicts_with.append(old.id)
            record(
                old,
                "contradicts",
                reason,
                f"{old.id} and {new.id} disagree: both kept, flagged ({reason})",
                f'Two sources disagree: "{_short(old)}" and "{_short(new)}". Both kept open. Reason: {reason}',
            )
        elif kind == "supports":
            supports.append((old, v))

    holder = new
    for old, v in supports:
        reason = v.reason or "no reason given"
        if old.valid_to is not None:
            continue
        upgraded = TRUST_RANK[new.trust.level] > TRUST_RANK[old.trust.level]
        who = new.trust.stated_by
        if holder is new and old.id not in same_job_ids and _same_scope_and_action(old, new):
            store.merge_into(old.id, new)
            holder = old
            record(
                old,
                "supports",
                reason,
                f"{new.id} merged into {old.id} (confirmed by {who}"
                + (f", trust now {old.trust.level}" if upgraded else "")
                + f"): {reason}",
                f'Confirmed: "{_short(old)}" was confirmed by {who}'
                + (f" and is now {old.trust.level}" if upgraded else "")
                + f". Reason: {reason}",
                flag_on=old.id,
            )
        else:
            for src in new.sources:
                if src not in old.sources:
                    old.sources.append(src)
            old.trust.add_confirmation(new.trust)  # the original author stays; new's author confirms
            record(
                old,
                "supports",
                reason,
                f"{new.id} supports {old.id}" + (f", trust now {old.trust.level}" if upgraded else "") + f": {reason}",
                f'Supported: "{_short(old)}" is backed by a new message from {who}'
                + (f" and is now {old.trust.level}" if upgraded else "")
                + f". Reason: {reason}",
                flag_on=old.id,
            )
    return holder


# ---------------------------------------------------------------- hook


async def judge_new_assertions(ctx) -> None:
    """after_store hook body. Never raises for an LLM or parsing problem."""
    if ctx.settings is None or not ctx.settings.use_judge or not ctx.new_assertions:
        return
    if agents_quiet(ctx):
        return  # quiet: no key (scripted mode) or seed bootstrap (no extra LLM calls)
    store, job = ctx.wb.store, ctx.job
    same_job_ids = {a.id for a in ctx.new_assertions}
    judged: set[frozenset[str]] = set()
    try:
        sim_time = ctx.wb.now()
    except Exception:  # noqa: BLE001
        sim_time = None
    for new in list(ctx.new_assertions):
        if new.id not in store.assertions:
            continue
        cands = [c for c in candidates(store, new) if frozenset((new.id, c.id)) not in judged]
        if not cands:
            continue
        try:
            raw = await asyncio.to_thread(
                _call_llm, SYSTEM, _prompt(new, cands), _SCHEMA, job.thread_id, sim_time, parse_output
            )
            out = parse_output(raw)
        except Exception as e:  # noqa: BLE001 - keep the lifecycle behaviour, never block the job
            job.notes.append(f"judge skipped for {new.id} ({type(e).__name__}: {str(e)[:120]})")
            log.warning("judge failed for %s: %s", new.id, e)
            continue
        judged |= {frozenset((new.id, c.id)) for c in cands}
        holder = apply_verdicts(store, new, cands, out, job, same_job_ids)
        if holder is not new:
            # new was folded into an older assertion: the rest of the job (lifecycle) must not see it.
            ctx.new_assertions[:] = [a for a in ctx.new_assertions if a.id != new.id]
            ids = [holder.id if i == new.id else i for i in job.assertion_ids]
            job.assertion_ids = list(dict.fromkeys(ids))


def install() -> None:
    from .dashboard.processor import register_hook

    register_hook("after_store", judge_new_assertions)
