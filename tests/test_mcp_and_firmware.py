"""Tests for element-level firmware expiry and enhanced MCP get_context with observations."""

from datetime import datetime
from unittest.mock import patch

import pytest

from context_layer.agent import Case, run_agent
from context_layer.link import Inventory
from context_layer.mcp_server import get_context
from context_layer.models import (
    Check,
    Condition,
    ContextAssertion,
    NetworkElement,
    Site,
    SourceRef,
    Trust,
    parse_version,
)
from context_layer.mvp.lifecycle import reconcile
from context_layer.store import ContextStore


def test_parse_version():
    assert parse_version("4.2") == (4, 2)
    assert parse_version("4.10") == (4, 10)
    assert parse_version("v3.8.1") == (3, 8, 1)
    assert parse_version("not_a_version") is None
    assert parse_version(None) is None


def test_check_evaluate_numeric_versions():
    # Crucial test: "4.10" must be greater than "4.2", unlike lexical string comparison
    chk_lt = Check(field="firmware", op="<", value="4.2")
    assert chk_lt.evaluate({"firmware": "3.8"}) is True
    assert chk_lt.evaluate({"firmware": "4.2"}) is False
    assert chk_lt.evaluate({"firmware": "4.10"}) is False

    chk_gte = Check(field="firmware", op=">=", value="4.2")
    assert chk_gte.evaluate({"firmware": "3.8"}) is False
    assert chk_gte.evaluate({"firmware": "4.2"}) is True
    assert chk_gte.evaluate({"firmware": "4.10"}) is True

    # Missing field
    assert chk_lt.evaluate({}) is None


def test_firmware_lifecycle_and_element_level_retrieval():
    # Setup inventory: TRN-042 on 3.8, TRN-117 on 4.2
    elements = [
        NetworkElement(id="TRN-042", type="transmission_node", model="TX-3000", install_year=2019, firmware="3.8"),
        NetworkElement(id="TRN-117", type="transmission_node", model="TX-3000", install_year=2018, firmware="4.2"),
    ]
    inv = Inventory(elements, [Site(id="SITE-1", name="Site One")])
    store = ContextStore(inv)

    # Initial workaround on TRN-042 and TRN-117
    rule = ContextAssertion(
        id="ctx_0001",
        type="workaround",
        topic="sfp-bounce",
        summary="Bounce interface after SFP swap",
        bound_to=[{"entity": "TRN-042", "role": "applies_to"}, {"entity": "TRN-117", "role": "applies_to"}],
        valid_from=datetime(2026, 10, 20, 10, 0),
        trust=Trust(level="verified", stated_by="Erkki Expert"),
        sources=[SourceRef(source="teams", file="chat.json", seq=[1])],
        confidence=0.9,
    )
    store.add_assertion(rule)

    # Invalidation announcing Firmware 4.2 fixes the bug
    invalidation = ContextAssertion(
        id="ctx_0002",
        type="invalidation",
        topic="sfp-bounce",
        summary="Firmware 4.2 fixes forwarding-state bug after optical module swap",
        fact="Firmware 4.2 fixes the bug; bounce is obsolete",
        bound_to=[{"entity": "TRN-042", "role": "applies_to"}, {"entity": "TRN-117", "role": "applies_to"}],
        valid_from=datetime(2026, 10, 30, 8, 0),
        trust=Trust(level="stated", stated_by="Aino Arkkitehti"),
        sources=[SourceRef(source="teams", file="rollout.json", seq=[1])],
        confidence=0.95,
    )
    store.add_assertion(invalidation)

    # Reconcile sets valid_to and attaches firmware < 4.2 condition
    events = reconcile(store, invalidation)
    assert any("ctx_0001 closed" in e for e in events)
    assert rule.valid_to == datetime(2026, 10, 30, 8, 0)
    fw_cond = next((c for c in rule.conditions if c.check and c.check.field == "firmware"), None)
    assert fw_cond is not None and fw_cond.check.value == "4.2"

    # Evaluated against element observations:
    # TRN-042 (firmware 3.8) condition holds (< 4.2)
    assert fw_cond.check.evaluate({"firmware": "3.8"}) is True
    # TRN-117 (firmware 4.2) condition fails (not < 4.2)
    assert fw_cond.check.evaluate({"firmware": "4.2"}) is False

    # At t after rollout (2026-11-05), invalidation is returned
    hits_after = store.get_context("TRN-117", at=datetime(2026, 11, 5, 10, 0))
    assert [h.assertion.id for h in hits_after] == ["ctx_0002"]


def test_agent_auto_fills_firmware_and_checks_condition():
    elements = [
        NetworkElement(id="TRN-042", type="transmission_node", model="TX-3000", install_year=2019, firmware="3.8"),
    ]
    inv = Inventory(elements, [])
    store = ContextStore(inv)
    rule = ContextAssertion(
        id="ctx_0001",
        type="workaround",
        topic="sfp-bounce",
        summary="Bounce interface",
        conditions=[Condition(text="firmware < 4.2", check=Check(field="firmware", op="<", value="4.2"))],
        bound_to=[{"entity": "TRN-042", "role": "applies_to"}],
        valid_from=datetime(2026, 10, 20, 10, 0),
        trust=Trust(level="verified", stated_by="Erkki Expert"),
        sources=[SourceRef(source="teams", file="chat.json", seq=[1])],
        confidence=0.9,
    )
    store.add_assertion(rule)

    case = Case(
        id="case-1",
        title="Check TRN-042",
        entity_id="TRN-042",
        at=datetime(2026, 10, 25, 10, 0),
        description="TRN-042 SFP was replaced",
        observations={},  # firmware omitted
    )

    # run_agent with use_conditions=True fills firmware from inventory ("3.8" < "4.2")
    rep = run_agent(store, case, use_conditions=True)
    assert len(rep.hits) == 1
    assert rep.checks["ctx_0001"].status == "fully checked"


def test_mcp_get_context_with_observations():
    elements = [
        NetworkElement(id="TRN-042", type="transmission_node", model="TX-3000", install_year=2019, firmware="3.8"),
    ]
    inv = Inventory(elements, [])
    store = ContextStore(inv)
    rule = ContextAssertion(
        id="ctx_0001",
        type="workaround",
        topic="sfp-bounce",
        summary="Bounce interface",
        conditions=[
            Condition(text="interface DOWN", check=Check(field="interface_status", op="==", value="DOWN")),
            Condition(text="traffic zero", check=Check(field="traffic_counters", op="==", value=0)),
        ],
        bound_to=[{"entity": "TRN-042", "role": "applies_to"}],
        valid_from=datetime(2026, 10, 20, 10, 0),
        trust=Trust(level="verified", stated_by="Erkki Expert"),
        sources=[SourceRef(source="teams", file="chat.json", seq=[1])],
        confidence=0.9,
    )
    store.add_assertion(rule)

    with patch("context_layer.mcp_server._store", return_value=store):
        # 1. Without observations: track_record is present, check_status is not computed
        res_plain = get_context("TRN-042", at="2026-10-25T10:00:00")
        assert len(res_plain) == 1
        assert "track_record" in res_plain[0]
        assert "check_status" not in res_plain[0]

        # 2. With partial observations: check_status is "not fully checked", to_read points to missing field
        res_partial = get_context("TRN-042", at="2026-10-25T10:00:00", observations={"interface_status": "DOWN"})
        assert len(res_partial) == 1
        assert res_partial[0]["check_status"] == "not fully checked"
        assert res_partial[0]["to_read"] == ["traffic_counters"]

        # 3. With full observations: check_status is "fully checked"
        res_full = get_context(
            "TRN-042", at="2026-10-25T10:00:00", observations={"interface_status": "DOWN", "traffic_counters": 0}
        )
        assert len(res_full) == 1
        assert res_full[0]["check_status"] == "fully checked"
        assert res_full[0]["condition_applies"] is True
