"""Loop v2 contract: new optional fields, new models and the processor hook registry."""

import asyncio
from datetime import datetime

import pytest

from context_layer.models import ExtractedItem
from context_layer.workbench import processor
from context_layer.workbench.contracts import (
    STAGES,
    CriticVerdict,
    JudgeVerdict,
    OperatorEdit,
    PipelineJob,
    RerunBody,
    ReviewFlag,
    Settings,
    SettingsPatch,
)

OLD_ITEM = {
    "type": "workaround",
    "topic": "t",
    "summary": "s",
    "scope": {"instance_ids": [], "site_ids": [], "element_class": None, "trigger": None},
    "trust_level": "stated",
    "stated_by": "erkki",
    "cited_seq": [1],
    "confidence": 0.8,
}


def test_old_cached_item_validates():
    item = ExtractedItem.model_validate(OLD_ITEM)
    assert item.evidence_quote is None and item.scope.qualifier is None


def test_new_fields_round_trip():
    d = {**OLD_ITEM, "evidence_quote": "hello", "scope": {**OLD_ITEM["scope"], "qualifier": "old"}}
    item = ExtractedItem.model_validate(d)
    assert ExtractedItem.model_validate_json(item.model_dump_json()) == item
    assert item.scope.qualifier == "old"


def test_new_models_and_defaults():
    flag = ReviewFlag(id="f1", kind="abstained", thread_id="t", job_id="j", message="m", created_at=datetime.now())
    assert not flag.dismissed
    assert ReviewFlag.model_validate_json(flag.model_dump_json()) == flag
    CriticVerdict(item_topic="x", verdict="keep", reason="r", evidence_found=True)
    JudgeVerdict(new_assertion_id="a", other_assertion_id="b", verdict="supersedes", reason="r")
    job = PipelineJob(id="job_1", thread_id="t", started_at=datetime.now())
    assert job.flags == [] and job.critic == [] and job.judge == []
    assert len(STAGES) == 5
    s = Settings()
    assert not (s.use_critic or s.use_judge or s.use_outcome_loop)
    assert SettingsPatch(use_critic=True).model_dump(exclude_none=True) == {"use_critic": True}
    assert RerunBody().from_stage == "link"
    assert OperatorEdit(summary="x").action is None


def _ctx():
    job = PipelineJob(id="job_1", thread_id="t", started_at=datetime.now())
    item = ExtractedItem.model_validate(OLD_ITEM)
    return processor.HookContext(wb=None, job=job, thread=None, core=None, items=[item])


def test_hooks_run_replace_and_swallow_errors():
    processor.clear_hooks()
    calls = []

    def boom(ctx):
        raise RuntimeError("nope")

    async def replace(ctx):
        calls.append("replace")
        return []

    processor.register_hook("after_understand", boom)
    processor.register_hook("after_understand", replace)
    ctx = _ctx()
    out = asyncio.run(processor.run_hooks("after_understand", ctx))
    assert out == [] and calls == ["replace"]
    assert any("boom" in n and "nope" in n for n in ctx.job.notes)
    # no hook registered for this name: nothing happens
    assert asyncio.run(processor.run_hooks("after_store", _ctx())) is None
    processor.clear_hooks()


def test_unknown_hook_name_rejected():
    with pytest.raises(ValueError):
        processor.register_hook("nope", lambda ctx: None)
