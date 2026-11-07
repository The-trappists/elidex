"""LLM roles: critic provider chain, silent fallback to primary, model override, no keys in traces."""

import httpx
import openai
import pytest

from context_layer import config, llm


def _set(monkeypatch, **vals):
    for k, v in vals.items():
        monkeypatch.setattr(config, k, v)


PRIMARY = dict(LLM_BASE_URL="http://p", LLM_API_KEY="pk", LLM_MODEL="pm", LLM_FALLBACK_BASE_URL="", LLM_FALLBACK_API_KEY="", LLM_FALLBACK_MODEL="")
CRITIC = dict(
    LLM_CRITIC_BASE_URL="http://c", LLM_CRITIC_API_KEY="ck", LLM_CRITIC_MODEL="cm", LLM_CRITIC_JSON_MODE="json_object",
    LLM_CRITIC_FALLBACK_BASE_URL="", LLM_CRITIC_FALLBACK_API_KEY="", LLM_CRITIC_FALLBACK_MODEL="",
)
CRITIC_FB = dict(LLM_CRITIC_FALLBACK_BASE_URL="http://g", LLM_CRITIC_FALLBACK_API_KEY="gk", LLM_CRITIC_FALLBACK_MODEL="gm")


def test_primary_chain_unchanged(monkeypatch):
    _set(monkeypatch, **PRIMARY)
    assert [(p.name, p.model) for p in llm.providers()] == [("primary", "pm")]
    assert [(p.name, p.model) for p in llm.providers("primary", "other")] == [("primary", "other")]


def test_critic_chain_with_fallback(monkeypatch):
    _set(monkeypatch, **PRIMARY, **{**CRITIC, **CRITIC_FB})
    chain = llm.providers("critic")
    assert [(p.name, p.base_url, p.model, p.role) for p in chain] == [
        ("critic", "http://c", "cm", "critic"),
        ("critic_fallback", "http://g", "gm", "critic"),
    ]
    assert llm.providers("critic", "x")[0].model == "x"


def test_unconfigured_critic_falls_back_to_primary_silently(monkeypatch):
    _set(monkeypatch, **PRIMARY, LLM_CRITIC_API_KEY="", LLM_CRITIC_MODEL="", LLM_CRITIC_FALLBACK_API_KEY="", LLM_CRITIC_FALLBACK_MODEL="")
    assert not config.llm_critic_configured()
    chain = llm.providers("critic")
    assert [(p.name, p.role) for p in chain] == [("primary", "critic")]
    assert "not configured" in chain[0].role_note


def test_complete_traced_uses_role_and_traces_it(monkeypatch):
    _set(monkeypatch, **PRIMARY, **CRITIC)
    seen = []

    def fake(p, system, user, **kw):
        seen.append((p.name, p.model))
        return "ok", {"id": "llm_1", "provider": p.name, "role": p.role, "model": p.model, "error": None}, None

    monkeypatch.setattr(llm, "call_provider", fake)
    text, traces = llm.complete_traced("s", "u", role="critic", model="override")
    assert text == "ok" and seen == [("critic", "override")] and traces[0]["role"] == "critic"
    assert llm.complete("s", "u", role="critic") == "ok"


def test_critic_failure_goes_to_critic_fallback_not_primary(monkeypatch):
    _set(monkeypatch, **PRIMARY, **{**CRITIC, **CRITIC_FB})
    order = []

    def fake(p, system, user, **kw):
        order.append(p.name)
        if p.name == "critic":
            return None, {"id": "a"}, openai.APIConnectionError(request=httpx.Request("POST", "http://c"))
        return "fine", {"id": "b"}, None

    monkeypatch.setattr(llm, "call_provider", fake)
    text, traces = llm.complete_traced("s", "u", role="critic")
    assert text == "fine" and order == ["critic", "critic_fallback"] and len(traces) == 2


def test_trace_never_holds_a_key(monkeypatch):
    def no_network(**kw):
        raise RuntimeError("offline")

    monkeypatch.setattr(llm, "OpenAI", no_network)
    p = llm.Provider("critic", "http://c", "SECRET-KEY", "cm", "json_object", role="critic")
    _, trace, exc = llm.call_provider(p, "s", "u", json=False, emit=False)
    assert exc is not None and trace["role"] == "critic"
    assert "SECRET-KEY" not in str(trace)


def test_no_provider_at_all_raises(monkeypatch):
    _set(
        monkeypatch, LLM_API_KEY="", LLM_MODEL="", LLM_CRITIC_API_KEY="", LLM_CRITIC_MODEL="",
        LLM_FALLBACK_API_KEY="", LLM_FALLBACK_MODEL="", LLM_CRITIC_FALLBACK_API_KEY="", LLM_CRITIC_FALLBACK_MODEL="",
    )
    with pytest.raises(RuntimeError):
        llm.complete_traced("s", "u", role="critic")
