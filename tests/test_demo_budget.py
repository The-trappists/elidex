"""Monetary demo limits reserve before requests and survive concurrency/restarts."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import json
from types import SimpleNamespace

import httpx
import pytest

from context_layer import config, llm
from context_layer.dashboard.demo import COOKIE, create_demo_app
from context_layer.demo_policy import BudgetLedger, DemoLimitError, DemoPolicy, ModelPrice, PriceCatalog, bind_policy


BASE = "https://example.invalid/v1"
MODEL = "test-model"
RATES = json.dumps({f"{BASE}|{MODEL}": {"input": "1", "output": "2", "output_cap_includes_reasoning": True}})


def provider():
    return llm.Provider("primary", BASE, "fake", MODEL, "prompt")


def policy(tmp_path, **kwargs):
    return DemoPolicy(ledger=BudgetLedger(tmp_path / "budget.sqlite3", **kwargs), prices=PriceCatalog(RATES),
                      workspace_id="visitor", budget_required=True)


def test_reservations_persist_and_cannot_overdraw_workspace(tmp_path):
    first = BudgetLedger(tmp_path / "budget.sqlite3")
    first.reserve("visitor", 400_000)
    restarted = BudgetLedger(tmp_path / "budget.sqlite3")
    assert restarted.snapshot("visitor")["budget_remaining_eur"] == .1
    with pytest.raises(DemoLimitError, match="Your live AI budget"):
        restarted.reserve("visitor", 100_001)
    assert restarted.snapshot("other")["budget_remaining_eur"] == .5
    assert restarted.snapshot("other")["global_budget_remaining_eur"] == 99.6


def test_atomic_global_reservations_across_ledger_instances(tmp_path):
    path = tmp_path / "budget.sqlite3"
    first, second = BudgetLedger(path, global_limit="1"), BudgetLedger(path, global_limit="1")
    def reserve(index):
        try:
            (first if index % 2 else second).reserve(f"visitor-{index}", 10_000)
            return True
        except DemoLimitError:
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(reserve, range(150))) == 100
    assert first.snapshot("nobody")["global_budget_remaining_eur"] == 0


def test_reconcile_once_releases_only_known_unused_usage(tmp_path):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3")
    reservation = ledger.reserve("visitor", 500_000)
    assert not ledger.snapshot("visitor")["budget_available"]
    ledger.settle(reservation, 50_000)
    ledger.settle(reservation, 0)
    state = ledger.snapshot("visitor")
    assert state["budget_reserved_eur"] == 0
    assert state["budget_spent_eur"] == .05
    assert state["budget_remaining_eur"] == .45


def test_hard_maximums_cannot_be_raised_by_configuration(tmp_path):
    ledger = BudgetLedger(tmp_path / "budget.sqlite3", workspace_limit="50", global_limit="1000")
    assert ledger.snapshot("visitor")["budget_limit_eur"] == .5
    assert ledger.snapshot("visitor")["global_budget_remaining_eur"] == 100


@pytest.mark.parametrize("raw", ["", "{}", "[]", "not json", '{"x|model":{"input":1,"output":2}}'])
def test_unconfigured_or_unverified_prices_fail_closed(raw):
    catalog = PriceCatalog(raw)
    with pytest.raises(DemoLimitError):
        catalog.get(BASE, MODEL)


def test_no_provider_client_when_rate_missing_or_budget_too_small(tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "OpenAI", lambda **_: pytest.fail("No provider request allowed"))
    for priced in (False, True):
        p = policy(tmp_path, workspace_limit="0.000001")
        if not priced:
            p.prices = PriceCatalog()
        p.start_run()
        with bind_policy(p, allow_live=True):
            text, _, error = llm.call_provider(provider(), "system", "user", json=False)
        assert text is None and isinstance(error, DemoLimitError)
    assert p.ledger.snapshot("visitor")["budget_spent_eur"] == 0


def test_provider_usage_charges_and_missing_usage_holds_reservation(tmp_path, monkeypatch):
    responses = [SimpleNamespace(model_dump=lambda: {"prompt_tokens": 100, "completion_tokens": 20}), None]
    requests = []
    def create(**request):
        requests.append(request)
        assert p.ledger.snapshot("visitor")["budget_reserved_eur"] > 0
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))], usage=responses.pop(0))
    monkeypatch.setattr(llm, "OpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    p = policy(tmp_path)
    p.start_run()
    with bind_policy(p, allow_live=True):
        assert llm.call_provider(provider(), "system", "user", json=False)[2] is None
        assert p.ledger.snapshot("visitor")["budget_spent_eur"] == .00014
        assert p.ledger.snapshot("visitor")["budget_reserved_eur"] == 0
        assert llm.call_provider(provider(), "system", "user", json=False)[2] is None
    state = p.ledger.snapshot("visitor")
    assert state["budget_spent_eur"] == .00014
    assert state["budget_reserved_eur"] > 0
    assert len(requests) == 2 and all(r["max_tokens"] == 4096 for r in requests)


def test_fallback_attempts_share_budget_and_failed_calls_keep_reservations(tmp_path, monkeypatch):
    calls = []
    def create(**request):
        calls.append(request)
        if len(calls) == 1:
            response = httpx.Response(503, request=httpx.Request("POST", BASE + "/chat/completions"))
            raise llm.openai.APIStatusError("retry", response=response, body={})
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
                               usage=SimpleNamespace(model_dump=lambda: {"prompt_tokens": 100, "completion_tokens": 20}))
    monkeypatch.setattr(llm, "OpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    primary, fallback = provider(), provider()
    fallback.name = "fallback"
    monkeypatch.setattr(llm, "providers", lambda *args, **kwargs: [primary, fallback])
    p = policy(tmp_path)
    p.start_run()
    with bind_policy(p, allow_live=True):
        assert llm.complete("system", "user") == "ok"
    assert p.calls == 2
    assert p.ledger.snapshot("visitor")["budget_reserved_eur"] > 0
    assert p.ledger.snapshot("visitor")["budget_spent_eur"] == .00014


def test_schema_utf8_and_request_framing_are_reserved(tmp_path):
    p = policy(tmp_path)
    request = {"messages": [{"content": "你好"}], "response_format": {"schema": {"description": "x" * 8000}}}
    reservation = p.reserve_budget(BASE, MODEL, request)
    maximum_input = len(json.dumps(request, ensure_ascii=False).encode("utf-8")) + 2048
    expected = ModelPrice(Decimal("1"), Decimal("2")).cost_micro(maximum_input, 4096)
    assert reservation
    assert p.ledger.snapshot("visitor")["budget_reserved_eur"] == expected / 1_000_000


def test_error_keeps_full_reservation_and_overrun_blocks_every_workspace(tmp_path, monkeypatch):
    def fail(**_):
        raise RuntimeError("connection outcome unknown")
    monkeypatch.setattr(llm, "OpenAI", fail)
    p = policy(tmp_path)
    p.start_run()
    with bind_policy(p, allow_live=True):
        assert llm.call_provider(provider(), "system", "user", json=False)[2]
    assert p.ledger.snapshot("visitor")["budget_reserved_eur"] > 0
    reservation = p.ledger.reserve("other", 100)
    p.ledger.settle(reservation, 101)
    assert not p.ledger.snapshot("third")["budget_available"]
    with pytest.raises(DemoLimitError, match="exceeded"):
        p.ledger.reserve("third", 1)


def test_api_budget_survives_reset_and_unknown_prices_do_not_spend_run(tmp_path, monkeypatch):
    async def check():
        monkeypatch.setenv("DEMO_LIVE_ENABLED", "1")
        monkeypatch.setenv("DEMO_GLOBAL_BUDGET_EUR", "0.50")
        monkeypatch.setenv("DEMO_MODEL_PRICES_EUR", RATES)
        monkeypatch.setattr(config, "llm_configured", lambda: True)
        monkeypatch.setattr(llm, "providers", lambda *args, **kwargs: [provider()])
        app = create_demo_app(tmp_path, background=False)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://demo") as client:
                before = (await client.get("/api/demo")).json()
                assert before["budget_limit_eur"] == .5 and before["live_run_available"]
                workspace = app.state.demo_manager.workspaces[client.cookies[COOKIE]]
                app.state.demo_manager.prices = PriceCatalog()
                assert (await client.post("/api/demo/live-run")).status_code == 503
                assert not workspace.policy.used
                app.state.demo_manager.prices = workspace.policy.prices
                workspace.policy.ledger.reserve(workspace.id, 500_000)
                assert (await client.post("/api/data/reset", json={})).status_code == 200
                after = (await client.get("/api/demo")).json()
                assert after["budget_remaining_eur"] == 0 and after["global_budget_remaining_eur"] == 0
                assert not after["live_run_available"]
                assert (await client.post("/api/demo/live-run")).status_code == 503
        # A new server instance sees the same reservations, even though workspaces expired.
        restarted = create_demo_app(tmp_path, background=False)
        assert restarted.state.demo_manager.budget.snapshot("new")["global_budget_remaining_eur"] == 0
    asyncio.run(check())


def test_live_disabled_by_default_even_with_pricing(tmp_path, monkeypatch):
    monkeypatch.delenv("DEMO_LIVE_ENABLED", raising=False)
    monkeypatch.setenv("DEMO_MODEL_PRICES_EUR", RATES)
    monkeypatch.setattr(config, "llm_configured", lambda: True)
    manager = create_demo_app(tmp_path, background=False).state.demo_manager
    assert "paused" in manager.live_unavailable_reason("visitor")
