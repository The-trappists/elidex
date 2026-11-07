"""REST API under /api (see docs/workbench.md for the table)."""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from .. import agent as agent_mod
from .. import config, llm_check
from ..mvp import guard
from ..models import Message
from . import generator, persistence
from .contracts import (
    AssertionEdit,
    AgentRunBody,
    AgentRunResult,
    ClockBody,
    ClockState,
    GenerateBody,
    GuardBody,
    Incident,
    IncidentSpec,
    LiveThread,
    LlmCall,
    LlmCheckResult,
    NewThreadBody,
    OperatorEdit,
    Persona,
    PipelineJob,
    PostMessageBody,
    RerunBody,
    ResetBody,
    ReviewFlag,
    Scenario,
    ScenarioRun,
    Settings,
    SettingsPatch,
    SpeedBody,
    StateSnapshot,
    TopologyLink,
    WbElement,
    WbSite,
)
from .state import Workbench

router = APIRouter(prefix="/api")


def get_wb(request: Request) -> Workbench:
    return request.app.state.wb


def emit_clock(wb: Workbench) -> ClockState:
    state = wb.clock.state()
    wb.emit("clock", state)
    return state


# ---------------------------------------------------------------- basics


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/state")
async def state(request: Request) -> StateSnapshot:
    return get_wb(request).snapshot()


@router.get("/stream")
async def stream(request: Request) -> StreamingResponse:
    wb = get_wb(request)
    queue = wb.bus.subscribe()

    async def events():
        last_beat = time.monotonic()
        try:
            yield ": connected\n\n"
            while not await request.is_disconnected() and not getattr(request.app.state, "closing", False):
                try:
                    ev = await asyncio.wait_for(queue.get(), timeout=1.0)
                    yield f"data: {ev.model_dump_json()}\n\n"
                    last_beat = time.monotonic()
                except asyncio.TimeoutError:
                    if time.monotonic() - last_beat >= 15:
                        yield ": keepalive\n\n"
                        last_beat = time.monotonic()
        finally:
            wb.bus.unsubscribe(queue)

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(events(), media_type="text/event-stream", headers=headers)


# ---------------------------------------------------------------- clock and scenarios


@router.post("/sim/start")
async def sim_start(request: Request) -> ClockState:
    wb = get_wb(request)
    wb.clock.start()
    return emit_clock(wb)


@router.post("/sim/pause")
async def sim_pause(request: Request) -> ClockState:
    wb = get_wb(request)
    wb.clock.pause()
    return emit_clock(wb)


@router.post("/sim/speed")
async def sim_speed(body: SpeedBody, request: Request) -> ClockState:
    wb = get_wb(request)
    try:
        wb.clock.set_speed(body.speed)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return emit_clock(wb)


@router.post("/sim/clock")
async def sim_clock(body: ClockBody, request: Request) -> ClockState:
    wb = get_wb(request)
    wb.clock.set(body.at)
    return emit_clock(wb)


@router.get("/sim/scenarios")
async def list_scenarios(request: Request) -> list[Scenario]:
    return list(get_wb(request).scenarios.values())


@router.post("/sim/scenarios")
async def upsert_scenario(body: Scenario, request: Request) -> Scenario:
    get_wb(request).upsert_scenario(body)
    return body


@router.delete("/sim/scenarios/{scenario_id}", status_code=204)
async def delete_scenario(scenario_id: str, request: Request) -> Response:
    try:
        get_wb(request).delete_scenario(scenario_id)
    except KeyError:
        raise HTTPException(404, f"unknown scenario {scenario_id}") from None
    return Response(status_code=204)


@router.post("/sim/scenarios/{scenario_id}/run")
async def run_scenario(scenario_id: str, request: Request) -> ScenarioRun:
    try:
        return request.app.state.simulator.start_scenario(scenario_id)
    except KeyError:
        raise HTTPException(404, f"unknown scenario {scenario_id}") from None


@router.post("/sim/generate")
async def generate(body: GenerateBody, request: Request) -> Scenario:
    wb = get_wb(request)
    if not config.llm_configured():
        raise HTTPException(503, "No LLM configured: set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in .env")
    try:
        scenario = await asyncio.to_thread(generator.generate_scenario, wb, body.entity_id, body.hint)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    wb.upsert_scenario(scenario)
    return scenario


# ---------------------------------------------------------------- inventory and people


def _crud(path: str, kind: str, model: type, label: str) -> None:
    async def create(body, request: Request):
        wb = get_wb(request)
        if body.id in getattr(wb, kind):
            raise HTTPException(409, f"{label} {body.id} already exists")
        body.origin = "manual"
        wb.upsert_item(kind, body)
        return body

    async def update(item_id: str, body, request: Request):
        wb = get_wb(request)
        old = getattr(wb, kind).get(item_id)
        if old is None:
            raise HTTPException(404, f"unknown {label} {item_id}")
        body.id, body.origin = item_id, old.origin
        wb.upsert_item(kind, body)
        return body

    async def delete(item_id: str, request: Request) -> Response:
        try:
            get_wb(request).delete_item(kind, item_id)
        except KeyError:
            raise HTTPException(404, f"unknown {label} {item_id}") from None
        return Response(status_code=204)

    # the module uses postponed annotations, so give FastAPI the real model type
    create.__annotations__["body"] = update.__annotations__["body"] = model
    router.post(f"/{path}", name=f"create_{kind}")(create)
    router.put(f"/{path}/{{item_id}}", name=f"update_{kind}")(update)
    router.delete(f"/{path}/{{item_id}}", status_code=204, name=f"delete_{kind}")(delete)


_crud("elements", "elements", WbElement, "element")
_crud("sites", "sites", WbSite, "site")
_crud("links", "links", TopologyLink, "link")
_crud("personas", "personas", Persona, "persona")


# ---------------------------------------------------------------- threads and incidents


def _thread(wb: Workbench, thread_id: str) -> LiveThread:
    t = wb.threads.get(thread_id)
    if t is None:
        raise HTTPException(404, f"unknown thread {thread_id}")
    return t


@router.post("/threads")
async def create_thread(body: NewThreadBody, request: Request) -> LiveThread:
    return get_wb(request).create_thread(body.source, body.subject, body.participants, "manual")


@router.post("/threads/{thread_id:path}/messages")
async def post_message(thread_id: str, body: PostMessageBody, request: Request) -> Message:
    wb = get_wb(request)
    _thread(wb, thread_id)
    persona = wb.persona(body.persona_id) if body.persona_id else None
    if body.persona_id and persona is None:
        raise HTTPException(422, f"unknown persona {body.persona_id}")
    author = body.author or (persona.name if persona else None)
    if not author:
        raise HTTPException(422, "persona_id or author is required")
    return wb.post_message(thread_id, author, body.text, role=body.role or (persona.role if persona else None), persona_id=body.persona_id)


@router.post("/threads/{thread_id:path}/process", status_code=202)
async def process_thread(thread_id: str, request: Request) -> dict:
    wb = get_wb(request)
    _thread(wb, thread_id)
    wb.request_processing(thread_id, immediate=True)
    return {"status": "accepted"}


@router.delete("/threads/{thread_id:path}", status_code=204)
async def delete_thread(thread_id: str, request: Request) -> Response:
    wb = get_wb(request)
    _thread(wb, thread_id)
    wb.delete_thread(thread_id)
    return Response(status_code=204)


@router.post("/incidents")
async def create_incident(body: IncidentSpec, request: Request) -> Incident:
    return get_wb(request).open_incident(body, "manual")


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(incident_id: str, request: Request) -> Incident:
    try:
        return get_wb(request).resolve_incident(incident_id)
    except KeyError:
        raise HTTPException(404, f"unknown incident {incident_id}") from None


@router.delete("/incidents/{incident_id}", status_code=204)
async def delete_incident(incident_id: str, request: Request) -> Response:
    try:
        get_wb(request).delete_incident(incident_id)
    except KeyError:
        raise HTTPException(404, f"unknown incident {incident_id}") from None
    return Response(status_code=204)


# ---------------------------------------------------------------- context, guard, agent


@router.get("/context/{entity_id}")
async def context(entity_id: str, request: Request, at: datetime | None = None, include_expired: bool = False) -> list[dict]:
    wb = get_wb(request)
    hits = wb.store.get_context(entity_id, at=at or wb.now(), include_expired=include_expired)
    return [{"matched_via": h.matched_via, **h.assertion.model_dump(mode="json")} for h in hits]


@router.delete("/assertions/{assertion_id}", status_code=204)
async def delete_assertion(assertion_id: str, request: Request) -> Response:
    try:
        get_wb(request).delete_assertion(assertion_id)
    except KeyError:
        raise HTTPException(404, f"unknown assertion {assertion_id}") from None
    return Response(status_code=204)


@router.patch("/assertions/{assertion_id}")
async def edit_assertion(assertion_id: str, body: OperatorEdit, request: Request) -> dict:
    """Operator override. Returns {"assertion": ContextAssertion, "edit": AssertionEdit}."""
    wb = get_wb(request)
    try:
        edit = wb.edit_assertion(assertion_id, body)
    except KeyError:
        raise HTTPException(404, f"unknown assertion {assertion_id}") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return {"assertion": wb.store.assertions[assertion_id].model_dump(mode="json"), "edit": edit.model_dump(mode="json")}


@router.get("/assertions/{assertion_id}/history")
async def assertion_history(assertion_id: str, request: Request) -> list[AssertionEdit]:
    try:
        return get_wb(request).assertion_history(assertion_id)
    except KeyError:
        raise HTTPException(404, f"unknown assertion {assertion_id}") from None


@router.post("/assertions/{assertion_id}/undo")
async def undo_assertion_edit(assertion_id: str, request: Request) -> dict:
    """Undo the latest edit not undone yet. Returns {"assertion": ContextAssertion, "edit": AssertionEdit (undone)}."""
    wb = get_wb(request)
    try:
        edit = wb.undo_edit(assertion_id)
    except KeyError:
        raise HTTPException(404, f"unknown assertion {assertion_id}") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    return {"assertion": wb.store.assertions[assertion_id].model_dump(mode="json"), "edit": edit.model_dump(mode="json")}


# ---------------------------------------------------------------- review loop (lot L4)


@router.get("/review/flags")
async def review_flags(
    request: Request, dismissed: bool | None = None, kind: str | None = None, thread_id: str | None = None
) -> list[ReviewFlag]:
    """Newest first. Filters are optional."""
    flags = [
        f for f in get_wb(request).flags.values()
        if (dismissed is None or f.dismissed == dismissed)
        and (kind is None or f.kind == kind)
        and (thread_id is None or f.thread_id == thread_id)
    ]
    return sorted(flags, key=lambda f: (f.created_at, f.id), reverse=True)


def _set_dismissed(request: Request, flag_id: str, value: bool) -> ReviewFlag:
    try:
        return get_wb(request).set_flag_dismissed(flag_id, value)
    except KeyError:
        raise HTTPException(404, f"unknown flag {flag_id}") from None


@router.post("/review/flags/{flag_id}/dismiss")
async def dismiss_flag(flag_id: str, request: Request) -> ReviewFlag:
    return _set_dismissed(request, flag_id, True)


@router.post("/review/flags/{flag_id}/undismiss")
async def undismiss_flag(flag_id: str, request: Request) -> ReviewFlag:
    return _set_dismissed(request, flag_id, False)


@router.post("/jobs/{job_id}/rerun", status_code=202)
async def rerun_job(job_id: str, body: RerunBody, request: Request) -> PipelineJob:
    """Run the job's thread again from link (items: body.items, else the job's own items; no LLM call).
    from_stage="store" is treated as "link": the linker is deterministic and cheap, so nothing is cached.
    Returns the new job once it has finished."""
    wb = get_wb(request)
    if body.model:
        raise HTTPException(422, "replay with another model is not supported yet: leave `model` empty")
    old = wb.jobs.get(job_id)
    if old is None:
        raise HTTPException(404, f"unknown job {job_id}")
    if old.thread_id not in wb.threads:
        raise HTTPException(404, f"thread {old.thread_id} no longer exists")
    items = body.items if body.items is not None else old.items
    await wb.processor.process(old.thread_id, items=items)
    return wb.jobs[wb.threads[old.thread_id].last_job_id]


def _verdict(v: guard.Verdict) -> dict:
    return {"decision": v.decision, "action": v.action, "steps": v.steps, "reasons": v.reasons}


@router.post("/guard")
async def guard_check(body: GuardBody, request: Request) -> dict:
    wb = get_wb(request)
    v = guard.check(wb.store, body.action, body.entity_id, at=body.at or wb.now(), observations=body.observations)
    return _verdict(v)


@router.post("/agent/run")
async def agent_run(body: AgentRunBody, request: Request) -> AgentRunResult:
    wb = get_wb(request)
    case = agent_mod.Case(
        id="adhoc",
        title="Ad hoc",
        entity_id=body.entity_id,
        at=body.at or wb.now(),
        description=body.description,
        observations=body.observations,
        planned_action=body.planned_action,
    )
    kwargs = dict(use_conditions=wb.settings.use_conditions, use_guard=wb.settings.use_guard, use_llm=body.use_llm)
    try:
        if body.use_llm:
            report = await asyncio.to_thread(agent_mod.run_agent, wb.store, case, **kwargs)
        else:
            report = agent_mod.run_agent(wb.store, case, **kwargs)
    except Exception as e:  # noqa: BLE001 - LLM errors
        if not body.use_llm:
            raise
        raise HTTPException(502, f"LLM call failed: {e}") from e
    return AgentRunResult(
        recommendation=report.recommendation,
        hits=[{"matched_via": h.matched_via, **h.assertion.model_dump(mode="json")} for h in report.hits],
        skipped=[{"assertion_id": h.assertion.id, "reason": reason} for h, reason in report.skipped],
        verdict=_verdict(report.verdict) if report.verdict else None,
    )


# ---------------------------------------------------------------- knowledge graph (see docs/knowledge-graph.md)


def _kg(request: Request):
    """The graph, rebuilt from the live store and the live threads (a view: cheap at this size).

    A thread without messages has no start time yet, so it is left out until its first message.
    """
    from ..graph import KnowledgeGraph

    wb = get_wb(request)
    threads = [t.to_thread() for t in wb.threads.values() if t.messages]
    return wb, KnowledgeGraph.build(wb.store, threads)


@router.get("/graph")
async def graph_elements(request: Request, at: datetime | None = None) -> dict:
    """The whole knowledge graph as Cytoscape elements, for the Graph page.

    Every node is returned; assertions carry `valid` (in force at `at`, default sim now) so the UI
    can fade or hide them. Message text is cut to keep the payload small.
    """
    from ..graph.export import to_cytoscape

    wb, kg = _kg(request)
    when = at or wb.now()
    els = to_cytoscape(kg.g)
    for el in els:
        d = el["data"]
        if el["group"] != "nodes":
            continue
        if d.get("kind") == "Assertion":
            d["valid"] = kg._valid(d["id"], when)
        elif d.get("kind") == "Message":
            text = kg.g.nodes[d["id"]].get("text") or ""
            d["text"] = text if len(text) <= 400 else text[:400] + "…"
    return {"at": when.isoformat(), "elements": els}


@router.get("/graph/stats")
async def graph_stats(request: Request) -> dict:
    return _kg(request)[1].stats()


@router.get("/graph/provenance/{assertion_id}")
async def graph_provenance(assertion_id: str, request: Request) -> list[dict]:
    return _kg(request)[1].provenance(assertion_id)


@router.get("/graph/reach/{assertion_id}")
async def graph_reach(assertion_id: str, request: Request) -> dict:
    return _kg(request)[1].reach(assertion_id)


@router.get("/graph/experts")
async def graph_experts(request: Request, entity_id: str | None = None, at: datetime | None = None) -> list[dict]:
    wb, kg = _kg(request)
    return kg.experts(entity_id, at=at or wb.now())


@router.get("/graph/timeline/{entity_id}")
async def graph_timeline(entity_id: str, request: Request, at: datetime | None = None) -> list[dict]:
    wb, kg = _kg(request)
    return kg.timeline(entity_id, at=at or wb.now())


@router.get("/graph/mentions/{entity_id}")
async def graph_mentions(entity_id: str, request: Request) -> list[dict]:
    return _kg(request)[1].mentions(entity_id)


# ---------------------------------------------------------------- data, settings, slack


@router.post("/data/reset", status_code=204)
async def data_reset(body: ResetBody, request: Request) -> Response:
    get_wb(request).reset(body.mode)
    return Response(status_code=204)


@router.delete("/data/generated")
async def data_generated(request: Request) -> dict:
    return {"removed": get_wb(request).remove_generated()}


@router.get("/data/export")
async def data_export(request: Request) -> JSONResponse:
    data = persistence.state_to_dict(get_wb(request))
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="workbench-state.json"'})


@router.post("/data/import", status_code=204)
async def data_import(request: Request) -> Response:
    try:
        data = await request.json()
        get_wb(request).replace_state(data)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"invalid export file: {e}") from e
    return Response(status_code=204)


@router.get("/settings")
async def get_settings(request: Request) -> Settings:
    wb = get_wb(request)
    wb.refresh_readonly_settings()
    return wb.settings


@router.put("/settings")
async def put_settings(body: SettingsPatch, request: Request) -> Settings:
    return get_wb(request).update_settings(body)


@router.get("/slack/status")
async def slack_status(request: Request) -> dict:
    slack = getattr(request.app.state, "slack", None)
    if slack is not None:
        try:
            return slack.status()
        except Exception:  # noqa: BLE001 - bridge not finished
            pass
    return {"connected": False, "channel": None, "error": None}


# ---------------------------------------------------------------- LLM trace


def all_llm_calls(wb: Workbench) -> list[LlmCall]:
    """In-memory calls merged with the JSONL file, deduplicated by id, newest first."""
    by_id = {c.id: c for c in persistence.read_llm_calls(config.WORKBENCH_LLM_CALLS_FILE)}
    by_id.update({c.id: c for c in wb.llm_calls})
    return sorted(by_id.values(), key=lambda c: c.ts, reverse=True)


@router.get("/llm/calls")
async def llm_calls(request: Request, purpose: str | None = None, thread_id: str | None = None, limit: int = 100) -> list[LlmCall]:
    calls = all_llm_calls(get_wb(request))
    if purpose:
        calls = [c for c in calls if c.purpose == purpose]
    if thread_id:
        calls = [c for c in calls if c.thread_id == thread_id]
    return calls[:limit]


@router.get("/llm/calls/{call_id}")
async def llm_call(call_id: str, request: Request) -> LlmCall:
    call = next((c for c in all_llm_calls(get_wb(request)) if c.id == call_id), None)
    if call is None:
        raise HTTPException(404, f"unknown LLM call {call_id}")
    return call


@router.post("/llm/check")
async def llm_check_run() -> list[LlmCheckResult]:
    results = await asyncio.to_thread(llm_check.run_check)
    return [LlmCheckResult.model_validate(r) for r in results]


# ---------------------------------------------------------------- exports


@router.get("/export/llm-calls.jsonl")
async def export_llm_calls() -> Response:
    path = config.WORKBENCH_LLM_CALLS_FILE
    body = path.read_text(encoding="utf-8") if path.exists() else ""
    headers = {"Content-Disposition": 'attachment; filename="llm_calls.jsonl"'}
    return Response(body, media_type="application/x-ndjson", headers=headers)


def _fmt(t: datetime | None) -> str:
    return f"{t:%Y-%m-%d %H:%M:%S}" if t else "-"


def thread_transcript(wb: Workbench, thread: LiveThread, calls: dict[str, LlmCall]) -> list[str]:
    out = [f"## {thread.subject or thread.id}", ""]
    out.append(f"- id: `{thread.id}`")
    out.append(f"- source: {thread.source}; origin: {thread.origin}; scenario: {thread.scenario_id or '-'}; status: {thread.status}")
    out += ["", "### Messages", ""]
    for m in thread.messages:
        role = f" ({m.role})" if m.role else ""
        out.append(f"- [seq {m.seq}] {_fmt(m.sent_at)} **{m.author}**{role}: {m.text}")
    job = wb.jobs.get(thread.last_job_id or "") or next((j for j in reversed(wb.jobs.values()) if j.thread_id == thread.id), None)
    if job is None:
        return out + ["", "_Not processed yet._", ""]
    out += ["", f"### Pipeline job {job.id}", "", f"- extractor: {job.extractor or '-'}"]
    out += [f"- {s.stage}: {s.status}" + (f" ({s.detail})" if s.detail else "") + (f", {s.duration_ms} ms" if s.duration_ms is not None else "") for s in job.stages]
    if job.error:
        out.append(f"- ERROR: {job.error}")
    for cid in job.llm_call_ids:
        c = calls.get(cid)
        out += ["", f"#### LLM call {cid}"]
        if c is None:
            out.append("_not found in the trace_")
            continue
        out += [f"- model: {c.model} ({c.provider}), latency: {c.latency_ms} ms, json mode: {c.json_mode}, parsed ok: {c.parsed_ok}"]
        if c.error:
            out.append(f"- error: {c.error}")
        out += ["", "```json", c.raw_response or "", "```"]
    out += ["", "#### Extracted items", ""]
    for i in job.items:
        sc = i.scope
        scope = f"instances {sc.instance_ids}, sites {sc.site_ids}, class {sc.element_class.class_id() if sc.element_class else None}, trigger {sc.trigger}"
        out.append(f"- **{i.type}** `{i.topic}`: {i.summary} (trust {i.trust_level}, by {i.stated_by}, confidence {i.confidence}, cited seq {i.cited_seq}; scope: {scope})")
    if not job.items:
        out.append("- none")
    out += ["", "#### Linker notes", ""] + ([f"- {n}" for n in job.notes] or ["- none"])
    out += ["", "#### Assertions created or merged", ""]
    for aid in job.assertion_ids:
        a = wb.store.assertions.get(aid)
        if a is None:
            out.append(f"- {aid} (since removed)")
            continue
        binds = ", ".join(f"{b.entity} [{b.role}]" for b in a.bound_to)
        valid = f"{_fmt(a.valid_from)} to {_fmt(a.valid_to) if a.valid_to else 'open'}"
        out.append(f"- **{aid}** {a.type} `{a.topic}`: {a.summary}  \n  bound to: {binds}; valid: {valid}; trust {a.trust.level}")
    if not job.assertion_ids:
        out.append("- none")
    if job.removed_assertion_ids:
        out += ["", "Removed on re-processing: " + ", ".join(job.removed_assertion_ids)]
    out += ["", "#### Lifecycle events", ""] + ([f"- {e}" for e in job.events] or ["- none"])
    if job.eval:
        e = job.eval
        out += ["", "#### Eval against expected", "", f"- matched: {e.matched}", f"- missed: {e.missed}", f"- unexpected: {e.unexpected}"]
        out += [f"- binding diff: {d}" for d in e.binding_diffs]
    return out + [""]


@router.get("/export/transcript.md")
async def export_transcript(request: Request, thread_id: str | None = None) -> PlainTextResponse:
    wb = get_wb(request)
    if thread_id:
        threads = [_thread(wb, thread_id)]
    else:
        threads = sorted(wb.threads.values(), key=lambda t: t.created_at)
    calls = {c.id: c for c in all_llm_calls(wb)}
    lines = ["# Workbench transcript", "", f"Exported at sim time {_fmt(wb.now())}", ""]
    for t in threads:
        lines += thread_transcript(wb, t, calls)
    if not threads:
        lines.append("_No threads._")
    return PlainTextResponse("\n".join(lines), media_type="text/markdown; charset=utf-8")


@router.get("/export/session.json")
async def export_session(request: Request) -> JSONResponse:
    wb = get_wb(request)
    data = persistence.state_to_dict(wb)
    data["jobs"] = [j.model_dump(mode="json") for j in wb.jobs.values()]
    data["llm_calls"] = [c.model_dump(mode="json") for c in reversed(all_llm_calls(wb))]
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="session.json"'})
