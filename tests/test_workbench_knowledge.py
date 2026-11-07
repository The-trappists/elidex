"""Knowledge polish backend: justification, dedupe, fewer flags. Offline, hand-built assertions."""

from datetime import datetime

from context_layer import config
from context_layer.models import Binding, Check, Condition, ContextAssertion, Outcome, SourceRef, Trust
from context_layer.workbench import dedupe, justify
from context_layer.workbench.contracts import CriticVerdict, JudgeVerdict, PipelineJob, Scenario, ScenarioMessage
from context_layer.models import ExtractionResult
from test_review_backend import item, process, run_thread, flags, jobs_of  # noqa: F401
from test_workbench_core import client, seeded  # noqa: F401

T0 = datetime(2026, 3, 1, 9, 0)


def make(wb, aid="x", action="Wait five minutes after the swap", who="Erkki", level="stated", thread="t1", applies="TRN-042",
         avoid=(), conditions=(), confidence=0.9, **kw):
    a = ContextAssertion(
        id=aid, type=kw.pop("type", "workaround"), topic=kw.pop("topic", "wait-after-swap"), summary="s", action=action,
        bound_to=[Binding(entity=applies, role="applies_to")], avoid=list(avoid), conditions=list(conditions),
        valid_from=T0, trust=Trust(level=level, stated_by=who, role="Network Expert"),
        sources=[SourceRef(source="teams", file=thread, seq=[1])], confidence=confidence, **kw,
    )
    wb.store._index(a)
    return a


# ---------------------------------------------------------------- justification


def test_justification_factors(client):
    seeded(client)
    wb = client.app.state.wb
    a = make(wb, "j1", level="verified", confidence=0.56, link_notes=["class wider than stated ('old')"])
    a.trust.confirmed_by = ["Maria"]
    a.trust.evidence = "link came back"
    a.sources.append(SourceRef(source="email", file="t2", seq=[2]))
    a.conflicts_with = ["other"]
    a.outcomes = [
        Outcome(entity="TRN-042", at=T0, worked=False, evidence="still DOWN"),
        Outcome(entity="TRN-042", at=T0, worked=True, evidence="UP", source="thread", quote="fixed it"),
    ]
    job = PipelineJob(id="job_9", thread_id="t1", started_at=T0, assertion_ids=["j1"])
    job.critic = [CriticVerdict(item_topic="wait-after-swap", verdict="downgrade", reason="too wide", evidence_found=True, confidence_after=0.7)]
    job.judge = [JudgeVerdict(new_assertion_id="j1", other_assertion_id="ctx_9", verdict="supports", reason="same fix")]
    wb.jobs[job.id] = job
    r = client.get("/api/assertions/j1/justification")
    assert r.status_code == 200
    j = r.json()
    assert j["trust_level"] == "verified" and j["n_sources"] == 2 and j["source_thread_ids"] == ["t1", "t2"]
    tf = {f["label"]: f for f in j["trust_factors"]}
    assert "Maria" in tf["Backed by others"]["detail"] and tf["Backed by others"]["effect"] == "supports"
    assert "Contradicted" in tf and tf["Track record in the field"]["effect"] == "limits"
    assert "fixed it" in tf["Human field report"]["detail"]
    assert "Network Expert" in tf["Level is verified"]["detail"] and "link came back" in tf["Level is verified"]["detail"]
    cf = {f["label"]: f for f in j["confidence_factors"]}
    assert j["critic"] == {"verdict": "downgrade", "reason": "too wide", "other_assertion_id": None}
    assert "too wide" in cf["Critic: downgrade"]["detail"] and "70%" in cf["Critic: downgrade"]["detail"]
    assert cf["Scope wider than stated"]["effect"] == "limits" and "0.8" in cf["Scope wider than stated"]["detail"]
    assert cf["Judge: supports ctx_9"]["effect"] == "supports" and j["judge"][0]["other_assertion_id"] == "ctx_9"
    assert "Failed in the field" in cf and "0.7" in cf["Failed in the field"]["detail"]
    assert cf["Independent sources"]["effect"] == "supports" and "Erkki, Maria" in cf["Independent sources"]["detail"]
    assert j["track_record"]["failed"] == 1


def test_justification_not_recorded_and_404(client):
    seeded(client)
    wb = client.app.state.wb
    make(wb, "j2", applies="class:transmission_node:tx-3000")
    j = client.get("/api/assertions/j2/justification").json()
    cf = {f["label"]: f for f in j["confidence_factors"]}
    assert "Not recorded" in cf["Extractor confidence"]["detail"] and cf["Critic"]["effect"] == "neutral"
    assert "Not recorded" in cf["Judge"]["detail"] and "Bound to a class" in cf
    assert cf["Independent sources"]["effect"] == "limits"
    assert "Single voice" in {f["label"]: f for f in j["trust_factors"]}
    assert client.get("/api/assertions/nope/justification").status_code == 404


# ---------------------------------------------------------------- dedupe


def test_same_advice_twice_merges_and_boosts_once(client):
    seeded(client)
    wb = client.app.state.wb
    old = make(wb, "d1", thread="t1", confidence=0.8)
    new = make(wb, "d2", action="wait five minutes after the swap.", who="Maria", thread="t2", confidence=0.8)
    new.outcomes = [Outcome(entity="TRN-042", at=T0, worked=True, evidence="UP")]
    m = dedupe.dedupe_new(wb, new)
    assert m and m.kept_id == "d1" and m.merged_id == "d2" and m.method == "exact"
    assert "d2" not in wb.store.assertions
    assert [s.file for s in old.sources] == ["t1", "t2"] and old.trust.confirmed_by == ["Maria"]
    assert old.confidence == 0.83 and len(old.outcomes) == 1
    assert dedupe.report(wb).merged_total == 1


def test_word_similarity_merges_and_embedding_fallback(client, monkeypatch):
    seeded(client)
    wb = client.app.state.wb
    make(wb, "d1", action="Reboot the line card and wait for the optics to settle")
    n = make(wb, "d2", action="reboot the line card, wait for optics to settle", who="Maria", thread="t2")
    assert dedupe.dedupe_new(wb, n).method == "words"
    make(wb, "d3", action="Power cycle the module")
    n = make(wb, "d4", action="Restart the transceiver", who="Pekka", thread="t3")
    assert dedupe.dedupe_new(wb, n) is None
    monkeypatch.setitem(dedupe._vectors, dedupe.advice_text(wb.store.assertions["d3"]), [1.0, 0.0])
    monkeypatch.setitem(dedupe._vectors, dedupe.advice_text(n), [0.99, 0.1])
    m = dedupe.dedupe_new(wb, n)
    assert m and m.method == "embedding" and m.kept_id == "d3"
    monkeypatch.setattr(config, "EMBEDDING_MODEL", "")
    dedupe.warm_vectors(["x"])  # no model: nothing happens, no network


def test_look_alikes_never_merge(client):
    seeded(client)
    wb = client.app.state.wb
    make(wb, "d1", avoid=["power cycle"])
    same = "Wait five minutes after the swap"
    cases = [
        make(wb, "n1", action=same, avoid=["reboot"], who="A", thread="a"),  # different avoid
        make(wb, "n2", action=same, applies="TRN-043", who="B", thread="b"),  # different scope
        make(wb, "n3", action="Do not wait five minutes after the swap", avoid=["power cycle"], who="C", thread="c"),  # opposite
        make(wb, "n4", action="Wait fifteen minutes after the swap".replace("fifteen", "15"), avoid=["power cycle"], who="D", thread="d"),
        make(wb, "n5", action=same, avoid=["power cycle"], conditions=[Condition(text="x", check=Check(field="interface_status", op="==", value="DOWN"))], who="E", thread="e"),
        make(wb, "n6", action=same, avoid=["power cycle"], type="fact", who="F", thread="f"),
    ]
    for c in cases:
        assert dedupe.dedupe_new(wb, c) is None, c.id
    # the first one has a different number too
    wb.store.assertions["d1"].action = "Wait 5 minutes after the swap"
    assert dedupe.dedupe_new(wb, make(wb, "n7", action="Wait 5 minutes after the swap", avoid=["power cycle"], who="G", thread="g")).kept_id == "d1"


def test_contradiction_and_closed_never_merge(client):
    seeded(client)
    wb = client.app.state.wb
    a = make(wb, "d1")
    b = make(wb, "d2", who="Maria", thread="t2")
    b.conflicts_with = ["d1"]
    assert dedupe.dedupe_new(wb, b) is None
    b.conflicts_with = []
    a.valid_to = T0
    assert dedupe.dedupe_new(wb, b) is None
    a.valid_to, b.valid_to = None, T0
    assert dedupe.dedupe_new(wb, b) is None


def test_dedupe_store_one_shot_and_routes(client):
    seeded(client)
    wb = client.app.state.wb
    make(wb, "d1")
    make(wb, "d2", who="Maria", thread="t2")
    make(wb, "d3", who="Pekka", thread="t3", applies="TRN-043")
    r = client.post("/api/knowledge/dedupe/run").json()
    assert r["merged_total"] == 1 and r["recent"][0]["kept_id"] == "d1" and r["threshold"] == 0.85 and r["enabled"] is True
    assert set(wb.store.assertions) >= {"d1", "d3"} and "d2" not in wb.store.assertions
    assert client.post("/api/knowledge/dedupe/run").json()["merged_total"] == 1  # idempotent
    assert client.get("/api/knowledge/dedupe").json()["merged_total"] == 1


def test_pipeline_dedupes_and_reprocessing_is_idempotent(client):
    seeded(client)
    wb = client.app.state.wb
    ta, ja = run_thread(client, [item("fix-a", action="Wait five minutes after the swap")])
    first = ja["assertion_ids"][0]
    tb, jb = run_thread(client, [item("fix-b", action="Wait five minutes after the swap.")], sid="rv2", author="Erkki")
    # same author + same action: the core already merges it; dedupe must not break that
    assert jb["assertion_ids"] == [first]
    before = len(wb.store.assertions)
    process(client, tb)
    process(client, tb)
    assert len(wb.store.assertions) == before
    assert {s.file for s in wb.store.assertions[first].sources} == {ta, tb}


def test_pipeline_folds_other_author_and_setting_off(client):
    seeded(client)
    wb = client.app.state.wb
    ta, ja = run_thread(client, [item("fix-a", action="Reboot the line card and wait for the optics to settle")])
    first = ja["assertion_ids"][0]
    wb.settings.use_dedupe = False
    n = len(wb.store.assertions)
    # a different author whose text is a look-alike: the core keeps both when dedupe is off
    tb, jb = run_thread(client, [item("fix-b", action="reboot the line card, wait for optics to settle")], sid="rv2", author="Maria")
    off_ids = jb["assertion_ids"]
    assert off_ids != [first] and len(wb.store.assertions) == n + 1
    wb.settings.use_dedupe = True
    tc, jc = run_thread(client, [item("fix-c", action="Reboot the line card, wait for optics to settle.")], sid="rv3", author="Pekka")
    assert jc["assertion_ids"] == [first] and any("dedupe:" in e for e in jc["events"])
    assert len(wb.store.assertions) == n + 1
    assert wb.dedupe_total >= 1
    process(client, tc)  # idempotent
    assert len(wb.store.assertions) == n + 1
    assert {s.file for s in wb.store.assertions[first].sources} >= {ta, tc}


# ---------------------------------------------------------------- fewer flags


def test_no_flags_for_assertion_folded_into_supported_one(client):
    seeded(client)
    wb = client.app.state.wb
    ta, ja = run_thread(client, [item("fix-a", action="Reboot the line card and wait for the optics to settle", confidence=0.72)])
    run_thread(client, [item("fix-b", action="reboot the line card, wait for optics to settle", confidence=0.72)], sid="rv2", author="Maria")
    before = len(flags(client))
    wb.store.assertions[ja["assertion_ids"][0]].confidence = 0.5  # would be flagged as low confidence
    tc, jc = run_thread(client, [item("fix-c", action="Reboot the line card, wait for optics to settle.", confidence=0.5)], sid="rv3", author="Pekka")
    assert jc["assertion_ids"] == ja["assertion_ids"]
    assert not [f for f in flags(client, thread_id=tc) if f["kind"] in ("low_confidence", "conflict", "over_reach")]
    assert len(flags(client)) == before


def test_conflict_flag_not_repeated_for_same_pair_across_threads(client):
    seeded(client)
    wb = client.app.state.wb
    run_thread(client, [item("adv", action="Wait five minutes")], author="Erkki")
    t2, j2 = run_thread(client, [item("adv", action="Replace the card at once")], sid="rv2", author="Maria")
    pair_flags = [f for f in flags(client, kind="conflict")]
    assert len(pair_flags) == 1
    process(client, t2)
    t3, j3 = run_thread(client, [item("adv", action="Replace the card at once")], sid="rv3", author="Maria")
    assert len(flags(client, kind="conflict")) == 1
