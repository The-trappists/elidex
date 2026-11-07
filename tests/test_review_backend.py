"""Review backend (loop v2, lot L4): flags, re-run, operator edits. Offline, scripted extractor."""

from context_layer.models import ClassCriteria, ExtractedItem, ExtractionResult, Scope
from context_layer.workbench import review
from context_layer.workbench.contracts import Scenario, ScenarioMessage
from test_workbench_core import client, seeded, wait_for  # noqa: F401


def item(topic, instance="TRN-042", confidence=0.9, summary=None, action="Wait five minutes", **scope):
    return ExtractedItem(
        type="workaround", topic=topic, summary=summary or f"{topic} summary", action=action,
        scope=Scope(instance_ids=[instance] if instance else [], **scope), trust_level="stated",
        stated_by="Erkki", cited_seq=[1], confidence=confidence,
    )


def jobs_of(client, tid):
    return [j for j in client.get("/api/state").json()["jobs"] if j["thread_id"] == tid]


def run_thread(client, items, text="TRN-042 needs a wait after the swap", sid="rv"):
    """New thread bound to a scripted scenario with the given items; returns (thread id, finished job)."""
    wb = client.app.state.wb
    wb.scenarios[sid] = Scenario(
        id=sid, title=sid, messages=[ScenarioMessage(persona="erkki", text=text)],
        expected=ExtractionResult(items=items),
    )
    t = client.post("/api/threads", json={"source": "teams", "subject": sid}).json()
    client.post(f"/api/threads/{t['id']}/messages", json={"author": "Erkki", "text": text})
    wb.threads[t["id"]].scenario_id = sid
    process(client, t["id"])
    return t["id"], jobs_of(client, t["id"])[-1]


def process(client, tid):
    """Run the thread's job now and wait until a job started after this call has finished."""
    before = len(jobs_of(client, tid))
    assert client.post(f"/api/threads/{tid}/process").status_code == 202

    def done(s):
        js = [j for j in s["jobs"] if j["thread_id"] == tid]
        return len(js) == before + 1 and js[-1]["finished_at"] is not None

    wait_for(client, done, "job")


def flags(client, **params):
    return client.get("/api/review/flags", params=params).json()


def edit(client, aid, **body):
    return client.patch(f"/api/assertions/{aid}", json=body)


def test_flags_for_low_confidence_and_abstained_without_duplicates(client):
    seeded(client)
    tid, job = run_thread(client, [item("low-one", confidence=0.6), item("lost-one", instance="ZZZ-999")])
    assert len(job["assertion_ids"]) == 1  # the low confidence item is live: flags never gate
    fs = flags(client, thread_id=tid)
    assert {f["kind"] for f in fs} == {"low_confidence", "abstained"}
    low = next(f for f in fs if f["kind"] == "low_confidence")
    assert low["assertion_id"] == job["assertion_ids"][0] and "60%" in low["message"] and low["job_id"] == job["id"]
    assert "lost-one" in next(f for f in fs if f["kind"] == "abstained")["message"]
    process(client, tid)  # same thread again: no new flags
    assert len(flags(client, thread_id=tid)) == 2
    assert [f["kind"] for f in flags(client, kind="abstained", thread_id=tid)] == ["abstained"]


def test_dismiss_undismiss_and_filters(client):
    seeded(client)
    tid, _ = run_thread(client, [item("low-two", confidence=0.6)])
    (f,) = flags(client, thread_id=tid)
    assert client.post(f"/api/review/flags/{f['id']}/dismiss").json()["dismissed"] is True
    assert flags(client, thread_id=tid, dismissed="false") == []
    assert len(flags(client, thread_id=tid, dismissed="true")) == 1
    process(client, tid)  # a dismissed flag stays dismissed and is not duplicated
    assert [x["dismissed"] for x in flags(client, thread_id=tid)] == [True]
    assert client.post(f"/api/review/flags/{f['id']}/undismiss").json()["dismissed"] is False
    assert client.post("/api/review/flags/nope/dismiss").status_code == 404


def test_flags_in_export_import_and_reset(client):
    seeded(client)
    tid, _ = run_thread(client, [item("low-three", confidence=0.6)])
    exported = client.get("/api/data/export").json()
    assert len(exported["flags"]) == 1
    client.post("/api/data/reset", json={"mode": "empty"})
    assert flags(client) == []
    assert client.post("/api/data/import", json=exported).status_code == 204
    assert len(flags(client, thread_id=tid)) == 1


def test_review_flag_event_is_published(client):
    seeded(client)
    wb = client.app.state.wb
    run_thread(client, [item("low-four", confidence=0.6)])
    events = [e for e in wb.bus.history if e.type == "review.flag"]
    assert events and events[-1].data["kind"] == "low_confidence"


def test_conflict_flag(client):
    seeded(client)
    run_thread(client, [item("shared-topic", action="Restart the unit")], sid="c1")
    other = item("shared-topic", action="Never restart the unit")
    other.stated_by = "Mikko"
    tid, job = run_thread(client, [other], sid="c2")
    assert "conflict" in {f["kind"] for f in flags(client, thread_id=tid)}


def test_over_reach_flag(client, monkeypatch):
    seeded(client)
    monkeypatch.setattr(review, "OVER_REACH_MIN", 2)
    # the thread names TRN-042 only, the rule is about every TX-3000 node
    it = item("wide-rule", instance=None, element_class=ClassCriteria(type="transmission_node", model="TX-3000"))
    tid, job = run_thread(client, [it], text="TRN-042 is acting up")
    assert job["assertion_ids"], job["notes"]
    over = [f for f in flags(client, thread_id=tid) if f["kind"] == "over_reach"]
    assert len(over) == 1 and over[0]["assertion_id"] == job["assertion_ids"][0]
    assert "TRN-117" in over[0]["detail"]


def test_rerun_errors(client):
    seeded(client)
    _, job = run_thread(client, [item("rerun-err")])
    r = client.post(f"/api/jobs/{job['id']}/rerun", json={"model": "other-model"})
    assert r.status_code == 422 and "model" in r.json()["detail"]
    assert client.post("/api/jobs/job_9999/rerun", json={}).status_code == 404


def test_rerun_with_edited_items(client):
    seeded(client)
    tid, job = run_thread(client, [item("rerun-topic", summary="first wording")])
    aid = job["assertion_ids"][0]
    edited = [item("rerun-topic", summary="second wording")]
    r = client.post(f"/api/jobs/{job['id']}/rerun", json={"items": [i.model_dump(mode="json") for i in edited]})
    assert r.status_code == 202
    new = r.json()
    assert new["id"] != job["id"] and new["thread_id"] == tid and new["extractor"] == "operator"
    assert all(s["status"] in ("done", "skipped") for s in new["stages"])
    mine = [a for a in client.get("/api/state").json()["assertions"] if a["topic"] == "rerun-topic"]
    assert [a["summary"] for a in mine] == ["second wording"]
    assert new["removed_assertion_ids"] == [aid]


def test_rerun_reuses_items_and_store_stage(client):
    seeded(client)
    tid, job = run_thread(client, [item("rerun-reuse", summary="the wording")])
    first = client.post(f"/api/jobs/{job['id']}/rerun", json={}).json()
    again = client.post(f"/api/jobs/{first['id']}/rerun", json={"from_stage": "store"})
    assert again.status_code == 202
    assert len(again.json()["items"]) == 1 and again.json()["items"][0]["summary"] == "the wording"


def test_operator_edit_history_and_undo(client):
    seeded(client)
    tid, job = run_thread(client, [item("edit-me", summary="original", action="Wait five minutes")])
    aid = job["assertion_ids"][0]
    r = edit(client, aid, summary="fixed", action="Wait ten minutes", note="checked on site")
    assert r.status_code == 200
    a = r.json()["assertion"]
    assert a["summary"] == "fixed" and a["action"] == "Wait ten minutes"
    assert {"source": "operator", "file": "operator", "seq": []} in a["sources"]
    assert a["trust"]["stated_by"] == "Erkki"  # trust untouched unless edited
    rec = r.json()["edit"]
    assert rec["before"]["summary"] == "original" and rec["after"]["summary"] == "fixed" and rec["undone"] is False
    assert any(f["kind"] == "operator_edit" and f["assertion_id"] == aid for f in flags(client))

    r = edit(client, aid, trust_level="verified")
    assert r.json()["assertion"]["trust"]["stated_by"] == "operator"
    assert r.json()["assertion"]["trust"]["level"] == "verified"
    hist = client.get(f"/api/assertions/{aid}/history").json()
    assert len(hist) == 2 and hist[0]["id"] == r.json()["edit"]["id"]  # newest first

    u = client.post(f"/api/assertions/{aid}/undo").json()
    assert u["edit"]["undone"] is True and u["assertion"]["trust"]["stated_by"] == "Erkki"
    assert u["assertion"]["summary"] == "fixed"  # only the latest edit is undone
    u = client.post(f"/api/assertions/{aid}/undo").json()
    assert u["assertion"]["summary"] == "original" and u["assertion"]["action"] == "Wait five minutes"
    assert client.post(f"/api/assertions/{aid}/undo").status_code == 409


def test_operator_edit_valid_to_and_errors(client):
    seeded(client)
    _, job = run_thread(client, [item("close-me")])
    aid = job["assertion_ids"][0]
    a = edit(client, aid, valid_to="2026-10-01T00:00:00").json()["assertion"]
    assert a["valid_to"] == "2026-10-01T00:00:00"
    a = edit(client, aid, valid_to=None).json()["assertion"]
    assert a["valid_to"] is None  # an explicit null reopens it
    assert edit(client, aid).status_code == 422  # nothing to change
    assert edit(client, "ctx_9999", summary="x").status_code == 404
    assert client.get("/api/assertions/ctx_9999/history").status_code == 404
    assert client.post("/api/assertions/ctx_9999/undo").status_code == 404


def test_operator_edit_survives_reprocessing(client):
    seeded(client)
    tid, job = run_thread(client, [item("survivor", summary="original")])
    aid = job["assertion_ids"][0]
    edit(client, aid, summary="operator wording")
    process(client, tid)
    mine = [a for a in client.get("/api/state").json()["assertions"] if a["topic"] == "survivor"]
    assert len(mine) == 1 and mine[0]["summary"] == "operator wording"
    assert {s["source"] for s in mine[0]["sources"]} == {"teams", "operator"}
    # even when the thread no longer yields the knowledge, the operator-edited copy stays
    client.app.state.wb.scenarios["rv"].expected = ExtractionResult(items=[])
    process(client, tid)
    mine = [a for a in client.get("/api/state").json()["assertions"] if a["topic"] == "survivor"]
    assert len(mine) == 1 and [s["source"] for s in mine[0]["sources"]] == ["operator"]


def test_edits_persist_in_export(client):
    seeded(client)
    _, job = run_thread(client, [item("persisted")])
    aid = job["assertion_ids"][0]
    edit(client, aid, summary="kept")
    exported = client.get("/api/data/export").json()
    assert len(exported["edits"]) == 1
    client.post("/api/data/reset", json={"mode": "empty"})
    assert client.post("/api/data/import", json=exported).status_code == 204
    assert len(client.get(f"/api/assertions/{aid}/history").json()) == 1
