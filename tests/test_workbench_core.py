"""Workbench core: state, processor and routes, offline (scripted extractor, seed replaced by a small builder)."""

import time
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from context_layer import config, llm
from context_layer.link import Inventory
from context_layer.listen import discover_threads
from context_layer.models import ExtractedItem, ExtractionResult, Scope
from context_layer.workbench import seed
from context_layer.workbench.app import create_app
from context_layer.workbench.contracts import LiveThread, Persona, Scenario, ScenarioMessage, WbElement, WbSite

CLASS_ID = "class:transmission_node:installed-upto-2019"
CHAT = "elisa/teams_chat.json"


def small_seed(data_dir=None) -> seed.SeedData:
    inv = Inventory.load()
    threads = []
    for t in discover_threads():
        threads.append(
            LiveThread(
                id=t.id, source=t.source, subject=t.subject, messages=t.messages,
                origin="elisa" if t.id.startswith("elisa/") else "synthetic",
                status="idle", created_at=t.started_at,
            )
        )
    return seed.SeedData(
        elements=[WbElement(**e.model_dump()) for e in inv.elements.values()],
        sites=[WbSite(**s.model_dump()) for s in inv.sites.values()],
        personas=[Persona(id="erkki", name="Erkki", role="Network Expert")],
        scenarios=[
            Scenario(
                id="scripted",
                title="Scripted",
                messages=[ScenarioMessage(persona="erkki", text="hello")],
                expected=ExtractionResult(
                    items=[
                        ExtractedItem(
                            type="fact", topic="trn-042-test-fact", summary="TRN-042 test fact",
                            scope=Scope(instance_ids=["TRN-042"]), trust_level="stated",
                            stated_by="Erkki", cited_seq=[1], confidence=0.9,
                        )
                    ]
                ),
            )
        ],
        threads=threads,
    )


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(seed, "load_seed", small_seed)
    monkeypatch.setattr(config, "WORKBENCH_LLM_CALLS_FILE", tmp_path / "llm_calls.jsonl")
    monkeypatch.setattr(config, "WORKBENCH_LLM_CACHE_FILE", tmp_path / "llm_cache.json")
    # scripted mode whatever the developer's .env says
    app = create_app(state_file=tmp_path / "state.json", background=False)
    with TestClient(app) as c:
        c.put("/api/settings", json={"extractor_mode": "scripted"})
        yield c


def wait_for(client, predicate, what, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        state = client.get("/api/state").json()
        if predicate(state):
            return state
        time.sleep(0.05)
    raise AssertionError(f"timeout waiting for {what}")


def seeded(client):
    def ok(s):
        return all(t["status"] == "processed" for t in s["threads"]) and s["threads"]

    return wait_for(client, ok, "seeded threads processed")


def rule(state):
    return [a for a in state["assertions"] if a["topic"] == "sfp-swap-forwarding-state" and a["type"] == "workaround"]


def test_state_snapshot(client):
    s = client.get("/api/state").json()
    assert {"clock", "settings", "elements", "threads", "assertions", "jobs"} <= set(s)
    assert any(e["id"] == "TRN-042" for e in s["elements"])
    assert client.get("/api/health").json() == {"status": "ok"}


def test_scripted_thread_through_the_pipeline(client):
    seeded(client)
    t = client.post("/api/threads", json={"source": "teams", "subject": "Test"}).json()
    assert t["id"].startswith("live/") and t["origin"] == "manual"
    for text in ("first on TRN-042", "second"):  # the linker binds only ids the thread names
        r = client.post(f"/api/threads/{t['id']}/messages", json={"author": "Erkki", "text": text})
        assert r.status_code == 200
    assert r.json()["seq"] == 2
    # attach the scenario's ground truth (scripted mode replays it)
    client.app.state.wb.threads[t["id"]].scenario_id = "scripted"
    assert client.post(f"/api/threads/{t['id']}/process").status_code == 202
    s = wait_for(client, lambda s: next(x for x in s["threads"] if x["id"] == t["id"])["status"] == "processed", "processed")
    job = [j for j in s["jobs"] if j["thread_id"] == t["id"]][-1]
    assert all(st["status"] in ("done", "skipped") for st in job["stages"])
    assert job["extractor"] == "scripted"
    assert len(job["assertion_ids"]) == 1
    assert "trn-042-test-fact" in {a["topic"] for a in s["assertions"]}

    # deleting the thread removes its source, and the assertion that had no other
    assert client.delete(f"/api/threads/{t['id']}").status_code == 204
    s = client.get("/api/state").json()
    assert "trn-042-test-fact" not in {a["topic"] for a in s["assertions"]}
    assert client.delete(f"/api/threads/{t['id']}").status_code == 404


def test_elisa_chat_is_bound_to_the_class_and_reprocessing_is_idempotent(client):
    s = seeded(client)
    (a,) = rule(s)
    assert (CLASS_ID, "applies_to") in {(b["entity"], b["role"]) for b in a["bound_to"]}
    assert CLASS_ID in {c["id"] for c in s["classes"]}
    n_sources = len(a["sources"])
    assert client.post(f"/api/threads/{CHAT}/process").status_code == 202
    s = wait_for(client, lambda s: len([j for j in s["jobs"] if j["thread_id"] == CHAT]) >= 2 and
                 next(t for t in s["threads"] if t["id"] == CHAT)["status"] == "processed", "second job")
    (a2,) = rule(s)
    assert len(a2["sources"]) == n_sources
    ctx = client.get("/api/context/TRN-117", params={"at": "2026-10-20T08:00:00"}).json()
    assert any(h["topic"] == "sfp-swap-forwarding-state" for h in ctx)


def test_delete_generated_and_reset(client):
    seeded(client)
    t = client.post("/api/threads", json={"source": "teams"}).json()
    client.post(f"/api/threads/{t['id']}/messages", json={"author": "Erkki", "text": "x"})
    assert client.post("/api/personas", json={"id": "p1", "name": "P One", "role": "Tester"}).status_code == 200
    removed = client.delete("/api/data/generated").json()["removed"]
    assert removed["threads"] == 1 and removed["personas"] == 1
    s = client.get("/api/state").json()
    assert t["id"] not in {x["id"] for x in s["threads"]} and CHAT in {x["id"] for x in s["threads"]}
    assert rule(s)

    assert client.post("/api/data/reset", json={"mode": "empty"}).status_code == 204
    s = client.get("/api/state").json()
    assert s["threads"] == [] and s["assertions"] == [] and s["elements"] and s["scenarios"]
    assert client.post("/api/data/reset", json={"mode": "seed"}).status_code == 204
    seeded(client)


def test_export_import_roundtrip(client):
    seeded(client)
    exported = client.get("/api/data/export").json()
    client.post("/api/data/reset", json={"mode": "empty"})
    assert client.post("/api/data/import", json=exported).status_code == 204
    assert rule(client.get("/api/state").json())


def test_transcript_contains_messages(client):
    seeded(client)
    md = client.get("/api/export/transcript.md", params={"thread_id": CHAT}).text
    first = discover_threads_chat_text()
    assert first in md
    assert "sfp-swap-forwarding-state" in md and "Pipeline job" in md
    assert client.get("/api/export/session.json").json()["jobs"]


def discover_threads_chat_text() -> str:
    return next(t for t in discover_threads() if t.id == CHAT).messages[0].text


def test_guard_and_agent(client):
    seeded(client)
    g = client.post("/api/guard", json={"action": "reboot TRN-117", "entity_id": "TRN-117", "at": "2026-10-20T08:00:00"}).json()
    assert g["decision"] in ("go", "adapt")
    r = client.post("/api/agent/run", json={"entity_id": "TRN-117", "at": "2026-10-20T08:00:00", "planned_action": "reboot TRN-117"})
    assert r.status_code == 200
    body = r.json()
    assert body["recommendation"] and "hits" in body and body["verdict"]


def test_llm_trace_sink_shows_up_in_calls(client):
    trace = {
        "id": "llm_test000001", "ts": datetime.now().isoformat(), "sim_time": None, "purpose": "check",
        "thread_id": None, "provider": "primary", "base_url": "http://x", "model": "m", "json_mode": None,
        "system": "s", "user": "u", "raw_response": "pong", "latency_ms": 3, "usage": {},
    }
    for sink in list(llm._sinks):
        sink(trace)
    calls = wait_for_calls(client)
    assert calls[0]["id"] == "llm_test000001"
    assert client.get("/api/llm/calls/llm_test000001").status_code == 200
    assert client.get("/api/llm/calls", params={"purpose": "agent"}).json() == []


def wait_for_calls(client):
    end = time.time() + 5
    while time.time() < end:
        calls = client.get("/api/llm/calls").json()
        if calls:
            return calls
        time.sleep(0.05)
    raise AssertionError("no LLM call")


def test_graph_routes_over_live_state(client):
    state = seeded(client)
    a = rule(state)[0]
    prov = client.get(f"/api/graph/provenance/{a['id']}").json()
    assert prov and all(r["text"] for r in prov)  # verbatim quotes from the live threads
    reach = client.get(f"/api/graph/reach/{a['id']}").json()
    assert reach["elements"]
    entity = next(iter(reach["elements"]))
    assert client.get(f"/api/graph/timeline/{entity}").json()
    assert client.get("/api/graph/experts", params={"entity_id": entity}).json()
    assert client.get("/api/graph/stats").json()["nodes"]["Assertion"] >= 1
    els = client.get("/api/graph").json()["elements"]
    nodes = {e["data"]["id"]: e["data"] for e in els if e["group"] == "nodes"}
    assert nodes[a["id"]]["kind"] == "Assertion" and "valid" in nodes[a["id"]]
    assert all(e["data"]["source"] in nodes and e["data"]["target"] in nodes for e in els if e["group"] == "edges")
    # a thread without messages must not break the graph
    client.post("/api/threads", json={"source": "teams", "subject": "Empty"})
    assert client.get("/api/graph/stats").status_code == 200


def test_agent_outcome_flags_failing_knowledge(client):
    seeded(client)
    assert client.post("/api/agent/outcome", json={"assertion_id": "nope", "entity_id": "TRN-117"}).status_code == 404
    hits = client.post("/api/agent/run", json={"entity_id": "TRN-117", "at": "2026-10-20T08:00:00"}).json()["hits"]
    assert hits and all("track_record" in h for h in hits)
    aid = hits[0]["id"]
    body = {"assertion_id": aid, "entity_id": "TRN-117", "at": "2026-10-20T09:00:00"}
    assert client.post("/api/agent/outcome", json=body).json()["recorded"] is None  # nothing observed: no verdict
    for day in (20, 21):
        r = client.post("/api/agent/outcome", json=body | {"worked": False, "at": f"2026-10-{day}T09:00:00"}).json()
    assert r["track_record"]["status"] == "contested"
    hits = client.post("/api/agent/run", json={"entity_id": "TRN-117", "at": "2026-10-22T08:00:00"}).json()["hits"]
    assert next(h for h in hits if h["id"] == aid)["track_record"]["status"] == "contested"


def test_elements_and_links_reject_dangling_references(client):
    state = seeded(client)
    el = state["elements"][0]
    site = state["sites"][0]["id"]
    bad = client.post("/api/elements", json={**el, "id": "NEW-1", "site_id": "NO-SUCH-SITE"})
    assert bad.status_code == 422 and "NO-SUCH-SITE" in bad.json()["detail"]
    assert client.post("/api/elements", json={**el, "id": "NEW-1", "site_id": site}).status_code == 200
    assert client.post("/api/elements", json={**el, "id": "NEW-2", "site_id": None}).status_code == 200  # no site is fine
    assert client.put(f"/api/elements/{el['id']}", json={**el, "site_id": "NO-SUCH-SITE"}).status_code == 422
    link = {"id": "L-NEW", "a": el["id"], "b": "NEW-1", "kind": "fiber"}
    assert client.post("/api/links", json={**link, "b": "GHOST"}).status_code == 422
    assert client.post("/api/links", json={**link, "a": "GHOST"}).status_code == 422
    assert client.post("/api/links", json=link).status_code == 200
    assert client.put("/api/links/L-NEW", json={**link, "b": "GHOST"}).status_code == 422
    assert client.put("/api/links/L-NEW", json=link).status_code == 200
