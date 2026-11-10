"""Personal tool credentials stay private and only affect their owning workspace."""
import asyncio
from types import SimpleNamespace

import httpx

from context_layer import config, llm
from context_layer.dashboard.demo import COOKIE, create_demo_app


def provider_client(monkeypatch, *, fail_key=None):
    calls = []

    def client(**auth):
        def create(**request):
            calls.append((auth, request))
            if auth["api_key"] == fail_key:
                raise RuntimeError(f"Rejected secret {fail_key}")
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok":true,"items":[]}'))],
                usage=None,
            )
        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)), close=lambda: None)

    monkeypatch.setattr(llm, "OpenAI", client)
    return calls


async def clients(tmp_path, monkeypatch, check):
    monkeypatch.delenv("DEMO_SNAPSHOT_FILE", raising=False)
    app = create_demo_app(tmp_path, background=False)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="https://demo") as first:
            async with httpx.AsyncClient(transport=transport, base_url="https://demo") as second:
                await check(app, first, second)


def test_personal_key_is_private_and_removed_on_disconnect(tmp_path, monkeypatch):
    calls = provider_client(monkeypatch)
    secret = "personal-test-key-not-real"

    async def check(app, first, second):
        connected = await first.post("/api/connections/ai", json={"provider": "mistral", "model": "mistral-small-latest", "api_key": secret})
        assert connected.status_code == 200, connected.text
        assert connected.json()["ai"]["source"] == "session"
        assert connected.json()["ai"]["connected"]
        assert not (await second.get("/api/connections")).json()["ai"]["connected"]
        one = app.state.demo_manager.workspaces[first.cookies[COOKIE]]
        two = app.state.demo_manager.workspaces[second.cookies[COOKIE]]
        assert one.wb.settings.llm_configured
        assert not two.wb.settings.llm_configured
        assert one.wb.settings.extractor_mode != "scripted"
        for path in ("/api/connections", "/api/state", "/api/data/export", "/api/export/session.json", "/api/llm/calls"):
            assert secret not in (await first.get(path)).text
        one.wb.save_now()
        assert secret not in one.wb.state_file.read_text()
        assert calls[0][0]["api_key"] == secret
        assert calls[0][0]["base_url"].startswith("https://api.mistral.ai/")
        disconnected = await first.delete("/api/connections/ai")
        assert disconnected.status_code == 200
        assert not disconnected.json()["ai"]["connected"]
        assert one.wb.settings.extractor_mode == "scripted"
        assert not one.wb.settings.llm_configured

    asyncio.run(clients(tmp_path, monkeypatch, check))


def test_failed_replacement_preserves_working_connection_without_secret_echo(tmp_path, monkeypatch):
    rejected = "rejected-test-key-not-real"
    provider_client(monkeypatch, fail_key=rejected)

    async def check(app, first, second):
        response = await first.post("/api/connections/ai", json={"provider": "mistral", "model": "working-model", "api_key": "working-test-key"})
        assert response.status_code == 200, response.text
        failed = await first.post("/api/connections/ai", json={"provider": "mistral", "model": "replacement-model", "api_key": rejected})
        assert failed.status_code >= 400
        assert rejected not in failed.text
        status = (await first.get("/api/connections")).json()
        assert status["ai"]["model"] == "working-model"
        assert status["ai"]["connected"]
        assert rejected not in (await first.get("/api/llm/calls")).text

    asyncio.run(clients(tmp_path, monkeypatch, check))


def test_public_cannot_choose_arbitrary_provider_endpoint_or_echo_invalid_tokens(tmp_path, monkeypatch):
    calls = provider_client(monkeypatch)
    secret = "invalid-secret-must-not-echo"

    async def check(app, first, second):
        invalid = await first.post("/api/connections/ai", json={"provider": "http://127.0.0.1:9000", "model": "anything", "api_key": secret})
        assert invalid.status_code == 422
        assert secret not in invalid.text
        bad_slack = await first.post("/api/connections/slack", json={"bot_token": secret, "app_token": secret, "channel_id": "wrong"})
        assert bad_slack.status_code == 422
        assert secret not in bad_slack.text
        assert not calls

    asyncio.run(clients(tmp_path, monkeypatch, check))


def test_public_infrastructure_stays_local_even_when_deployment_has_databases(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MONGODB_URI", "mongodb://deployment.invalid")
    monkeypatch.setattr(config, "TIGER_DATABASE_URL", "postgresql://deployment.invalid/database")

    async def check(app, first, second):
        status = (await first.get("/api/connections")).json()
        assert status["public_demo"]
        assert status["infrastructure"] == {"mongodb_configured": False, "tiger_configured": False}

    asyncio.run(clients(tmp_path, monkeypatch, check))


def test_new_conversation_uses_own_key_in_worker_not_deployment_provider(tmp_path, monkeypatch):
    calls = provider_client(monkeypatch)
    monkeypatch.setattr(config, "LLM_API_KEY", "deployment-primary-not-real")
    monkeypatch.setattr(config, "LLM_MODEL", "deployment-model")
    monkeypatch.setattr(config, "LLM_CRITIC_API_KEY", "deployment-critic-not-real")
    monkeypatch.setattr(config, "LLM_CRITIC_MODEL", "deployment-critic-model")

    async def check(app, first, second):
        response = await first.post("/api/connections/ai", json={"provider": "groq", "model": "llama-3.3-70b-versatile", "api_key": "visitor-key-not-real"})
        assert response.status_code == 200, response.text
        calls.clear()
        created = await first.post("/api/threads", json={"source": "teams", "subject": "Private maintenance note"})
        assert created.status_code == 200, created.text
        thread_id = created.json()["id"]
        message = await first.post(f"/api/threads/{thread_id}/messages", json={"author": "Engineer", "text": "TRN-042 access key is held by the on-call engineer."})
        assert message.status_code == 200, message.text
        processed = await first.post(f"/api/threads/{thread_id}/process")
        assert processed.status_code == 202, processed.text
        workspace = app.state.demo_manager.workspaces[first.cookies[COOKIE]]
        await asyncio.gather(*list(workspace.wb.processor._tasks))
        job = workspace.wb.jobs[workspace.wb.threads[thread_id].last_job_id]
        assert job.error is None
        assert job.extractor.startswith("llm")
        assert calls
        assert {auth["api_key"] for auth, _ in calls} == {"visitor-key-not-real"}
        assert all(request["model"] == "llama-3.3-70b-versatile" for _, request in calls)
        assert thread_id not in {t["id"] for t in (await second.get("/api/state")).json()["threads"]}
        assert "visitor-key-not-real" not in (await first.get("/api/export/session.json")).text
        assert (await second.post("/api/threads", json={"subject": "Must stay disabled"})).status_code == 403

    asyncio.run(clients(tmp_path, monkeypatch, check))


def test_slack_channel_listening_is_private_and_disconnect_removes_listener(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock
    from slack_bolt.adapter.socket_mode.aiohttp import AsyncSocketModeHandler
    from slack_sdk.web.async_client import AsyncWebClient

    monkeypatch.setattr(AsyncWebClient, "auth_test", AsyncMock(return_value={"user_id": "UBOT", "bot_id": "BBOT"}))
    monkeypatch.setattr(AsyncWebClient, "conversations_info", AsyncMock(return_value={"channel": {"name": "field-test"}}))
    monkeypatch.setattr(AsyncWebClient, "users_info", AsyncMock(return_value={"user": {"real_name": "Engineer", "profile": {}}}))
    monkeypatch.setattr(AsyncSocketModeHandler, "connect_async", AsyncMock())

    async def check(app, first, second):
        response = await first.post("/api/connections/slack", json={
            "bot_token": "xoxb-test-not-real", "app_token": "xapp-test-not-real", "channel_id": "C12345678",
        })
        assert response.status_code == 200, response.text
        assert response.json()["slack"]["connected"]
        workspace = app.state.demo_manager.workspaces[first.cookies[COOKIE]]
        bridge = workspace.state.slack
        listeners_before = len(workspace.wb._listeners)
        await bridge.handle_slack_event({"channel": "C12345678", "user": "UENGINEER", "text": "Private field note", "ts": "4.2"})
        assert any(t.subject == "Private field note" for t in workspace.wb.threads.values())
        second_state = (await second.get("/api/state")).json()
        assert not any(t["subject"] == "Private field note" for t in second_state["threads"])
        assert not (await second.get("/api/connections")).json()["slack"]["connected"]
        for secret in ("xoxb-test-not-real", "xapp-test-not-real"):
            assert secret not in (await first.get("/api/export/session.json")).text
        response = await first.delete("/api/connections/slack")
        assert response.status_code == 200
        assert not response.json()["slack"]["connected"]
        assert not bridge.connected
        assert len(workspace.wb._listeners) == listeners_before - 1

    asyncio.run(clients(tmp_path, monkeypatch, check))


def test_expired_workspace_does_not_reuse_personal_connection(tmp_path, monkeypatch):
    provider_client(monkeypatch)
    monkeypatch.setenv("DEMO_IDLE_SECONDS", "10")

    async def check(app, first, second):
        connected = await first.post("/api/connections/ai", json={"provider": "mistral", "model": "mistral-small-latest", "api_key": "expired-visitor-key"})
        assert connected.status_code == 200, connected.text
        old_cookie = first.cookies[COOKIE]
        old_workspace = app.state.demo_manager.workspaces[old_cookie]
        old_workspace.last_seen -= 11
        fresh = (await first.get("/api/connections")).json()
        assert first.cookies[COOKIE] != old_cookie
        assert old_workspace.closed
        assert not fresh["ai"]["connected"]
        assert fresh["ai"]["source"] == "none"

    asyncio.run(clients(tmp_path, monkeypatch, check))
