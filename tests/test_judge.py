"""Reconcile judge (loop v2, L2): the LLM is replaced by a fake, nothing here touches the network."""

import asyncio
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from context_layer import judge
from context_layer.link import Inventory
from context_layer.models import (
    Binding,
    ClassCriteria,
    ContextAssertion,
    ElementClass,
    NetworkElement,
    Site,
    SourceRef,
    Trust,
)
from context_layer.mvp.lifecycle import reconcile
from context_layer.store import ContextStore
from context_layer.workbench import processor
from context_layer.workbench.contracts import PipelineJob, Settings
from context_layer.workbench.processor import HookContext, Processor
from context_layer.workbench.state import Workbench

CLS = "class:transmission_node:installed-upto-2019"
T0 = datetime(2026, 10, 20, 8, 0)
T1 = T0 + timedelta(days=10)


def make_store() -> ContextStore:
    inv = Inventory(
        [
            NetworkElement(id="TRN-042", type="transmission_node", model="TX-3000", install_year=2018, site_id="SITE-A"),
            NetworkElement(id="TRN-088", type="transmission_node", model="TX-3000", install_year=2017, site_id="SITE-A"),
        ],
        [Site(id="SITE-A", name="Alpha")],
    )
    store = ContextStore(inv)
    crit = ClassCriteria(type="transmission_node", install_year_max=2019)
    store.add_class(ElementClass(id=CLS, label="old nodes", criteria=crit))
    return store


def mk(topic, summary, who, level="stated", at=T0, action=None, type_="workaround", file="chat", seq=1, extra=()):
    return ContextAssertion(
        type=type_,
        topic=topic,
        summary=summary,
        bound_to=[Binding(entity=CLS, role="applies_to"), *extra],
        action=action,
        valid_from=at,
        trust=Trust(level=level, stated_by=who),
        sources=[SourceRef(source="teams", file=file, seq=[seq])],
        confidence=0.9,
    )


@pytest.fixture(autouse=True)
def _llm_key(monkeypatch):
    from context_layer import config

    monkeypatch.setattr(config, "llm_configured", lambda: True)  # the agents stay quiet without a key


def put(store, a):
    stored, is_new = store.add_assertion(a)
    assert is_new
    return stored


def fake_llm(rules):
    """rules(new, candidates) -> {candidate_id: (verdict, reason)}; the others are unrelated."""
    calls = []

    def _call(system, user, schema, thread_id, sim_time, validate):
        data = json.loads(user)
        calls.append(data)
        decided = rules(data["new_assertion"], data["candidates"])
        out = []
        for c in data["candidates"]:
            verdict, reason = decided.get(c["id"], ("unrelated", "n/a"))
            out.append({"other_id": c["id"], "verdict": verdict, "reason": reason})
        return json.dumps({"verdicts": out})

    _call.calls = calls
    return _call


def run(store, new, monkeypatch, llm, use_judge=True, lifecycle=False):
    monkeypatch.setattr(judge, "_call_llm", llm)
    job = PipelineJob(id="job_0001", thread_id="chat", started_at=datetime.now())
    wb = SimpleNamespace(store=store, now=lambda: T1)
    settings = Settings(use_judge=use_judge)
    ctx = HookContext(wb=wb, job=job, thread=None, core=None, items=[], new_assertions=list(new), settings=settings)
    job.assertion_ids = [a.id for a in new]
    processor.clear_hooks()
    judge.install()
    asyncio.run(processor.run_hooks("after_store", ctx))
    processor.clear_hooks()
    if lifecycle:
        for a in ctx.new_assertions:
            job.events += reconcile(store, a)
    return job, ctx


def dump(store):
    return json.dumps([a.model_dump(mode="json") for a in store.assertions.values()], sort_keys=True)


def firmware_case(store, new_topic="fw-4-2-fixes-forwarding"):
    old = put(store, mk("sfp-swap-forwarding-state", "Bounce the interface after an SFP swap", "Erkki", action="bounce interface"))
    fw = put(store, mk(new_topic, "Firmware 4.2 fixes the forwarding bug", "Aino", at=T1, type_="invalidation", file="fw"))
    fw.fact = "bug fixed"
    return old, fw


def supersede_rule(new, cands):
    return {c["id"]: ("supersedes", "firmware 4.2 removes the need for the bounce") for c in cands}


def always(verdict, reason="r"):
    return lambda new, cands: {c["id"]: (verdict, reason) for c in cands}



# ------------------------------------------------------------------ tests


def test_firmware_closes_rule_with_different_topic(monkeypatch):
    store = make_store()
    old, fw = firmware_case(store)
    job, _ = run(store, [fw], monkeypatch, fake_llm(supersede_rule))
    assert old.valid_to == fw.valid_from and old.closed_by == fw.id
    assert fw.valid_to is None
    [v] = job.judge
    assert (v.new_assertion_id, v.other_assertion_id, v.verdict) == (fw.id, old.id, "supersedes")
    [f] = job.flags
    assert f.kind == "judge_decision" and "firmware 4.2 removes the need" in f.message
    assert any(e.startswith("judge:") and old.id in e for e in job.events)


def test_replacement_in_same_message_stays_open(monkeypatch):
    store = make_store()
    old, fw = firmware_case(store)
    repl = put(store, mk("new-rule", "Do X instead", "Aino", at=T1, action="do x"))
    run(store, [fw, repl], monkeypatch, fake_llm(supersede_rule))
    assert repl.valid_to is None  # same job and same time: never closed
    assert old.valid_to == T1


def test_hunch_cannot_close_verified_knowledge(monkeypatch):
    store = make_store()
    verified = put(store, mk("rule", "verified rule", "Erkki", level="verified", action="a"))
    hunch = put(store, mk("other", "a hunch", "Helmi", level="hunch", at=T1, action="b"))
    job, _ = run(store, [hunch], monkeypatch, fake_llm(supersede_rule))
    assert verified.valid_to is None
    assert verified.conflicts_with == [hunch.id] and hunch.conflicts_with == [verified.id]
    assert job.judge[0].verdict == "contradicts"


def test_two_experts_disagree_both_stay_open(monkeypatch):
    store = make_store()
    a = put(store, mk("sfp-first-step", "Bounce first", "Erkki", action="bounce the interface"))
    b = put(store, mk("reseat-module", "Reseat first", "Aino", at=T0 + timedelta(minutes=5), action="reseat the module"))
    job, _ = run(store, [b], monkeypatch, fake_llm(always("contradicts", "different first step")))
    assert a.conflicts_with == [b.id] and b.conflicts_with == [a.id]
    assert a.valid_to is None and b.valid_to is None
    assert job.judge[0].verdict == "contradicts" and "different first step" in job.flags[0].message


def test_same_job_pair_is_judged_once(monkeypatch):
    store = make_store()
    a = put(store, mk("t1", "Bounce first", "Erkki", action="bounce"))
    b = put(store, mk("t2", "Reseat first", "Aino", action="reseat"))
    llm = fake_llm(always("contradicts", "disagree"))
    job, _ = run(store, [a, b], monkeypatch, llm)
    assert len(llm.calls) == 1 and len(job.judge) == 1
    assert a.conflicts_with == [b.id] and b.conflicts_with == [a.id]


def test_hunch_upgraded_to_verified_and_merged(monkeypatch):
    store = make_store()
    obs = Binding(entity="TRN-042", role="observed_on")
    hunch = put(store, mk("settle", "Optics settle for 10 min", "Helmi", level="hunch", action="wait", extra=[obs]))
    edges_before = set(store.g.out_edges(hunch.id, keys=True))
    ver = put(store, mk("optics-wait", "Waiting worked", "Veikko", level="verified", at=T1, action="wait", file="chat2", extra=[obs]))
    job, ctx = run(store, [ver], monkeypatch, fake_llm(always("supports", "outcome confirmed the hunch")))
    assert ver.id not in store.assertions and ver.id not in store.g
    assert hunch.trust.level == "verified" and hunch.trust.stated_by == "Veikko"
    assert {s.file for s in hunch.sources} == {"chat", "chat2"}
    assert hunch.id in store.assertions and set(store.g.out_edges(hunch.id, keys=True)) == edges_before
    assert ctx.new_assertions == [] and job.assertion_ids == [hunch.id]
    assert job.judge[0].verdict == "supports" and job.flags[0].assertion_id == hunch.id
    assert "verified" in job.flags[0].message


def test_support_without_matching_action_adds_source_and_trust_only(monkeypatch):
    store = make_store()
    old = put(store, mk("a", "Wait ten minutes", "Helmi", level="hunch", action="wait ten minutes"))
    new = put(store, mk("b", "Waiting is fine", "Veikko", level="stated", at=T1, action="just wait", file="c2"))
    run(store, [new], monkeypatch, fake_llm(always("supports", "same advice")))
    assert new.id in store.assertions  # not a clear duplicate: kept
    assert old.trust.level == "stated" and {s.file for s in old.sources} == {"chat", "c2"}


def test_unrelated_is_untouched(monkeypatch):
    store = make_store()
    put(store, mk("a", "rule a", "Erkki", action="x"))
    b = put(store, mk("b", "rule b", "Aino", at=T1, action="y"))
    before = dump(store)
    job, _ = run(store, [b], monkeypatch, fake_llm(lambda n, cs: {}))
    assert dump(store) == before and job.judge == [] and job.flags == [] and job.events == []


def test_llm_failure_changes_nothing_and_never_raises(monkeypatch):
    store = make_store()
    old, fw = firmware_case(store)
    before = dump(store)

    def boom(*a, **k):
        raise RuntimeError("llm down")

    job, _ = run(store, [fw], monkeypatch, boom)
    assert dump(store) == before and job.judge == [] and job.flags == []
    assert any("judge skipped" in n for n in job.notes)


def test_llm_failure_falls_back_to_lifecycle(monkeypatch):
    store = make_store()
    old, fw = firmware_case(store, new_topic="sfp-swap-forwarding-state")

    def boom(*a, **k):
        raise RuntimeError("llm down")

    run(store, [fw], monkeypatch, boom, lifecycle=True)
    assert old.valid_to == fw.valid_from


def test_bad_json_is_a_failure_too(monkeypatch):
    store = make_store()
    old, fw = firmware_case(store)
    before = dump(store)
    job, _ = run(store, [fw], monkeypatch, lambda *a, **k: "not json at all")
    assert dump(store) == before and any("judge skipped" in n for n in job.notes)


def test_unknown_ids_in_output_are_ignored(monkeypatch):
    store = make_store()
    old, fw = firmware_case(store)
    before = dump(store)
    bad = json.dumps({"verdicts": [{"other_id": "ctx_9999", "verdict": "supersedes", "reason": "x"}]})
    job, _ = run(store, [fw], monkeypatch, lambda *a, **k: bad)
    assert dump(store) == before and job.judge == []


def test_toggle_off_does_nothing(monkeypatch):
    store = make_store()
    old, fw = firmware_case(store)
    before = dump(store)
    llm = fake_llm(supersede_rule)
    job, _ = run(store, [fw], monkeypatch, llm, use_judge=False)
    assert llm.calls == [] and dump(store) == before and job.flags == []


@pytest.mark.parametrize("same_topic", [False, True])
def test_lifecycle_after_judge_is_idempotent(monkeypatch, same_topic):
    def build():
        store = make_store()
        topic = "sfp-swap-forwarding-state" if same_topic else "fw-4-2"
        old, fw = firmware_case(store, new_topic=topic)
        a = put(store, mk("first", "Bounce first", "Erkki", at=T0 + timedelta(hours=1), action="bounce"))
        b = put(store, mk("second", "Reseat first", "Aino", at=T0 + timedelta(hours=2), action="reseat"))
        return store, [fw, a, b]

    def rules(new, cands):
        if new["type"] == "invalidation":
            return {c["id"]: ("supersedes", "fix") for c in cands}
        return {c["id"]: ("contradicts", "disagree") for c in cands if c["action"] and c["action"] != new["action"]}

    s1, new1 = build()
    run(s1, new1, monkeypatch, fake_llm(rules))
    s2, new2 = build()
    job, _ = run(s2, new2, monkeypatch, fake_llm(rules), lifecycle=True)
    assert dump(s1) == dump(s2)
    assert not any(e.endswith("both kept, flagged") for e in job.events)  # lifecycle found nothing left to do
    for a in s2.assertions.values():
        assert len(a.conflicts_with) == len(set(a.conflicts_with))


def test_lifecycle_still_works_when_judge_says_unrelated(monkeypatch):
    store = make_store()
    old, fw = firmware_case(store, new_topic="sfp-swap-forwarding-state")
    run(store, [fw], monkeypatch, fake_llm(lambda n, cs: {}), lifecycle=True)
    assert old.valid_to == fw.valid_from  # the fallback path


def test_merged_assertion_never_reaches_lifecycle(monkeypatch):
    store = make_store()
    put(store, mk("a", "Bounce", "Erkki", level="hunch", action="bounce"))
    b = put(store, mk("b", "Bounce works", "Aino", level="stated", at=T1, action="bounce", file="c2"))
    run(store, [b], monkeypatch, fake_llm(always("supports", "same")), lifecycle=True)
    assert all(b.id not in x.conflicts_with and b.id != x.closed_by for x in store.assertions.values())


def test_retract_after_merge(monkeypatch):
    store = make_store()
    old = put(store, mk("a", "Bounce", "Erkki", level="hunch", action="bounce", file="chat1"))
    new = put(store, mk("b", "Bounce works", "Aino", level="verified", at=T1, action="bounce", file="chat2"))
    fw = put(store, mk("fw", "Fix", "Aino", at=T1 + timedelta(hours=1), type_="invalidation", file="chat2"))

    def rules(n, cs):
        verdict = "supersedes" if n["type"] == "invalidation" else "supports"
        return {c["id"]: (verdict, "r") for c in cs}

    run(store, [new, fw], monkeypatch, fake_llm(rules))
    assert new.id not in store.assertions and old.valid_to == fw.valid_from
    wb = SimpleNamespace(store=store)
    wb.drop_assertions = lambda ids: Workbench.drop_assertions(wb, ids)
    gone = Processor(wb).retract("chat2")
    assert gone == [fw.id]
    assert old.valid_to is None and old.closed_by is None  # reopened
    assert [s.file for s in old.sources] == ["chat1"]


def test_candidates_by_binding_not_topic_and_limited():
    store = make_store()
    for i in range(12):
        put(store, mk(f"t{i}", f"rule {i}", f"p{i}", action=f"a{i}", at=T0 + timedelta(minutes=i)))
    new = put(store, mk("topic-nobody-else-has", "new", "Z", action="z", at=T1))
    found = judge.candidates(store, new)
    assert len(found) == judge.MAX_CANDIDATES and new not in found
    store.assertions["ctx_0001"].valid_to = T1
    assert "ctx_0001" not in {x.id for x in judge.candidates(store, new, limit=50)}


def test_merge_into_keeps_edges_and_repoints_references():
    store = make_store()
    a = put(store, mk("a", "rule", "Erkki", level="hunch", action="x"))
    extra = [Binding(entity="TRN-088", role="observed_on")]
    b = put(store, mk("b", "rule", "Aino", level="verified", at=T1, action="x", file="c2", extra=extra))
    c = put(store, mk("c", "other", "Zed", action="y"))
    c.conflicts_with.append(b.id)
    b.conflicts_with.append(c.id)
    store.merge_into(a.id, b)
    assert b.id not in store.assertions and a.trust.level == "verified"
    assert c.conflicts_with == [a.id] and a.conflicts_with == [c.id]
    assert ("TRN-088", "observed_on") in {(x.entity, x.role) for x in a.bound_to}
    assert store.g.has_edge(a.id, "TRN-088")
