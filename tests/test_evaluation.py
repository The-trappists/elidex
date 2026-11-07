"""Evaluation metric (match on type, scope, action) and the model comparison script, offline."""

import importlib.util
import sys
from pathlib import Path

import pytest

from context_layer.evaluation import action_similarity, link_precision, link_recall, match_items
from context_layer.models import ExtractedItem, Scope

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "eval_models.py"


def item(topic, action=None, instances=("TRN-042",), type="workaround"):
    return ExtractedItem(
        type=type, topic=topic, summary=topic, scope=Scope(instance_ids=list(instances)), action=action,
        trust_level="stated", stated_by="Erkki", cited_seq=[1], confidence=0.9,
    )


def key(i):
    return tuple(sorted(i.scope.instance_ids))


def test_action_similarity():
    assert action_similarity(None, "") == 1.0
    assert action_similarity("Clear the counters", None) == 0.0
    assert action_similarity("clear the counters", "Clear the counters first") == pytest.approx(0.75)


def test_same_knowledge_different_topic_is_matched():
    want = [item("sfp-swap-first-step", "Clear the interface counters first, then check traffic")]
    got = [item("tx-3000-post-sfp-swap-zero-counters", "clear interface counters first and then check the traffic")]
    r = match_items(got, want, key)
    assert r["matched"] == ["sfp-swap-first-step"]
    assert r["missed"] == r["unexpected"] == r["binding_diffs"] == []


def test_same_scope_different_action_is_a_diff():
    want = [item("a", "reboot the node")]
    got = [item("b", "replace the fibre patch cord")]
    r = match_items(got, want, key)
    assert r["matched"] == [] and r["missed"] == [] and r["unexpected"] == []
    assert len(r["binding_diffs"]) == 1 and "different action" in r["binding_diffs"][0]


def test_same_action_different_scope_is_a_diff():
    want = [item("a", "reboot the node", instances=("TRN-042",))]
    got = [item("b", "reboot the node", instances=("TRN-042", "TRN-043"))]
    r = match_items(got, want, key)
    assert r["matched"] == [] and len(r["binding_diffs"]) == 1 and "different scope" in r["binding_diffs"][0]


def test_missed_unexpected_and_one_to_one():
    want = [item("a", "reboot the node"), item("b", "reboot the node")]
    got = [item("x", "reboot the node"), item("y", "check the cable", instances=("TRN-999",))]
    r = match_items(got, want, key)
    assert r["matched"] == ["a"]  # the first expected item takes the only candidate
    assert r["missed"] == ["b"]
    assert r["unexpected"] == ["y"]
    assert match_items(got, want, key) == r  # deterministic


def test_type_must_agree():
    r = match_items([item("a", None, type="fact")], [item("a", None, type="workaround")], key)
    assert r["matched"] == [] and r["missed"] == ["a"] and r["unexpected"] == ["a"]


def test_link_precision_recall():
    want = {("workaround", "TRN-042", "applies_to"), ("workaround", "SITE-1", "observed_on")}
    got = {("workaround", "TRN-042", "applies_to"), ("workaround", "TRN-043", "applies_to")}
    assert link_precision(got, want) == 0.5
    assert link_recall(got, want) == 0.5
    assert link_precision(set(), set()) == link_recall(set(), set()) == 1.0
    assert link_precision(set(), want) == 0.0


def test_evaluate_keeps_contract():
    from context_layer.link import Inventory
    from context_layer.workbench.processor import evaluate

    want = [item("sfp-swap-first-step", "clear counters")]
    res = evaluate([item("other-name", "clear counters")], want, Inventory.load())
    assert res.matched == ["sfp-swap-first-step"]


# ---------------------------------------------------------------- script


@pytest.fixture(scope="module")
def script():
    spec = importlib.util.spec_from_file_location("eval_models", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["eval_models"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_scripted_mode_is_perfect_on_its_own_expected_items(script, capsys):
    assert script.main(["--scripted"]) == 0
    out = capsys.readouterr().out
    assert "scripted (expected items)" in out
    scenarios, personas, inv = script.load_context()
    tot = script.score("s", scenarios, personas, inv, script.scripted_extract)
    assert tot.missed == tot.unexpected == tot.binding_diffs == 0
    assert tot.matched >= len(scenarios) > 0
    assert tot.precision == tot.recall == 1.0 and tot.calls == 0


def test_dry_run_prints_plan_and_calls_nothing(script, capsys, monkeypatch):
    from context_layer import llm

    def boom(*a, **k):
        raise AssertionError("no LLM call allowed")

    monkeypatch.setattr(llm, "call_provider", boom)
    assert script.main(["--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "Dry run" in out and "EVAL_KEY_MODEL_A" in out and "Estimated total" in out


def test_run_requires_confirmation(script, capsys):
    assert script.main(["--run"]) == 2


def test_run_mode_with_mocked_extractor_writes_reports(script, tmp_path, monkeypatch):
    monkeypatch.setattr(script, "llm_extract", lambda cand: script.scripted_extract)
    cands = tmp_path / "c.json"
    cands.write_text('[{"name": "m", "base_url": "http://x", "model": "m", "api_key_env": "NOPE"}]')
    assert script.main(["--run", "--yes-spend-credits", "--candidates", str(cands)], out_dir=tmp_path / "eval") == 0
    assert len(list((tmp_path / "eval").glob("*.md"))) == 1
    assert len(list((tmp_path / "eval").glob("*.json"))) == 1
