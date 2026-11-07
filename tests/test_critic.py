"""Critic: deterministic evidence check, LLM verdicts (mocked), failure path, hook, qualifier note in the linker."""

import asyncio
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from context_layer import critic, llm
from context_layer.link import Inventory, Linker
from context_layer.models import ClassCriteria, ExtractedItem, Message, Scope, Thread
from context_layer.workbench.contracts import PipelineJob, Settings
from context_layer.workbench.processor import HookContext, clear_hooks, run_hooks

T0 = datetime(2026, 10, 20, 8, 0)


def _thread() -> Thread:
    texts = ["power cycled TRN-088", "the old   TX-3000s need a manual clear on the uplink", "kiitos"]
    msgs = [
        Message(thread_id="t1", source="teams", seq=i, author="Veikko", sent_at=T0 + timedelta(minutes=i), text=t)
        for i, t in enumerate(texts, 1)
    ]
    return Thread(id="t1", source="teams", messages=msgs)


def _item(topic="clear-uplink", quote="The OLD TX-3000s need a manual clear", conf=0.8) -> ExtractedItem:
    return ExtractedItem(
        type="workaround", topic=topic, summary="s", scope=Scope(instance_ids=["TRN-088"]), action="clear",
        trust_level="stated", stated_by="Veikko", cited_seq=[2], evidence_quote=quote, confidence=conf,
    )


def _mock_llm(monkeypatch, verdicts, calls=None):
    def fake(system, user, json_mode=False, **kw):
        if calls is not None:
            calls.append(kw)
        return json.dumps({"verdicts": verdicts}), [{"id": "llm_x1"}]

    monkeypatch.setattr(llm, "complete_traced", fake)


def test_evidence_check_is_whitespace_and_case_normalised():
    th = _thread()
    assert critic.evidence_found(_item(), th)
    assert not critic.evidence_found(_item(quote="restart the whole cabinet"), th)
    assert not critic.evidence_found(_item(quote="power cycled TRN-088"), th)  # only in seq 1, not cited
    assert critic.evidence_found(_item(quote=None), th)  # nothing to check


def test_keep_reject_downgrade(monkeypatch):
    items = [_item("a"), _item("b"), _item("c")]
    calls: list = []
    _mock_llm(
        monkeypatch,
        [
            {"index": 0, "verdict": "keep", "reason": "fine"},
            {"index": 1, "verdict": "reject", "reason": "text never says that"},
            {"index": 2, "verdict": "downgrade", "reason": "'old' is vague", "confidence_after": 0.5},
        ],
        calls,
    )
    kept, verdicts, flags = critic.critique(items, _thread(), job_id="job_1")
    assert [i.topic for i in kept] == ["a", "c"]
    assert kept[1].confidence == 0.5 and items[2].confidence == 0.8  # input untouched
    assert [v.verdict for v in verdicts] == ["keep", "reject", "downgrade"]
    assert verdicts[2].confidence_after == 0.5 and verdicts[0].evidence_found
    assert verdicts[2].confidence_before == 0.8 and verdicts[0].confidence_before is None  # original value kept
    assert {f.kind for f in flags} == {"critic_rejected", "over_reach"}
    rej = next(f for f in flags if f.kind == "critic_rejected")
    assert "text never says that" in rej.message and "manual clear" in rej.message and rej.job_id == "job_1"
    assert calls[0]["role"] == "critic" and calls[0]["purpose"] == "critic"


def test_missing_quote_lowers_confidence_even_when_llm_keeps(monkeypatch):
    _mock_llm(monkeypatch, [{"index": 0, "verdict": "keep", "reason": "ok"}])
    kept, verdicts, flags = critic.critique([_item(quote="invented words")], _thread())
    assert verdicts[0].verdict == "downgrade" and not verdicts[0].evidence_found
    assert kept[0].confidence == pytest.approx(0.56) and flags[0].kind == "low_confidence"


def test_no_items_no_llm_call(monkeypatch):
    monkeypatch.setattr(llm, "complete_traced", lambda *a, **k: pytest.fail("must not call the LLM"))
    assert critic.critique([], _thread()) == ([], [], [])


def test_bad_json_raises(monkeypatch):
    monkeypatch.setattr(llm, "complete_traced", lambda *a, **k: ("not json", []))
    with pytest.raises(Exception):
        critic.critique([_item()], _thread())


def _ctx(items, use_critic=True, extractor="llm:m"):
    job = PipelineJob(id="job_1", thread_id="t1", started_at=datetime.now(), extractor=extractor)
    wb = SimpleNamespace(now=lambda: T0)
    return HookContext(wb=wb, job=job, thread=None, core=_thread(), items=items, settings=Settings(use_critic=use_critic))


@pytest.fixture(autouse=True)
def _llm_key(monkeypatch):
    from context_layer import config

    monkeypatch.setattr(config, "llm_configured", lambda: True)  # the agents stay quiet without a key


def test_hook_replaces_items_and_fills_job(monkeypatch):
    _mock_llm(monkeypatch, [{"index": 0, "verdict": "reject", "reason": "no"}, {"index": 1, "verdict": "keep", "reason": "ok"}])
    clear_hooks()
    critic.install()
    ctx = _ctx([_item("a"), _item("b")])
    try:
        out = asyncio.run(run_hooks("after_understand", ctx))
    finally:
        clear_hooks()
    assert [i.topic for i in out] == ["b"]
    assert len(ctx.job.critic) == 2 and len(ctx.job.flags) == 1 and "llm_x1" in ctx.job.llm_call_ids


def test_hook_is_off_without_toggle_or_llm_extractor(monkeypatch):
    monkeypatch.setattr(llm, "complete_traced", lambda *a, **k: pytest.fail("no call expected"))
    assert asyncio.run(critic._after_understand(_ctx([_item()], use_critic=False))) is None
    ctx = _ctx([_item()], extractor="scripted")
    assert asyncio.run(critic._after_understand(ctx)) is None and ctx.job.notes == []
    # no LLM key: silent, no call, no note
    monkeypatch.setattr("context_layer.config.llm_configured", lambda: False)
    ctx = _ctx([_item()])
    assert asyncio.run(critic._after_understand(ctx)) is None and ctx.job.notes == []


def test_hook_failure_keeps_items_and_notes(monkeypatch):
    def fail(*a, **k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(llm, "complete_traced", fail)
    ctx = _ctx([_item()])
    assert asyncio.run(critic._after_understand(ctx)) is None
    assert "critic failed" in ctx.job.notes[0] and ctx.job.flags == [] and ctx.job.critic == []


def test_linker_notes_qualifier_class_and_scales_confidence():
    inv = Inventory.load()
    el = next(e for e in inv.elements.values() if e.type == "transmission_node")
    crit = ClassCriteria(type=el.type, model=el.model)
    base = dict(type="workaround", topic="t", summary="s", action="a", trust_level="stated", stated_by="V", cited_seq=[1], confidence=0.8)
    th = _thread()
    th.messages[0].text = f"power cycled {el.id}"  # the linker binds only ids the thread names
    plain = Linker(inv).link(ExtractedItem(scope=Scope(element_class=crit), **base), th)
    vague = Linker(inv).link(ExtractedItem(scope=Scope(element_class=crit, qualifier="old"), **base), th)
    assert plain.assertion.confidence == 0.8
    assert vague.assertion.confidence == pytest.approx(0.64)
    assert "class wider than stated ('old')" in vague.notes
    # no class: the qualifier changes nothing
    inst = Linker(inv).link(ExtractedItem(scope=Scope(instance_ids=[el.id], qualifier="old"), **base), th)
    assert inst.assertion.confidence == 0.8 and not any("wider" in n for n in inst.notes)


def test_install_all_installs_critic_and_skips_missing_modules():
    from context_layer.workbench import loop_agents
    from context_layer.workbench.processor import _HOOKS

    clear_hooks()
    loop_agents._installed.discard("critic")
    try:
        names = loop_agents.install_all()
        assert "critic" in names and critic._after_understand in _HOOKS["after_understand"]
    finally:
        clear_hooks()
        loop_agents._installed.discard("critic")
