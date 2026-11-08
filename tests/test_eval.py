"""Accuracy evaluation, offline: the harness itself must tell good answers from bad ones."""

import pytest

from context_layer.eval import kb as kbmod
from context_layer.eval import run_eval
from context_layer.eval.extraction import score_extraction
from context_layer.eval.kb import build_kb, load_spec
from context_layer.eval.retrieval import score_retrieval


@pytest.fixture(scope="module")
def result():
    return run_eval("scripted")


def test_labels_reference_real_scenarios_and_topics():
    spec = load_spec()
    kb = build_kb(spec, "scripted")
    scenario_ids = {r.scenario.id for r in kb.runs}
    assert {e.scenario for e in spec.timeline} == scenario_ids
    known = {f"{i.type}:{i.topic}" for r in kb.runs for i in r.extracted}
    for c in spec.cases:
        assert set(c.expect) | set(c.acceptable) <= known, c.id
    assert len({c.id for c in spec.cases}) == len(spec.cases)


def test_scripted_extraction_is_perfect_by_construction(result):
    s = result["extraction"]["summary"]
    assert s["item_recall"] == s["item_precision"] == s["message_precision"] == 1.0


def test_conditions_remove_noise_without_losing_solutions(result):
    plain, cond = (r["summary"] for r in result["retrieval"])
    assert plain["noise_items"] > 0 and plain["accuracy"] < 1.0
    assert cond["noise_items"] == 0
    assert cond["solution_found"] == plain["solution_found"] == 1.0


def test_a_worse_extractor_scores_worse(monkeypatch):
    """Drop Erkki's chat items and rename every topic like an LLM would: recall drops, labels still map."""

    def fake(mode):
        def extract(s, t, topics):
            if s.id == "elisa-trn042-chat" or not s.expected:
                return []
            return [i.model_copy(update={"topic": "llm-" + i.topic}) for i in s.expected.items]
        return extract

    monkeypatch.setattr(kbmod, "_extractor", fake)
    spec = load_spec()
    kb = build_kb(spec, "scripted")
    ex = score_extraction(kb)
    s = ex.summary()
    assert s["item_recall"] < 1.0 and s["item_precision"] == 1.0
    assert ("elisa-trn042-email", "workaround", "llm-sfp-swap-forwarding-state") in ex.label_of
    cond = score_retrieval(kb, spec, ex.label_of, use_conditions=True).summary()
    assert cond["solution_found"] == 1.0  # the email and the TRN-117 chat still carry the rule


def test_invented_items_count_as_noise(monkeypatch):
    def fake(mode):
        def extract(s, t, topics):
            items = list(s.expected.items) if s.expected else []
            if s.id == "noise-chitchat":
                ref = next(x for x in load_seed_items() if x.topic == "frost-margin-dip-self-recovers")
                items.append(ref.model_copy(update={"topic": "coffee-machine-fix", "cited_seq": [1]}))
            return items
        return extract

    monkeypatch.setattr(kbmod, "_extractor", fake)
    ex = score_extraction(build_kb(load_spec(), "scripted")).summary()
    assert ex["item_precision"] < 1.0
    assert ex["noise_threads_left_empty"] < 1.0


def load_seed_items():
    from context_layer.dashboard.seed import load_seed

    return [i for s in load_seed().scenarios if s.expected for i in s.expected.items]


def test_missing_observations_never_lose_the_solution(result):
    rows = result["missing_observations"]["by_missing"]
    assert rows[0]["missing"] == 0 and rows[0]["accuracy"] == 1.0
    assert all(r["solution_lost"] == 0 for r in rows)  # unchecked rules are kept, never dropped
    assert rows[-1]["accuracy"] < rows[0]["accuracy"]  # but noise comes back when the agent knows less


def test_fully_checked_knowledge_is_safe_to_act_on(result):
    status = {r["status"]: r for r in result["missing_observations"]["by_status"]}
    assert status["fully checked"]["noise"] == 0
    assert status["not fully checked"]["noise"] > 0  # the noise is where the agent is told to read first


def test_report_back_conflicts_with_the_vendor_hunch():
    """A later chat saying 'the tip did not work here' keeps both, flagged; one node does not close a class rule."""
    store = build_kb(load_spec(), "scripted").store
    tips = [a for a in store.assertions.values() if a.topic == "tx5000-sync-after-power-dip"]
    hunch = next(a for a in tips if a.trust.level == "hunch")
    report = next(a for a in tips if a.trust.level == "verified")
    assert report.id in hunch.conflicts_with and hunch.valid_to is None
    assert report.applies_to == {"TRN-229"}


def test_field_feedback_is_learnt_without_false_alarms(result):
    ff = result["field_feedback"]
    assert ff["judgment_right"] == 1.0
    assert ff["contested_right"] == 1.0 and ff["false_alarms"] == 0
    assert any(c["got"] for c in ff["contested_cases"])  # the vendor hunch did get contested
