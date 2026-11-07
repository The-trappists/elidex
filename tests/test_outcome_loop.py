"""Passive outcome loop (loop v2, L3): offline, scripted extractor, the LLM call is replaced by a fake."""

import json

import pytest

from context_layer import config, outcome
from context_layer.workbench import persistence
from test_workbench_core import client, rule, seeded, wait_for  # noqa: F401

OBS = {"sfp_replaced": True, "interface_status": "UP", "optical_levels": "normal", "traffic_counters": 0, "alarms": "cleared"}
CONFIRM_WORDS = ("confirm", "please reply", "let us know", "let me know", "rate", "feedback", "?")


class FakeLlm:
    def __init__(self, answer=None, error=None):
        self.answer, self.error, self.calls = answer, error, []

    def __call__(self, system, user, **kw):
        self.calls.append(json.loads(user))
        if self.error:
            raise self.error
        return json.dumps(self.answer)


@pytest.fixture
def loop(client, monkeypatch):
    outcome.install()  # hooks are global and other tests may have cleared them
    seeded(client)
    client.put("/api/settings", json={"use_outcome_loop": True})
    fake = FakeLlm({"outcome": "unclear", "quote": "", "reason": "x"})
    monkeypatch.setattr(outcome, "_call_llm", fake)
    monkeypatch.setattr(config, "llm_configured", lambda: True)  # without a key the heuristic decides alone
    return client, fake


def run_agent(client, entity="TRN-042"):
    return client.post("/api/agent/run", json={"entity_id": entity, "observations": OBS, "description": "No traffic"}).json()


def process(client, tid):
    wb = client.app.state.wb
    n = len([j for j in wb.jobs.values() if j.thread_id == tid])
    assert client.post(f"/api/threads/{tid}/process").status_code == 202

    def done(s):
        js = [j for j in s["jobs"] if j["thread_id"] == tid]
        return len(js) == n + 1 and js[-1]["finished_at"] is not None

    wait_for(client, done, "job")


def say(client, tid, text, author="Jaakko Junnila"):
    client.post(f"/api/threads/{tid}/messages", json={"author": author, "role": "Field Engineer", "text": text})


def assertion(client, aid):
    return next(a for a in client.get("/api/state").json()["assertions"] if a["id"] == aid)


def test_agent_run_posts_one_informative_message_and_creates_applications(loop):
    client, _ = loop
    res = run_agent(client)
    assert res["hits"] and res["thread_id"] and len(res["applications"]) == len(res["hits"])
    wb = client.app.state.wb
    msgs = wb.threads[res["thread_id"]].messages
    assert len(msgs) == 1 and msgs[0].author == "Ops agent" and msgs[0].role == "AI operations agent"
    for h in res["hits"]:
        assert f"Applied {h['id']} on TRN-042" in msgs[0].text
    assert wb.threads[res["thread_id"]].origin == "manual"
    low = msgs[0].text.lower()
    assert not any(w in low for w in CONFIRM_WORDS)
    apps = client.get("/api/applications").json()
    assert {a["assertion_id"] for a in apps} == {h["id"] for h in res["hits"]}
    assert all(a["outcome"] == "pending" and a["message_seq"] == 1 and a["thread_id"] == res["thread_id"] for a in apps)
    assert client.get("/api/applications", params={"outcome": "worked"}).json() == []
    assert len(client.get("/api/applications", params={"thread_id": res["thread_id"]}).json()) == len(apps)


def test_agent_run_reuses_the_incident_thread(loop):
    client, _ = loop
    wb = client.app.state.wb
    t = client.post("/api/threads", json={"source": "teams", "subject": "TRN-042 down"}).json()
    inc = client.post("/api/incidents", json={"entity_id": "TRN-042", "kind": "x", "summary": "down", "observations": OBS}).json()
    wb.incidents[inc["id"]].thread_id = t["id"]
    assert run_agent(client)["thread_id"] == t["id"]


def test_toggle_off_does_nothing(loop):
    client, fake = loop
    client.put("/api/settings", json={"use_outcome_loop": False})
    res = run_agent(client)
    assert res["thread_id"] is None and res["applications"] == [] and res["hits"]
    assert client.get("/api/applications").json() == []


def test_nothing_applied_means_no_post(loop):
    client, _ = loop
    wb = client.app.state.wb
    before = len(wb.threads)
    res = run_agent(client, entity="TRN-305")  # not covered by the old-unit rule
    assert not res["hits"] and res["thread_id"] is None
    assert len(wb.threads) == before and client.get("/api/applications").json() == []


def decide(loop, answer, human="Traffic is back, thanks!"):
    client, fake = loop
    fake.answer = answer
    res = run_agent(client)
    aid = res["hits"][0]["id"]
    tid = res["thread_id"]
    say(client, tid, human)
    process(client, tid)
    return client, fake, aid, tid


def test_worked_upgrades_trust_and_adds_source(loop):
    client, fake, aid, tid = decide(
        loop, {"outcome": "worked", "quote": "Traffic is back", "reason": "reports recovery"}
    )
    a = assertion(client, aid)
    # the technician confirms; the expert who stated the rule stays its author
    assert a["trust"]["level"] == "verified" and a["trust"]["stated_by"] == "Erkki Expert"
    assert a["trust"]["confirmed_by"] == ["Jaakko Junnila"]
    assert a["trust"]["evidence"] == "Traffic is back"
    assert any(s["file"] == tid and s["seq"] == [2] for s in a["sources"])
    (app,) = [x for x in client.get("/api/applications", params={"assertion_id": aid}).json()]
    assert app["outcome"] == "worked" and app["method"] == "llm" and app["outcome_quote"] == "Traffic is back"
    flags = client.get("/api/review/flags", params={"thread_id": tid}).json()
    assert any(f["kind"] == "judge_decision" and f["assertion_id"] == aid and f["message"].startswith("Confirmed in the field") for f in flags)
    # the agent message is context for the model but is not what it judged
    assert [m["author"] for m in fake.calls[0]["technician_messages"]] == ["Jaakko Junnila"]


def test_failed_lowers_confidence_and_flags(loop):
    client, _ = loop
    res = run_agent(client)
    aid = res["hits"][0]["id"]
    before = assertion(client, aid)["confidence"]
    loop[1].answer = {"outcome": "failed", "quote": "still down", "reason": "no change"}
    say(client, res["thread_id"], "Bounced it, still down.")
    process(client, res["thread_id"])
    a = assertion(client, aid)
    assert a["confidence"] == pytest.approx(before * 0.7, abs=0.01)
    assert a["trust"]["level"] != "verified" or a["trust"]["stated_by"] != "Jaakko Junnila"
    flags = client.get("/api/review/flags", params={"thread_id": res["thread_id"]}).json()
    assert any(f["kind"] == "low_confidence" and f["assertion_id"] == aid for f in flags)
    assert client.get("/api/applications", params={"outcome": "failed"}).json()[0]["assertion_id"] == aid


def test_unclear_changes_nothing_and_stays_pending(loop):
    client, fake, aid, tid = decide(loop, {"outcome": "unclear", "quote": "", "reason": "nothing about it"}, "Going for lunch")
    assert fake.calls
    assert client.get("/api/applications", params={"assertion_id": aid}).json()[0]["outcome"] == "pending"
    assert client.get("/api/review/flags", params={"thread_id": tid}).json() == []


def test_heuristic_when_the_llm_raises(loop):
    client, fake = loop
    fake.error = RuntimeError("no LLM")
    res = run_agent(client)
    aid = res["hits"][0]["id"]
    say(client, res["thread_id"], "Done, traffic is back!")
    process(client, res["thread_id"])
    (app,) = client.get("/api/applications", params={"assertion_id": aid}).json()
    assert app["outcome"] == "worked" and app["method"] == "heuristic" and "back" in app["outcome_quote"]
    assert assertion(client, aid)["trust"]["level"] == "verified"


def test_heuristic_failed_and_unclear():
    msg = lambda t: type("M", (), {"text": t})()  # noqa: E731
    assert outcome.heuristic([msg("It did not work")])[0] == "failed"
    assert outcome.heuristic([msg("traffic is back"), msg("hm, still down")])[0] == "failed"
    assert outcome.heuristic([msg("lunch?")]) is None


def test_idempotent_reprocessing(loop):
    client, fake, aid, tid = decide(loop, {"outcome": "worked", "quote": "Traffic is back", "reason": "r"})
    calls = len(fake.calls)
    snap = assertion(client, aid)
    process(client, tid)
    process(client, tid)
    assert len(fake.calls) == calls  # decided once, no new LLM call
    assert assertion(client, aid) == snap


def test_thread_without_pending_application_costs_no_llm_call(loop):
    client, fake = loop
    t = client.post("/api/threads", json={"source": "teams", "subject": "other"}).json()
    say(client, t["id"], "traffic is back")
    process(client, t["id"])
    assert fake.calls == []


def test_toggle_off_leaves_pending_untouched(loop):
    client, fake = loop
    res = run_agent(client)
    client.put("/api/settings", json={"use_outcome_loop": False})
    say(client, res["thread_id"], "traffic is back")
    process(client, res["thread_id"])
    assert fake.calls == []
    assert all(a["outcome"] == "pending" for a in client.get("/api/applications").json())


def test_applications_survive_export_and_import(loop):
    client, _ = loop
    run_agent(client)
    exported = client.get("/api/data/export").json()
    assert exported["applications"]
    client.post("/api/data/reset", json={"mode": "empty"})
    assert client.get("/api/applications").json() == []
    assert client.post("/api/data/import", json=exported).status_code == 204
    assert len(client.get("/api/applications").json()) == len(exported["applications"])
    wb = client.app.state.wb
    assert "applications" in persistence.state_to_dict(wb)
