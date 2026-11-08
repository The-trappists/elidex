"""Knowledge polish round 2, offline: justification with LLM-shaped data, dedupe calibration and safety rule,
wall-time zones of the AI activity log."""

import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from context_layer import config, llm
from context_layer.models import ExtractedItem, Scope
from context_layer.dashboard import dedupe, justify, llm_compact
from context_layer.dashboard.contracts import CriticVerdict, JudgeVerdict, LlmCall, LlmSummary, PipelineJob, to_utc_iso
from test_dashboard_core import client, seeded  # noqa: F401
from test_dashboard_export_compact import make_app
from test_dashboard_knowledge import T0, make

# ---------------------------------------------------------------- 4 / 1: justification is faithful


def _item(conf):
    return ExtractedItem(
        type="workaround", topic="wait-after-swap", summary="s", scope=Scope(instance_ids=["TRN-042"]), action="wait",
        trust_level="stated", stated_by="Erkki", cited_seq=[1], confidence=conf,
    )


def test_justification_with_llm_shaped_data_is_faithful(client):
    seeded(client)
    wb = client.app.state.wb
    a = make(wb, "k1", who="Erkki", confidence=0.8, thread="t1")
    a.sources.append(a.sources[0].model_copy(update={"file": "t2"}))
    job = PipelineJob(id="job_7", thread_id="t1", started_at=T0, assertion_ids=["k1"], items=[_item(0.8)])
    job.critic = [CriticVerdict(
        item_topic="wait-after-swap", verdict="downgrade", reason="Erkki said 'usually', not always.", evidence_found=True,
        confidence_after=0.8, confidence_before=0.95,
    )]
    job.judge = [
        JudgeVerdict(new_assertion_id="k1", other_assertion_id="o1", verdict="supports", reason="Both say wait after the swap."),
        JudgeVerdict(new_assertion_id="k1", other_assertion_id="o2", verdict="contradicts", reason="o2 says do not wait."),
        JudgeVerdict(new_assertion_id="o3", other_assertion_id="k1", verdict="supersedes", reason="Newer firmware note."),
    ]
    wb.jobs[job.id] = job
    j = justify.justify(wb, "k1")
    cf = {f.label: f for f in j.confidence_factors}
    assert cf["Extractor confidence"].detail == (
        "The extraction step gave 95%; the second check lowered it to 80%: Erkki said 'usually', not always.")
    assert "Erkki said 'usually', not always." in cf["Critic: downgrade"].detail
    assert cf["Judge: supports o1"].detail == "Both say wait after the swap." and cf["Judge: supports o1"].effect == "supports"
    assert cf["Judge: contradicts o2"].detail == "o2 says do not wait." and cf["Judge: contradicts o2"].effect == "limits"
    assert cf["Judge: supersedes o3"].detail == "Newer firmware note."
    assert [n.verdict for n in j.judge] == ["supports", "contradicts", "supersedes"]
    assert "2 source reference(s) in 2 thread(s) from 1 person(s): Erkki" in cf["Independent sources"].detail
    # no invented numbers or names: every percentage and id in the text comes from the recorded data
    import re

    text = " ".join(f.detail + f.label for f in j.confidence_factors + j.trust_factors) + j.trust_summary + j.confidence_summary
    assert set(re.findall(r"\d+%", text)) <= {"95%", "80%"}
    assert set(re.findall(r"\b(?:o\d|ctx_\d+)\b", text)) <= {"o1", "o2"} | {"o3"}


def test_old_job_without_confidence_before_still_works(client):
    seeded(client)
    wb = client.app.state.wb
    make(wb, "k2")
    job = PipelineJob(id="job_8", thread_id="t1", started_at=T0, assertion_ids=["k2"], items=[_item(0.6)])
    job.critic = [CriticVerdict.model_validate(
        {"item_topic": "wait-after-swap", "verdict": "downgrade", "reason": "vague", "evidence_found": True, "confidence_after": 0.6})]
    wb.jobs[job.id] = job
    cf = {f.label: f for f in justify.justify(wb, "k2").confidence_factors}
    assert cf["Extractor confidence"].detail == "The extraction step gave 60% to this item."


def test_verified_single_voice_reads_coherently(client):
    seeded(client)
    wb = client.app.state.wb
    make(wb, "v1", level="verified", who="Erkki")
    tf = [f.label for f in justify.justify(wb, "v1").trust_factors]
    assert "Single voice" not in tf and "Confirmed by a field report, not by a second person" in tf
    f = next(x for x in justify.justify(wb, "v1").trust_factors if x.label.startswith("Confirmed by a field report"))
    assert "nobody else backed it" not in f.detail and "only person" in f.detail
    make(wb, "v2", level="stated", who="Erkki")
    assert "Single voice" in [f.label for f in justify.justify(wb, "v2").trust_factors]


# ---------------------------------------------------------------- 2: dedupe calibration and safety rule


def test_calibration_no_false_merge_and_table(capsys):
    pairs = dedupe.load_pairs()
    res = dedupe.evaluate(pairs)
    assert res["n_same"] >= 30 and res["n_different"] >= 30
    by_t = {r["threshold"]: r for r in res["rows"]}
    assert by_t[0.85]["rule"]["fp"] == 0  # the full rule never merges a look-alike at the default threshold
    assert all(r["rule"]["fp"] == 0 for r in res["rows"])
    print(dedupe.render_table(res))  # pytest -s -k calibration: the table copied into docs/dashboard.md


def test_threshold_env_default():
    assert config.DEDUPE_THRESHOLD == 0.90


def test_embedding_alone_cannot_merge_specifics(client, monkeypatch):
    seeded(client)
    wb = client.app.state.wb

    def cos09(a, b):  # injected vectors with cosine 0.9
        monkeypatch.setitem(dedupe._vectors, dedupe.advice_text(a), [1.0, 0.0])
        monkeypatch.setitem(dedupe._vectors, dedupe.advice_text(b), [0.9, 0.436])

    old = make(wb, "e1", action="Power cycle the module")
    same = make(wb, "e2", action="Restart the transceiver", thread="t2")
    cos09(old, same)
    hit = dedupe.compare(wb.store, old, same)
    assert hit and hit[1] == "embedding"  # control: nothing differs, so the embedding may merge
    nums = make(wb, "e3", action="Restart the transceiver 5 times", thread="t3")
    old3 = make(wb, "e4", action="Power cycle the module 3 times", thread="t4")
    cos09(old3, nums)
    assert dedupe.compare(wb.store, old3, nums) is None  # different numbers
    spelled = make(wb, "e5", action="Restart the transceiver five times", thread="t5")
    cos09(old3, spelled)
    assert dedupe.compare(wb.store, old3, spelled) is None  # three vs five
    neg = make(wb, "e6", action="Never restart the transceiver", thread="t6")
    cos09(old, neg)
    assert dedupe.compare(wb.store, old, neg) is None  # negation
    avoid = make(wb, "e7", action="Restart the transceiver", avoid=["replace it"], thread="t7")
    cos09(old, avoid)
    assert dedupe.compare(wb.store, old, avoid) is None  # avoid list
    other = make(wb, "e8", action="Restart the transceiver", applies="TRN-043", thread="t8")
    cos09(old, other)
    assert dedupe.compare(wb.store, old, other) is None  # scope
    # same reach but not the same named things: strict scope fails
    a, b = make(wb, "e9", applies="TRN-042"), make(wb, "e10", applies="class:x")
    assert dedupe._strict_scope(a, a) and not dedupe._strict_scope(a, b)


def test_dedupe_threshold_is_configurable(client, monkeypatch):
    seeded(client)
    wb = client.app.state.wb
    old = make(wb, "c1", action="Reboot the line card and wait for the optics to settle")
    new = make(wb, "c2", action="reboot the line card, wait for optics to fully settle", thread="t2")
    monkeypatch.setattr(config, "DEDUPE_THRESHOLD", 0.85)  # this pair scores between 0.85 and 0.90
    hit = dedupe.compare(wb.store, old, new)
    assert hit and hit[1] == "words" and hit[0] < 0.99
    monkeypatch.setattr(config, "DEDUPE_THRESHOLD", 0.99)
    assert dedupe.compare(wb.store, old, new) is None
    assert dedupe.report(wb).threshold == 0.99


# ---------------------------------------------------------------- 3: wall times are aware UTC


def test_llm_trace_ts_is_aware_utc(monkeypatch):
    from types import SimpleNamespace

    class FakeClient:
        def __init__(self, **kw):
            msg = SimpleNamespace(message=SimpleNamespace(content="ok"))
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **k: SimpleNamespace(choices=[msg], usage=None)))

    monkeypatch.setattr(llm, "OpenAI", FakeClient)  # no network
    p = llm.Provider(name="primary", base_url="http://x", api_key="k", model="m", json_mode="prompt")
    _, trace, exc = llm.call_provider(p, "s", "u", json=False, emit=False)
    assert exc is None
    assert datetime.fromisoformat(trace["ts"]).utcoffset() == timedelta(0) and trace["ts"].endswith("+00:00")
    assert LlmCall.model_validate({**trace, "usage": {}}).ts.tzinfo is not None


def test_llm_call_and_summary_serialise_utc():
    naive_local = datetime(2026, 11, 8, 12, 0, 0)  # old log line: local wall time
    c = LlmCall(id="llm_1", ts=naive_local, purpose="extract", provider="primary", base_url="x", model="m", system="s", user="u")
    expect = naive_local.astimezone(timezone.utc).isoformat()
    assert json.loads(c.model_dump_json())["ts"] == expect and expect.endswith("+00:00")
    aware = LlmCall.model_validate_json(json.dumps({**json.loads(c.model_dump_json()), "id": "llm_2"}))
    assert aware.ts.tzinfo is not None and aware.ts == c.ts.astimezone()
    s = LlmSummary(total_kept=1, oldest=naive_local, newest=naive_local, last_compacted_at=naive_local)
    d = json.loads(s.model_dump_json())
    assert d["oldest"] == d["newest"] == d["last_compacted_at"] == expect
    assert LlmSummary(total_kept=0).model_dump(mode="json")["oldest"] is None and to_utc_iso(None) is None


def test_compaction_mixes_naive_and_aware_lines(tmp_path, monkeypatch):
    live = tmp_path / "llm_calls.jsonl"
    now = datetime.now()
    old_naive = LlmCall(id="llm_000000000001", ts=now - timedelta(minutes=5), purpose="extract", provider="primary", base_url="x",
                        model="m", system="s", user="a")
    line_old = json.loads(old_naive.model_dump_json())
    line_old["ts"] = (now - timedelta(minutes=5)).isoformat(timespec="milliseconds")  # as written before this change
    line_new = {**line_old, "id": "llm_000000000002", "user": "b", "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds")}
    live.write_text(json.dumps(line_old) + "\n" + json.dumps(line_new) + "\n")
    with TestClient(make_app(tmp_path, monkeypatch)) as c:
        calls = c.get("/api/llm/calls").json()
        assert [x["id"] for x in calls] == ["llm_000000000002", "llm_000000000001"]  # newest first, no naive/aware crash
        assert all(x["ts"].endswith("+00:00") for x in calls)
        s = c.post("/api/llm/compact").json()
        assert s["total_kept"] == 2 and s["newest"].endswith("+00:00") and s["last_compacted_at"].endswith("+00:00")
        assert abs(datetime.fromisoformat(s["newest"]) - datetime.now(timezone.utc)) < timedelta(minutes=1)
    assert llm_compact._naive(datetime.now(timezone.utc)) - datetime.now() < timedelta(seconds=5)
