"""Field feedback: learn from outcomes that knowledge does not work, without dropping it on one failure."""

from datetime import datetime

from context_layer.models import Check, Condition, ContextAssertion, Trust
from context_layer.mvp import feedback

T = datetime(2026, 10, 20, 9, 0)


def _rule(*conds: Condition) -> ContextAssertion:
    return ContextAssertion(type="workaround", topic="t", summary="s", bound_to=[], valid_from=datetime(2026, 1, 1),
                            trust=Trust(level="hunch", stated_by="x"), sources=[], confidence=0.5, conditions=list(conds))


DOWN = Condition(text="link down", check=Check(field="interface_status", op="==", value="DOWN"))
SWAPPED = Condition(text="after a swap", check=Check(field="sfp_replaced", op="==", value=True))
WORDS = Condition(text="after a storm")


def test_symptom_still_there_means_it_did_not_work():
    assert feedback.judge(_rule(DOWN), {"interface_status": "DOWN"})[0] is False
    assert feedback.judge(_rule(DOWN), {"interface_status": "UP"})[0] is True


def test_event_fields_are_not_symptoms():
    """sfp_replaced stays true after any fix: it must not make every outcome a failure."""
    assert feedback.judge(_rule(SWAPPED, DOWN), {"sfp_replaced": True, "interface_status": "UP"})[0] is True
    assert feedback.judge(_rule(SWAPPED), {"sfp_replaced": True})[0] is None


def test_no_verdict_when_nothing_to_judge():
    assert feedback.record(_rule(DOWN), "TRN-1", T, {}) is None
    assert feedback.record(_rule(WORDS), "TRN-1", T, {"interface_status": "UP"}) is None


def test_explicit_report_overrides():
    a = _rule(WORDS)
    assert feedback.record(a, "TRN-1", T, {}, worked=False).worked is False


def test_one_failure_is_not_enough_to_contest():
    a = _rule(DOWN)
    feedback.record(a, "TRN-1", T, {"interface_status": "DOWN"})
    assert feedback.track_record(a).status == "ok"
    feedback.record(a, "TRN-2", T.replace(day=21), {"interface_status": "DOWN"})
    tr = feedback.track_record(a)
    assert tr.status == "contested" and tr.failed_on == ["TRN-1", "TRN-2"]


def test_successes_outweigh_failures():
    a = _rule(DOWN)
    for day, state in [(20, "DOWN"), (21, "DOWN"), (22, "UP"), (23, "UP"), (24, "UP")]:
        feedback.record(a, "TRN-1", T.replace(day=day), {"interface_status": state})
    assert feedback.track_record(a).status == "ok"


def test_track_record_is_as_of_the_case_time():
    a = _rule(DOWN)
    feedback.record(a, "TRN-1", T, {"interface_status": "DOWN"})
    feedback.record(a, "TRN-2", T.replace(day=22), {"interface_status": "DOWN"})
    assert feedback.track_record(a, T.replace(day=21)).status == "ok"
    assert feedback.track_record(a, T.replace(day=23)).status == "contested"
