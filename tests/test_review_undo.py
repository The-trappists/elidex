"""Operator console fixes (loop v2, L8): undo one edit by id, null vs omitted valid_to, flag item_topic,
seed bootstrap without critic and judge. Offline."""

from fastapi.testclient import TestClient

import test_workbench_core as core
from context_layer import critic, judge
from context_layer.workbench import loop_agents
from context_layer.workbench.app import create_app
from test_review_backend import edit, flags, item, run_thread
from test_workbench_core import client, seeded, wait_for  # noqa: F401


def undo(client, aid, edit_id=None):
    return client.post(f"/api/assertions/{aid}/undo", **({"json": {"edit_id": edit_id}} if edit_id else {}))


def test_undo_one_edit_by_id_restores_only_its_fields(client):
    seeded(client)
    _, job = run_thread(client, [item("undo-id", summary="original", action="Wait five minutes")])
    aid = job["assertion_ids"][0]
    e1 = edit(client, aid, summary="fixed").json()["edit"]
    e2 = edit(client, aid, action="Wait ten minutes").json()["edit"]
    r = undo(client, aid, e1["id"])  # not the latest: only the summary comes back
    assert r.status_code == 200 and r.json()["edit"]["id"] == e1["id"] and r.json()["edit"]["undone"] is True
    a = r.json()["assertion"]
    assert a["summary"] == "original" and a["action"] == "Wait ten minutes"
    assert any(s["source"] == "operator" for s in a["sources"])  # e2 still needs the operator source
    hist = {h["id"]: h["undone"] for h in client.get(f"/api/assertions/{aid}/history").json()}
    assert hist == {e1["id"]: True, e2["id"]: False}
    assert undo(client, aid).json()["edit"]["id"] == e2["id"]  # no body: the latest live edit


def test_undo_by_id_errors(client):
    seeded(client)
    _, job = run_thread(client, [item("undo-err", summary="original")])
    aid = job["assertion_ids"][0]
    e1 = edit(client, aid, summary="one").json()["edit"]
    e2 = edit(client, aid, summary="two").json()["edit"]
    r = undo(client, aid, e1["id"])  # a later edit changed the same field
    assert r.status_code == 409 and "later edit" in r.json()["detail"] and "summary" in r.json()["detail"]
    assert undo(client, aid, "edit_9999").status_code == 404
    assert undo(client, aid, e2["id"]).status_code == 200
    assert undo(client, aid, e2["id"]).status_code == 409  # already undone
    assert undo(client, aid, e1["id"]).status_code == 200  # now it is the latest live edit
    state = {a["id"]: a for a in client.get("/api/state").json()["assertions"]}
    assert state[aid]["summary"] == "original"


def test_undo_edit_of_another_assertion_is_unknown(client):
    seeded(client)
    _, j1 = run_thread(client, [item("undo-a")], sid="ua")
    _, j2 = run_thread(client, [item("undo-b", instance="TRN-117")], sid="ub")
    other = edit(client, j2["assertion_ids"][0], summary="x").json()["edit"]
    edit(client, j1["assertion_ids"][0], summary="y")
    assert undo(client, j1["assertion_ids"][0], other["id"]).status_code == 404


def test_patch_distinguishes_omitted_from_explicit_null(client):
    seeded(client)
    _, job = run_thread(client, [item("reopen-me")])
    aid = job["assertion_ids"][0]
    closed = edit(client, aid, valid_to="2026-10-01T00:00:00").json()["assertion"]
    assert closed["valid_to"] == "2026-10-01T00:00:00"
    a = edit(client, aid, summary="reworded").json()["assertion"]  # valid_to omitted: untouched
    assert a["valid_to"] == "2026-10-01T00:00:00" and a["summary"] == "reworded"
    assert edit(client, aid, valid_to=None).json()["assertion"]["valid_to"] is None  # explicit null reopens
    assert edit(client, aid, summary=None).status_code == 422  # null on any other field means no change


def test_flags_carry_the_item_topic(client):
    seeded(client)
    tid, job = run_thread(client, [item("topic-low", confidence=0.6), item("topic-lost", instance="ZZZ-999")])
    by_kind = {f["kind"]: f for f in flags(client, thread_id=tid)}
    assert by_kind["low_confidence"]["item_topic"] == "topic-low"
    assert by_kind["abstained"]["item_topic"] == "topic-lost"
    edit(client, job["assertion_ids"][0], summary="by hand")
    assert next(f for f in flags(client) if f["kind"] == "operator_edit")["item_topic"] == "topic-low"


def test_seed_is_processed_without_critic_and_judge(tmp_path, monkeypatch):
    """First start: the seed never costs a critic or judge call, even with a key and the toggles on."""
    monkeypatch.setattr(core.seed, "load_seed", core.small_seed)
    monkeypatch.setattr(core.config, "WORKBENCH_LLM_CALLS_FILE", tmp_path / "calls.jsonl")
    monkeypatch.setattr(core.config, "WORKBENCH_LLM_CACHE_FILE", tmp_path / "cache.json")
    monkeypatch.setattr(core.config, "llm_configured", lambda: True)
    seen = []
    monkeypatch.setattr(critic, "critique", lambda *a, **k: seen.append("critic") or ([], [], []))
    monkeypatch.setattr(judge, "_call_llm", lambda *a, **k: seen.append("judge") or "{}")
    loop_agents.install_all()
    with TestClient(create_app(state_file=tmp_path / "state.json", background=False)) as c:
        assert c.get("/api/settings").json()["use_critic"] is True  # the user's settings are never touched
        wait_for(c, lambda s: s["threads"] and all(t["status"] != "processing" for t in s["threads"]), "seed")
        assert seen == []
        assert c.get("/api/settings").json()["use_judge"] is True
        assert not c.app.state.wb.processor.bootstrap_threads
