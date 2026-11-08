"""Public visitors never share mutable state or acquire unbounded API access."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime

import httpx

from context_layer import config, llm
from context_layer.dashboard.demo import COOKIE, create_demo_app
from context_layer.dashboard.contracts import LlmCall
from context_layer.demo_policy import current_policy


@asynccontextmanager
async def demo(tmp_path, monkeypatch, **env):
    monkeypatch.delenv("DEMO_SNAPSHOT_FILE", raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, str(value))
    app = create_demo_app(tmp_path, background=False)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://demo") as first:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://demo") as second:
                yield app, first, second


def test_private_state_health_and_api_controls(tmp_path, monkeypatch):
    async def check():
        async with demo(tmp_path, monkeypatch) as (app, first, second):
            assert (await first.get("/api/health")).status_code == 200
            assert not first.cookies and not app.state.demo_manager.workspaces
            assert (await first.get("/api/demo")).json()["enabled"]
            assert (await second.get("/api/demo")).json()["enabled"]
            assert first.cookies[COOKIE] != second.cookies[COOKIE]
            one, two = (app.state.demo_manager.workspaces[c.cookies[COOKIE]] for c in (first, second))
            assert one.wb.store.assertions and two.wb.store.assertions
            assert one.state.slack is None and two.state.slack is None
            one.wb.create_thread(source="teams", origin="manual", subject="Only visitor one", participants=[])
            assert any(t.subject == "Only visitor one" for t in one.wb.threads.values())
            assert not any(t.subject == "Only visitor one" for t in two.wb.threads.values())
            for method, path in [("put", "/api/settings"), ("post", "/api/data/import"),
                                 ("post", "/api/llm/check"), ("get", "/api/sources")]:
                assert (await getattr(first, method)(path)).status_code == 403
            assert one.wb.settings.extractor_mode == "scripted"
            assert not one.wb.settings.slack_mirror
            private_call = LlmCall(id="private-call", ts=datetime.now(), purpose="extract", provider="test",
                                   base_url="https://example.invalid", model="test", system="Private prompt", user="Private input")
            one.trace(private_call.model_dump(mode="json"))
            await asyncio.sleep(0)
            assert (await first.get("/api/llm/calls")).json()[0]["id"] == "private-call"
            assert (await second.get("/api/llm/calls")).json() == []
            assert "Private prompt" not in (await second.get("/api/export/llm-calls.jsonl")).text
            first_events, second_events = one.wb.bus.subscribe(), two.wb.bus.subscribe()
            one.wb.emit("log", {"level": "info", "text": "Private event"})
            assert first_events.get_nowait().data["text"] == "Private event"
            assert second_events.empty()
            one.wb.bus.unsubscribe(first_events)
            two.wb.bus.unsubscribe(second_events)
    asyncio.run(check())


def test_capacity_expiry_and_status_poll_does_not_keep_alive(tmp_path, monkeypatch):
    async def check():
        async with demo(tmp_path, monkeypatch, DEMO_MAX_WORKSPACES=1, DEMO_IDLE_SECONDS=10) as (app, first, second):
            await first.get("/api/demo")
            assert (await second.get("/api/demo")).status_code == 503
            manager = app.state.demo_manager
            workspace = next(iter(manager.workspaces.values()))
            seen = workspace.last_seen
            await first.get("/api/demo")
            assert workspace.last_seen == seen
            workspace.last_seen -= 11
            old_cookie = first.cookies[COOKIE]
            assert (await first.get("/api/demo")).status_code == 200
            assert first.cookies[COOKIE] != old_cookie
            assert workspace.closed
    asyncio.run(check())


def test_live_run_is_once_reset_does_not_refill_and_requests_stay_scripted(tmp_path, monkeypatch):
    async def check():
        from context_layer.dashboard import generator
        from context_layer.dashboard.processor import Processor
        async def inline(fn, *args, **kwargs):
            return fn(*args, **kwargs)
        monkeypatch.setattr(asyncio, "to_thread", inline)
        monkeypatch.setattr(config, "llm_configured", lambda: True)
        monkeypatch.setenv("DEMO_LIVE_ENABLED", "1")
        monkeypatch.setenv("DEMO_MODEL_PRICES_EUR", '{"https://example.invalid/v1|demo-model":{"input":1,"output":2,"output_cap_includes_reasoning":true}}')
        monkeypatch.setattr(llm, "providers", lambda *args, **kwargs: [llm.Provider("primary", "https://example.invalid/v1", "fake", "demo-model", "prompt")])
        observed = []
        async def extraction(self, job, core):
            policy = current_policy()
            policy.require_active()
            observed.append(policy)
            job.extractor = "llm:test"
            thread = self.wb.threads[core.id]
            return self._extract_scripted(job, thread, core)
        monkeypatch.setattr(Processor, "_extract_llm", extraction)
        monkeypatch.setattr(generator, "generate_scenario", lambda wb: wb.scenarios["elisa-trn042-chat"].model_copy(deep=True))
        async with demo(tmp_path, monkeypatch) as (app, first, second):
            await first.get("/api/demo")
            workspace = app.state.demo_manager.workspaces[first.cookies[COOKIE]]
            assert (await first.post("/api/demo/live-run")).status_code == 202
            await workspace.live_task
            assert observed == [workspace.policy]
            assert workspace.live_error is None
            assert workspace.policy.used and not workspace.policy.active
            assert (await first.post("/api/demo/live-run")).status_code == 409
            assert (await first.post("/api/data/reset", json={})).status_code == 200
            assert (await first.get("/api/demo")).json()["live_run_used"]
            assert (await first.post("/api/demo/live-run")).status_code == 409
            assert (await second.get("/api/demo")).json()["live_run_used"] is False
    asyncio.run(check())


def test_scripted_company_request_cannot_enable_llm_or_clear_snapshot(tmp_path, monkeypatch):
    async def check():
        async with demo(tmp_path, monkeypatch) as (app, first, _):
            await first.get("/api/demo")
            workspace = app.state.demo_manager.workspaces[first.cookies[COOKIE]]
            before = set(workspace.wb.store.assertions)
            response = await first.post("/api/company/start", json={"use_llm": True, "reset": "empty", "day_minutes": 0, "speed": 3600})
            assert response.status_code == 200
            assert before == set(workspace.wb.store.assertions)
            assert workspace.wb.clock.speed == 120
            assert not workspace.state.company.prefetch.enabled
    asyncio.run(check())
