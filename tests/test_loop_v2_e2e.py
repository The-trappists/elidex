"""Loop v2 end to end: messages -> real Workbench/Processor job path -> stored knowledge, with the LLM layer
replaced by fakes (extractor, critic, judge, outcome). Nothing here touches the network.

One story, told in order (the steps share one Workbench):
  A  a rule is stated; the critic rejects an over-reaching second item
  B  a firmware message closes the rule although its topic slug differs (judge)
  C  two experts disagree: both stay open, flagged
  D  the agent applies a rule and says so; the technician's reply upgrades trust to verified (outcome)
  E  operator edit, undo of one edit by id, re-run with edited items
  F  flags in GET /review/flags, then every toggle off gives the old behaviour
"""

import json
from datetime import datetime, timedelta

import pytest

from context_layer import config, critic, judge, llm, outcome
from context_layer.models import ExtractedItem, Scope
from context_layer.workbench import loop_agents, processor
from test_workbench_core import client, seeded, wait_for  # noqa: F401

T0 = datetime.fromisoformat(config.WORKBENCH_SIM_START)
OBS = {"sfp_replaced": True, "interface_status": "UP", "optical_levels": "normal", "traffic_counters": 0, "alarms": "cleared"}


def mk(topic, summary, instance, who="Erkki", type_="workaround", quote=None, trust="stated", action="Bounce the interface", **kw):
    return ExtractedItem(
        type=type_, topic=topic, summary=summary, action=None if type_ == "invalidation" else action,
        fact=kw.pop("fact", None), scope=Scope(instance_ids=[instance]), trust_level=trust, stated_by=who,
        cited_seq=[1], evidence_quote=quote, confidence=0.9, **kw,
    )


class Fakes:
    """Scripted answers of the four LLM entry points, with call counters."""

    def __init__(self):
        self.items: dict[str, list[ExtractedItem]] = {}  # thread id -> what the extractor returns
        self.critic_verdicts: dict[str, dict] = {}  # topic -> verdict dict
        self.judge_rules: list = []  # fn(new, cand) -> (verdict, reason) | None
        self.outcome_answer = {"outcome": "unclear", "quote": "", "reason": "x"}
        self.calls = {"extract": 0, "critic": 0, "judge": 0, "outcome": 0}

    # --- the four fakes
    def extract(self, core, topics, sim_time=None):
        self.calls["extract"] += 1
        return list(self.items.get(core.id, []))

    def critic_llm(self, system, user, json_mode=False, **kw):
        self.calls["critic"] += 1
        rows = json.loads(user.split("Items to check:\n", 1)[1])
        verdicts = [{"index": r["index"], **self.critic_verdicts.get(r["topic"], {"verdict": "keep", "reason": "ok"})} for r in rows]
        return json.dumps({"verdicts": verdicts}), [{"id": f"llm_critic{self.calls['critic']}"}]

    def judge_llm(self, system, user, schema, thread_id, sim_time, validate):
        self.calls["judge"] += 1
        data = json.loads(user)
        out = []
        for c in data["candidates"]:
            for rule in self.judge_rules:
                if (v := rule(data["new_assertion"], c)) is not None:
                    out.append({"other_id": c["id"], "verdict": v[0], "reason": v[1]})
                    break
        return json.dumps({"verdicts": out})

    def outcome_llm(self, system, user, **kw):
        self.calls["outcome"] += 1
        return json.dumps(self.outcome_answer)


@pytest.fixture
def fakes(client, monkeypatch):
    f = Fakes()

    class FakeExtractor:
        last_traces: list = []

        def __init__(self, *a, **k):
            pass

        def extract(self, core, topics, sim_time=None):
            return f.extract(core, topics, sim_time)

    monkeypatch.setattr(config, "llm_configured", lambda: True)  # a key is "set": the agents are on duty
    monkeypatch.setattr(processor, "LLMExtractor", FakeExtractor)
    monkeypatch.setattr(llm, "complete_traced", f.critic_llm)
    monkeypatch.setattr(judge, "_call_llm", f.judge_llm)
    monkeypatch.setattr(outcome, "_call_llm", f.outcome_llm)
    loop_agents.install_all()
    for name in ("critic", "judge", "outcome"):  # other tests clear the global hooks
        getattr(__import__(f"context_layer.{name}", fromlist=["install"]), "install")()
    seeded(client)
    assert client.put("/api/settings", json={"extractor_mode": "llm"}).status_code == 200
    return f


# ---------------------------------------------------------------- helpers


def state(client):
    return client.get("/api/state").json()


def by_topic(client, topic):
    return [a for a in state(client)["assertions"] if a["topic"] == topic]


def flags(client, **params):
    return client.get("/api/review/flags", params=params).json()


def set_clock(client, at):
    assert client.post("/api/sim/clock", json={"at": at.isoformat()}).status_code == 200


def job_count(client, tid):
    return len([j for j in state(client)["jobs"] if j["thread_id"] == tid])


def process(client, tid):
    n = job_count(client, tid)
    assert client.post(f"/api/threads/{tid}/process").status_code == 202
    wait_for(client, lambda s: len([j for j in s["jobs"] if j["thread_id"] == tid]) == n + 1 and [j for j in s["jobs"] if j["thread_id"] == tid][-1]["finished_at"], "job")
    return [j for j in state(client)["jobs"] if j["thread_id"] == tid][-1]


def story(client, fakes, subject, text, items, at, who="Erkki", role="Network Expert"):
    """A new thread with one message at sim time `at`; the fake extractor will return `items`. Returns the finished job."""
    set_clock(client, at)
    tid = client.post("/api/threads", json={"source": "teams", "subject": subject}).json()["id"]
    assert client.post(f"/api/threads/{tid}/messages", json={"author": who, "role": role, "text": text}).status_code == 200
    fakes.items[tid] = items
    return process(client, tid)


# ---------------------------------------------------------------- the story


def test_loop_v2_end_to_end(client, fakes):
    assert client.get("/api/settings").json() | {} and all(
        client.get("/api/settings").json()[k] for k in ("use_critic", "use_judge", "use_outcome_loop")
    )  # on by default

    # ---- A: a rule is stated; the critic rejects the over-reaching item
    text = "After an SFP swap on TRN-042 bounce the interface. Also every TX-3000 in Finland needs this."
    fakes.critic_verdicts["every-node-rule"] = {"verdict": "reject", "reason": "The text only talks about TRN-042, not every node."}
    job_a = story(
        client, fakes, "TRN-042 sfp", text,
        [
            mk("bounce-after-sfp-swap", "Bounce the interface after an SFP swap", "TRN-042", quote="bounce the interface"),
            mk("every-node-rule", "Every TX-3000 needs the bounce", "TRN-042", quote="every TX-3000 in Finland"),
        ],
        T0,
    )
    assert job_a["extractor"].startswith("llm") and fakes.calls["critic"] == 1
    assert [v["verdict"] for v in job_a["critic"]] == ["keep", "reject"]
    assert [i["topic"] for i in job_a["items"]] == ["bounce-after-sfp-swap"]  # the rejected item never reached the linker
    assert "llm_critic1" in job_a["llm_call_ids"]
    rule = by_topic(client, "bounce-after-sfp-swap")
    assert len(rule) == 1 and rule[0]["valid_to"] is None and not by_topic(client, "every-node-rule")
    rejected = [f for f in flags(client, thread_id=job_a["thread_id"]) if f["kind"] == "critic_rejected"]
    assert len(rejected) == 1 and rejected[0]["item_topic"] == "every-node-rule" and "TRN-042" in rejected[0]["message"]

    # ---- B: a firmware message closes the rule although the topic slug differs (judge)
    fakes.judge_rules = [lambda new, c: ("supersedes", "firmware 4.2 removes the need for the bounce") if "firmware" in new["summary"].lower() and "Bounce" in c["summary"] else None]
    set_clock(client, T0 + timedelta(days=10))
    job_b = story(
        client, fakes, "firmware 4.2", "Firmware 4.2 is on TRN-042 and fixes the forwarding bug.",
        [mk("fw-4-2-fixes-forwarding", "Firmware 4.2 fixes the forwarding bug", "TRN-042", who="Aino", type_="invalidation", fact="bug fixed", quote="fixes the forwarding bug")],
        T0 + timedelta(days=10), who="Aino",
    )
    assert fakes.calls["judge"] >= 1
    rule = by_topic(client, "bounce-after-sfp-swap")[0]
    fw = by_topic(client, "fw-4-2-fixes-forwarding")[0]
    assert rule["valid_to"] is not None and rule["closed_by"] == fw["id"], job_b["judge"]
    assert any(v["verdict"] == "supersedes" and v["other_assertion_id"] == rule["id"] for v in job_b["judge"])
    closed_flag = next(f for f in flags(client, thread_id=job_b["thread_id"]) if f["kind"] == "judge_decision")
    assert closed_flag["item_topic"] == "fw-4-2-fixes-forwarding" and closed_flag["assertion_id"] == fw["id"] and "no longer applies" in closed_flag["message"]
    assert not [a for a in by_topic(client, "bounce-after-sfp-swap") if a["valid_to"] is None]

    # ---- C: two experts disagree: both stay open and are flagged
    fakes.judge_rules = [lambda new, c: ("contradicts", "one says restart, the other says never restart") if "restart" in new["summary"].lower() and "restart" in c["summary"].lower() else None]
    set_clock(client, T0 + timedelta(days=11))
    story(client, fakes, "TRN-117 restart", "Restart TRN-117 when it freezes.", [mk("restart-trn-117", "Restart the unit when it freezes", "TRN-117", quote="Restart TRN-117", action="Restart")], T0 + timedelta(days=11))
    job_c = story(
        client, fakes, "TRN-117 never restart", "Never restart TRN-117, it loses its config.",
        [mk("never-restart-trn-117", "Never restart the unit, it loses its config", "TRN-117", who="Mikko", quote="Never restart TRN-117", action="Wait")],
        T0 + timedelta(days=12), who="Mikko",
    )
    a_old, a_new = by_topic(client, "restart-trn-117")[0], by_topic(client, "never-restart-trn-117")[0]
    assert a_old["valid_to"] is None and a_new["valid_to"] is None  # nobody closed anything
    assert a_new["id"] in a_old["conflicts_with"] and a_old["id"] in a_new["conflicts_with"]
    kinds_c = {f["kind"] for f in flags(client, thread_id=job_c["thread_id"])}
    assert {"conflict", "judge_decision"} <= kinds_c
    assert any(v["verdict"] == "contradicts" for v in job_c["judge"])

    # ---- D: the agent applies a rule and says so; the technician's reply makes it verified (outcome)
    fakes.judge_rules = []
    story(client, fakes, "TRN-208 usb", "On TRN-208 reseat the SFP cage after a swap.", [mk("reseat-sfp-cage", "Reseat the SFP cage after a swap", "TRN-208", quote="reseat the SFP cage", action="Reseat the SFP cage")], T0 + timedelta(days=13))
    run = client.post("/api/agent/run", json={"entity_id": "TRN-208", "observations": OBS, "description": "No traffic after SFP swap"}).json()
    assert run["hits"] and run["thread_id"] and run["applications"], run
    ops_thread = next(t for t in state(client)["threads"] if t["id"] == run["thread_id"])
    assert ops_thread["messages"][0]["author"] == "Ops agent"
    applied = next(h for h in run["hits"] if h["topic"] == "reseat-sfp-cage")
    assert next(x for x in client.get("/api/applications").json() if x["assertion_id"] == applied["id"])["outcome"] == "pending"
    fakes.outcome_answer = {"outcome": "worked", "quote": "Traffic is back", "reason": "the technician reports recovery"}
    set_clock(client, T0 + timedelta(days=13, hours=1))
    assert client.post(f"/api/threads/{run['thread_id']}/messages", json={"author": "Jaakko Junnila", "role": "Field Engineer", "text": "Traffic is back, thanks!"}).status_code == 200
    fakes.items[run["thread_id"]] = []  # the follow-up carries no new knowledge
    job_d = process(client, run["thread_id"])
    verified = next(a for a in state(client)["assertions"] if a["id"] == applied["id"])
    assert verified["trust"]["level"] == "verified" and verified["trust"]["stated_by"] != "Jaakko Junnila"
    assert verified["trust"]["confirmed_by"] == ["Jaakko Junnila"]  # the confirmer, not the author
    assert fakes.calls["outcome"] >= 1 and any("outcome worked" in e for e in job_d["events"])
    assert any(f["kind"] == "judge_decision" and f["assertion_id"] == applied["id"] and f["item_topic"] == "reseat-sfp-cage" for f in flags(client))

    # ---- E: operator edit, undo by id, re-run with edited items
    aid = by_topic(client, "restart-trn-117")[0]["id"]
    e1 = client.patch(f"/api/assertions/{aid}", json={"summary": "Restart only after saving the config", "note": "checked on site"}).json()
    e2 = client.patch(f"/api/assertions/{aid}", json={"action": "Save the config, then restart"}).json()
    assert e1["assertion"]["sources"][-1]["source"] == "operator"
    assert any(f["kind"] == "operator_edit" and f["item_topic"] == "restart-trn-117" for f in flags(client))
    r = client.post(f"/api/assertions/{aid}/undo", json={"edit_id": e1["edit"]["id"]})
    assert r.status_code == 200 and r.json()["assertion"]["summary"] == "Restart the unit when it freezes"
    assert r.json()["assertion"]["action"] == "Save the config, then restart"  # e2 untouched
    assert client.post(f"/api/assertions/{aid}/undo").json()["assertion"]["action"] == "Restart"
    hist = client.get(f"/api/assertions/{aid}/history").json()
    assert [h["undone"] for h in hist] == [True, True]

    critic_calls = fakes.calls["critic"]
    edited = [mk("never-restart-trn-117", "Never restart the unit before saving the config", "TRN-117", who="Mikko", quote="Never restart TRN-117", action="Wait")]
    rerun = client.post(f"/api/jobs/{job_c['id']}/rerun", json={"items": [i.model_dump(mode="json") for i in edited]})
    assert rerun.status_code == 202 and rerun.json()["extractor"] == "operator"
    assert fakes.calls["critic"] == critic_calls  # an operator re-run is not second-guessed by the critic
    assert [a["summary"] for a in by_topic(client, "never-restart-trn-117")] == ["Never restart the unit before saving the config"]

    # ---- F: the flags inbox has it all, nothing ever gated anything
    all_flags = flags(client)
    assert {"critic_rejected", "judge_decision", "conflict", "operator_edit"} <= {f["kind"] for f in all_flags}
    assert all(f["item_topic"] for f in all_flags if f["kind"] in ("critic_rejected", "judge_decision", "operator_edit"))
    assert len(flags(client, kind="critic_rejected")) == 1 and flags(client, dismissed="true") == []
    f0 = flags(client, kind="critic_rejected")[0]
    assert client.post(f"/api/review/flags/{f0['id']}/dismiss").json()["dismissed"] is True
    assert flags(client, kind="critic_rejected", dismissed="false") == []

    # ---- toggles off: the old behaviour, no LLM agent called
    assert client.put("/api/settings", json={"use_critic": False, "use_judge": False, "use_outcome_loop": False}).status_code == 200
    before = dict(fakes.calls)
    fakes.critic_verdicts["off-topic"] = {"verdict": "reject", "reason": "would be rejected if the critic ran"}
    fakes.judge_rules = [lambda new, c: ("supersedes", "would close it if the judge ran")]
    job_off = story(
        client, fakes, "toggles off", "On TRN-208 clean the fibre.", [mk("off-topic", "Clean the fibre", "TRN-208", quote="clean the fibre")],
        T0 + timedelta(days=14),
    )
    assert fakes.calls["critic"] == before["critic"] and fakes.calls["judge"] == before["judge"]
    assert job_off["critic"] == [] and job_off["judge"] == [] and len(by_topic(client, "off-topic")) == 1
    assert by_topic(client, "off-topic")[0]["valid_to"] is None
    # the old lifecycle still closes by topic slug: an invalidation with the same topic as a rule
    story(
        client, fakes, "old lifecycle", "Clean the fibre is no longer needed on TRN-208.",
        [mk("off-topic", "Cleaning the fibre is no longer needed", "TRN-208", who="Aino", type_="invalidation", fact="not needed", quote="no longer needed")],
        T0 + timedelta(days=15), who="Aino",
    )
    assert by_topic(client, "off-topic")[0]["valid_to"] is not None or any(a["valid_to"] for a in by_topic(client, "off-topic"))
    run2 = client.post("/api/agent/run", json={"entity_id": "TRN-208", "observations": OBS, "description": "x"}).json()
    assert run2["hits"] and run2["thread_id"] is None and run2["applications"] == []  # outcome loop off: nothing posted
    assert fakes.calls["outcome"] == before["outcome"]


def test_agents_are_silent_without_an_llm_key(client, monkeypatch):
    """No key: critic and judge do nothing (no call, no note, no flag); the outcome loop keeps its heuristic."""
    loop_agents.install_all()
    seeded(client)
    monkeypatch.setattr(config, "llm_configured", lambda: False)
    monkeypatch.setattr(llm, "complete_traced", lambda *a, **k: pytest.fail("no LLM call without a key"))
    monkeypatch.setattr(judge, "_call_llm", lambda *a, **k: pytest.fail("no LLM call without a key"))
    s = client.get("/api/settings").json()
    assert s["use_critic"] and s["use_judge"] and s["use_outcome_loop"] and not s["llm_configured"]
    t = client.post("/api/threads", json={"source": "teams", "subject": "quiet"}).json()["id"]
    client.post(f"/api/threads/{t}/messages", json={"author": "Erkki", "text": "TRN-042 needs a wait"})
    client.app.state.wb.threads[t].scenario_id = "scripted"
    job = process(client, t)
    assert job["assertion_ids"] and job["critic"] == [] and job["judge"] == []
    assert not any("critic" in n or "judge" in n for n in job["notes"]), job["notes"]
    # outcome loop on without a key: the heuristic decides
    run = client.post("/api/agent/run", json={"entity_id": "TRN-042", "observations": OBS, "description": "No traffic"}).json()
    assert run["thread_id"] and run["applications"]
    client.post(f"/api/threads/{run['thread_id']}/messages", json={"author": "Jaakko", "text": "Still down, did not work"})
    process(client, run["thread_id"])
    assert {a["outcome"] for a in client.get("/api/applications").json()} == {"failed"}
