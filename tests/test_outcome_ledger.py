"""One ledger for field outcomes (docs/outcome-unification.md): thread replies and observations share
`Assertion.outcomes`, are never counted twice, and follow one trust/confidence rule. Offline, the LLM is faked."""

import json

import pytest

from context_layer import llm
from context_layer.mvp import feedback
from test_outcome_loop import OBS, assertion, loop, process, run_agent, say  # noqa: F401
from test_workbench_core import client, rule, seeded, wait_for  # noqa: F401

SHAPE = {"status", "worked", "failed", "failed_on", "thread", "last_at"}


def ledger(client, aid):
    return assertion(client, aid)["outcomes"]


def obs_outcome(client, aid, entity="TRN-042", **kw):
    return client.post("/api/agent/outcome", json={"assertion_id": aid, "entity_id": entity, "worked": True} | kw).json()


def start(loop):
    client, fake = loop
    res = run_agent(client)
    return client, fake, res["hits"][0]["id"], res["thread_id"]


def test_thread_reply_is_recorded_once_in_the_ledger(loop):
    client, fake, aid, tid = start(loop)
    fake.answer = {"outcome": "worked", "quote": "Traffic is back", "reason": "r"}
    say(client, tid, "Traffic is back, thanks!")
    process(client, tid)
    (o,) = ledger(client, aid)
    app = client.get("/api/applications", params={"assertion_id": aid}).json()[0]
    assert o["worked"] and o["source"] == "thread" and o["application_id"] == app["id"] and o["quote"] == "Traffic is back"
    process(client, tid)  # reprocessing the thread: still one entry
    process(client, tid)
    assert len(ledger(client, aid)) == 1


def test_reprocessing_does_not_double_count_a_failure(loop):
    client, fake, aid, tid = start(loop)
    before = assertion(client, aid)["confidence"]
    fake.answer = {"outcome": "failed", "quote": "still down", "reason": "no change"}
    say(client, tid, "Bounced it, still down.")
    process(client, tid)
    process(client, tid)
    assert len(ledger(client, aid)) == 1
    assert assertion(client, aid)["confidence"] == pytest.approx(before * 0.7, abs=0.01)  # once


def test_observation_resolves_the_pending_application_and_a_reply_does_not_count_again(loop):
    client, fake, aid, tid = start(loop)
    assert obs_outcome(client, aid)["track_record"]["worked"] == 1
    app = client.get("/api/applications", params={"assertion_id": aid}).json()[0]
    assert app["outcome"] == "worked" and app["method"] == "observation"
    assert ledger(client, aid)[0]["application_id"] == app["id"]
    fake.answer = {"outcome": "worked", "quote": "Traffic is back", "reason": "r"}
    say(client, tid, "Traffic is back, thanks!")
    process(client, tid)
    assert len(ledger(client, aid)) == 1  # the same event is not counted again
    assert fake.calls == []  # nothing is pending, so no LLM call


def test_failed_thread_outcomes_show_in_the_track_record_and_make_it_contested(loop):
    client, fake, aid, tid = start(loop)
    fake.answer = {"outcome": "failed", "quote": "still down", "reason": "no change"}
    say(client, tid, "Bounced it, still down.")
    process(client, tid)
    assert obs_outcome(client, aid, "TRN-117", worked=False)["track_record"]["status"] == "contested"  # 2 failures, 0 worked
    tid = run_agent(client)["thread_id"]  # a second application, in its own thread
    say(client, tid, "Tried again, still down.")
    process(client, tid)
    hit = next(h for h in run_agent(client)["hits"] if h["id"] == aid)
    tr = hit["track_record"]
    assert tr["status"] == "contested" and tr["failed"] == 3 and tr["thread"] == 2


def test_one_failed_thread_outcome_is_counted_but_not_yet_contested(loop):
    client, fake, aid, tid = start(loop)
    fake.answer = {"outcome": "failed", "quote": "still down", "reason": "no change"}
    say(client, tid, "Bounced it, still down.")
    process(client, tid)
    tr = feedback.track_record(client.app.state.wb.store.assertions[aid])
    assert (tr.failed, tr.thread, tr.status) == (1, 1, "ok")


def test_a_failure_in_the_ledger_blocks_the_trust_upgrade(loop):
    client, fake, aid, tid = start(loop)
    obs_outcome(client, aid, "TRN-117", worked=False)  # an earlier field failure
    fake.answer = {"outcome": "worked", "quote": "Traffic is back", "reason": "r"}
    say(client, tid, "Traffic is back, thanks!")
    process(client, tid)
    a = assertion(client, aid)
    assert a["trust"]["stated_by"] != "Jaakko Junnila"
    assert [o["worked"] for o in a["outcomes"]] == [False, True]
    flags = client.get("/api/review/flags", params={"thread_id": tid}).json()
    assert any(f["assertion_id"] == aid and f["message"].startswith("Mixed evidence") for f in flags)


def test_observation_failure_lowers_confidence_once_and_never_drops_the_rule(loop):
    client, _, aid, _ = start(loop)
    before = assertion(client, aid)["confidence"]
    obs_outcome(client, aid, worked=False)
    a = assertion(client, aid)
    assert a["confidence"] == pytest.approx(before * 0.7, abs=0.01) and a["valid_to"] is None


def test_track_record_has_one_shape_in_the_api_and_the_llm_payload(loop, monkeypatch):
    client, _, aid, _ = start(loop)
    r = obs_outcome(client, aid, "TRN-117", worked=False)
    assert set(r["track_record"]) == SHAPE
    assert set(next(h for h in run_agent(client)["hits"] if h["id"] == aid)["track_record"]) == SHAPE
    seen = []
    monkeypatch.setattr(llm, "complete", lambda system, user, **kw: seen.append(json.loads(user)) or "ok")
    body = {"entity_id": "TRN-042", "observations": OBS, "use_llm": True}
    client.post("/api/agent/run", json=body)
    ctx = seen[0]["human_context"]
    assert ctx and all(set(c["track_record"]) == SHAPE for c in ctx)
