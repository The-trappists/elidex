"""End-to-end checks on Elisa's case, offline (cached extractions)."""

from datetime import datetime

import pytest

from context_layer.agent import load_cases, run_agent
from context_layer.mvp import guard
from context_layer.pipeline import build_store

BEFORE_FIX = datetime(2026, 10, 20, 8, 0)
AFTER_FIX = datetime(2026, 11, 5, 10, 0)
CLASS_ID = "class:transmission_node:installed-upto-2019"


@pytest.fixture(scope="module")
def core():
    return build_store()[0]


@pytest.fixture(scope="module")
def with_lifecycle():
    return build_store(lifecycle=True)[0]


def _rule(store):
    return next(a for a in store.assertions.values() if a.topic == "sfp-swap-forwarding-state" and a.type == "workaround")


def test_chat_and_email_are_one_assertion_with_two_sources(core):
    rule = _rule(core)
    assert {s.file for s in rule.sources} == {"elisa/teams_chat.json", "elisa/email.txt"}
    assert rule.trust.level == "verified"
    assert rule.trust.role == "Network Expert"


def test_rule_bound_to_class_instance_and_trigger(core):
    roles = {(b.entity, b.role) for b in _rule(core).bound_to}
    assert (CLASS_ID, "applies_to") in roles
    assert ("TRN-042", "observed_on") in roles
    assert ("event:sfp-replacement", "trigger") in roles


def test_reuse_on_another_old_node_but_not_a_new_one(core):
    assert [h.matched_via for h in core.get_context("TRN-117", at=BEFORE_FIX)] == [CLASS_ID]
    assert core.get_context("TRN-305", at=BEFORE_FIX) == []
    assert core.get_context("TRN-208", at=BEFORE_FIX) == []  # 2020: not "older"


def test_access_fact_reaches_element_through_its_site(core):
    hits = core.get_context("RAD-221", at=AFTER_FIX)
    assert [h.assertion.type for h in hits] == ["access"]


def test_lifecycle_closes_the_rule(with_lifecycle):
    rule = _rule(with_lifecycle)
    assert rule.valid_to == datetime(2026, 10, 30, 8, 40)
    types_after = {h.assertion.type for h in with_lifecycle.get_context("TRN-117", at=AFTER_FIX)}
    assert types_after == {"invalidation"}


def test_conditions_stop_the_rule_when_counters_move(core):
    case = next(c for c in load_cases() if c.id == "counters-moving")
    report = run_agent(core, case, use_conditions=True)
    assert report.hits == [] and len(report.skipped) == 1


def test_guard_adapts_reboot_and_dispatch(core):
    assert guard.check(core, "Reboot TRN-117", "TRN-117", at=BEFORE_FIX).decision == "adapt"
    assert guard.check(core, "Reboot TRN-305", "TRN-305", at=BEFORE_FIX).decision == "go"
    dispatch = guard.check(core, "Dispatch field engineer to RAD-221", "RAD-221", at=AFTER_FIX)
    assert dispatch.decision == "adapt" and "key" in dispatch.steps[0]



def test_same_author_or_same_advice_merges_other_authors_do_not(core):
    from context_layer.store import same_knowledge

    rule = _rule(core)
    other_author = rule.model_copy(deep=True)
    other_author.trust.stated_by, other_author.action = "Someone Else", "Reseat the module first."
    same_advice = rule.model_copy(deep=True)
    same_advice.trust.stated_by = "Someone Else"
    same_author = rule.model_copy(deep=True)
    same_author.action = "Another wording."
    assert not same_knowledge(rule, other_author)
    assert same_knowledge(rule, same_advice)
    assert same_knowledge(rule, same_author)
