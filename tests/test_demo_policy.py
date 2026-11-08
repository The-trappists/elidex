"""Public demo limits cannot be bypassed through another model role or task."""

from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from types import SimpleNamespace

import pytest

from context_layer import embed, llm
from context_layer.demo_policy import DemoLimitError, DemoPolicy, bind_policy, current_policy


def provider():
    return llm.Provider("primary", "https://example.invalid/v1", "fake", "demo-model", "prompt")


def test_scripted_denies_before_client_or_credentials(monkeypatch):
    monkeypatch.setattr(llm, "OpenAI", lambda **_: pytest.fail("client must not be constructed"))
    monkeypatch.setattr(llm, "providers", lambda *_: pytest.fail("provider discovery must not run"))
    with bind_policy(DemoPolicy()):
        with pytest.raises(DemoLimitError):
            llm.complete("system", "user")
        text, trace, error = llm.call_provider(provider(), "system", "user", json=False)
    assert text is None and isinstance(error, DemoLimitError)
    assert "DemoLimitError" in trace["error"]


def test_attempt_limit_output_cap_and_private_trace(monkeypatch):
    requests, private, global_traces = [], [], []

    def client(**kwargs):
        assert kwargs["max_retries"] == 0
        assert 0 < kwargs["timeout"] <= 60

        def create(**request):
            requests.append(request)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))], usage=None)

        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    monkeypatch.setattr(llm, "OpenAI", client)
    monkeypatch.setattr(llm, "_sinks", [global_traces.append])
    policy = DemoPolicy(trace_sink=private.append, max_calls=2)
    policy.start_run()
    with bind_policy(policy, allow_live=True):
        for role in ("primary", "critic"):
            p = provider()
            p.role = role
            assert llm.call_provider(p, "system", "user", json=False)[0] == "ok"
        assert isinstance(llm.call_provider(provider(), "system", "user", json=False)[2], DemoLimitError)
    assert len(requests) == 2
    assert all(r["max_tokens"] == 4096 for r in requests)
    assert len(private) == 3
    assert global_traces == []


def test_other_requests_cannot_spend_during_live_run():
    policy = DemoPolicy()
    policy.start_run()
    with bind_policy(policy):
        with pytest.raises(DemoLimitError):
            policy.reserve("", "")
        with bind_policy(policy, allow_live=True):
            assert policy.reserve("", "") > 0
        with pytest.raises(DemoLimitError):
            policy.reserve("", "")
    assert current_policy() is None


def test_deadline_context_limit_and_no_replenishment():
    policy = DemoPolicy(max_input_chars=3)
    policy.start_run()
    with bind_policy(policy, allow_live=True):
        with pytest.raises(DemoLimitError, match="context limit"):
            policy.reserve("long", "prompt")
        assert policy.calls == 0
        policy.deadline = 0
        with pytest.raises(DemoLimitError):
            policy.reserve("", "")
    policy.finish_run()
    with pytest.raises(DemoLimitError, match="already"):
        policy.start_run()


def test_embedding_always_offline_in_workspace(monkeypatch):
    monkeypatch.setattr(embed.config, "EMBEDDING_MODEL", "paid-embedding-model")
    monkeypatch.setattr(llm, "providers", lambda *_: pytest.fail("no embeddings provider allowed"))
    with bind_policy(DemoPolicy()):
        assert embed.mode() == "hash:256"
        assert embed.embed(["human knowledge"]) == [embed.hash_embed("human knowledge")]


def test_policy_propagates_to_thread_and_reservations_are_atomic():
    policy = DemoPolicy(max_calls=12)
    policy.start_run()

    # asyncio.to_thread uses this same copy_context().run mechanism.
    with bind_policy(policy, allow_live=True), ThreadPoolExecutor(max_workers=1) as pool:
        assert pool.submit(copy_context().run, current_policy).result(timeout=2) is policy

    def reserve(_):
        with bind_policy(policy, allow_live=True):
            try:
                policy.reserve("", "")
                return True
            except DemoLimitError:
                return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(reserve, range(40))) == 12
