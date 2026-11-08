"""Cookie-scoped, bounded public demo. The team's dashboard is never started here."""
from __future__ import annotations

import asyncio
import copy
import json
import os
import secrets
import shutil
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.requests import Request

from .. import config
from ..demo_policy import BudgetLedger, DemoLimitError, DemoPolicy, PriceCatalog, bind_policy
from . import persistence
from .archive import Archive
from .company import CompanyDay
from .contracts import LlmCall
from .llm_compact import LlmCompactor
from .simulator import Simulator
from .state import Dashboard

COOKIE = "context_demo"


class PublicDashboard(Dashboard):
    def refresh_readonly_settings(self):
        super().refresh_readonly_settings()
        self.settings.extractor_mode = "scripted"
        self.settings.slack_connected = False
        self.settings.slack_mirror = False
        self.settings.use_critic = False
        self.settings.use_judge = False
        self.settings.use_outcome_loop = False
        self.settings.auto_sim = False


class Workspace:
    def __init__(self, manager, ident):
        self.manager, self.id = manager, ident
        self.last_seen = time.monotonic()
        self.directory = manager.root / ident
        self.policy = DemoPolicy(trace_sink=self.trace, ledger=manager.budget, prices=manager.prices,
                                 workspace_id=ident, budget_required=True)
        with bind_policy(self.policy):
            self.wb = PublicDashboard(state_file=self.directory / "state.json", seed=False)
        self.wb.llm_calls_file = self.directory / "llm_calls.jsonl"
        self.wb.llm_cache_file = self.directory / "extractions.json"
        self.live_task = None
        self.live_error = None
        self.closed = False
        self.tasks = []
        self.window_start = self.last_seen
        self.requests_in_window = 0

    async def start(self):
        loop = asyncio.get_running_loop()
        self.wb.bus.loop = loop
        with bind_policy(self.policy):
            self.wb.replace_state(copy.deepcopy(self.manager.snapshot))
            self.wb.refresh_readonly_settings()
            self.wb.clock.start()
            self.wb.processor.start()
            simulator = Simulator(self.wb)
            company = CompanyDay(self.wb, simulator, archive=Archive(self.directory / "archive", atlas=False, tiger=False))
            self.state = SimpleNamespace(wb=self.wb, simulator=simulator, company=company, slack=None,
                                         llm_compactor=LlmCompactor(self.wb), closing=False)
            if self.manager.background:
                from .app import _clock_ticks
                self.tasks = [asyncio.create_task(simulator.run_forever()), asyncio.create_task(company.run_forever()),
                              asyncio.create_task(_clock_ticks(self.wb))]

    def trace(self, trace):
        call = LlmCall.model_validate(trace)
        # A bounded memory-only log avoids file writes from late worker threads after expiry.
        def record():
            if not self.closed:
                self.wb.llm_calls.append(call)
                del self.wb.llm_calls[:-100]
                self.wb.emit("llm.call", call)
        self.wb.bus.loop.call_soon_threadsafe(record)

    def status(self):
        budget = self.manager.budget_status(self.id)
        reason = self.manager.live_unavailable_reason(self.id)
        return {"enabled": True, "live_run_used": self.policy.used,
                "live_run_running": bool(self.live_task and not self.live_task.done()),
                "live_run_available": not self.policy.used and reason is None,
                "live_unavailable_reason": reason,
                "live_run_error": self.live_error, "mode": "live" if self.policy.snapshot()["active"] else "scripted",
                "session_expires_in_seconds": max(0, int(self.manager.idle - (time.monotonic() - self.last_seen))),
                "max_live_calls": self.policy.max_calls, "live_calls": self.policy.calls, **budget}

    async def close(self):
        self.closed = True
        self.state.closing = True
        self.policy.finish_run()
        tasks = self.tasks + ([self.live_task] if self.live_task else [])
        for task in tasks:
            task.cancel()
        self.wb.processor.stop()
        if self.wb._save_handle:
            self.wb._save_handle.cancel()
            self.wb._save_handle = None
        await asyncio.gather(*tasks, return_exceptions=True)
        shutil.rmtree(self.directory, ignore_errors=True)

    async def run_live(self):
        from . import generator
        try:
            async with asyncio.timeout(60):
                with bind_policy(self.policy, allow_live=True):
                    scenario = await asyncio.to_thread(generator.generate_scenario, self.wb)
                    self.wb.upsert_scenario(scenario)
                    # Deliver a complete generated conversation, then extract and link it once.
                    # Normal timers stay denied, even while this task owns live API permission.
                    with bind_policy(self.policy):
                        run = self.state.simulator.start_scenario(scenario.id)
                        for message in scenario.messages:
                            name, role, pid = self.state.simulator._author(message.persona)
                            self.wb.post_message(run.thread_id, author=name, text=message.text, role=role, persona_id=pid)
                        run.next_seq = len(scenario.messages) + 1
                        run.done = True
                        self.wb.upsert_run(run)
                        self.wb.processor.forget(run.thread_id)
                    await self.wb.processor.process(run.thread_id)
                    job = self.wb.jobs.get(self.wb.threads[run.thread_id].last_job_id)
                    if job and job.error:
                        self.live_error = self.policy.budget_error or "The live extraction could not finish. Scripted exploration is still available."
        except asyncio.CancelledError:
            raise
        except DemoLimitError as exc:
            self.live_error = str(exc)
        except Exception:
            self.live_error = "The live scenario could not finish. Scripted exploration is still available."
        finally:
            self.policy.finish_run()
            self.manager.running_live -= 1
            self.wb.emit("log", {"level": "info", "text": "Live scenario finished. Scripted exploration remains available."})


class WorkspaceManager:
    def __init__(self, root, background=True):
        self.root = Path(root)
        self.background = background
        self.maximum = max(1, int(os.getenv("DEMO_MAX_WORKSPACES", "40")))
        self.idle = max(10, int(os.getenv("DEMO_IDLE_SECONDS", "1800")))
        self.max_live = max(1, int(os.getenv("DEMO_MAX_LIVE_RUNS", "2")))
        self.total_limit = max(self.maximum, int(os.getenv("DEMO_MAX_TOTAL_WORKSPACES", "500")))
        self.total_created = 0
        self.running_live = 0
        self.workspaces = {}
        self.lock = asyncio.Lock()
        self.snapshot = None
        self.live_enabled = os.getenv("DEMO_LIVE_ENABLED", "0").lower() in {"1", "true", "yes"}
        self.prices = PriceCatalog(os.getenv("DEMO_MODEL_PRICES_EUR", ""))
        self.budget = None
        self.budget_error = None
        try:
            self.budget = BudgetLedger(Path(os.getenv("DEMO_BUDGET_FILE", str(self.root / "budget.sqlite3"))),
                                       workspace_limit=os.getenv("DEMO_WORKSPACE_BUDGET_EUR", "0.50"),
                                       global_limit=os.getenv("DEMO_GLOBAL_BUDGET_EUR", "100"))
        except (OSError, ValueError, sqlite3.Error):
            self.budget_error = "Live AI budgeting is unavailable. Scripted exploration remains available."

    def budget_status(self, workspace_id):
        if self.budget is None:
            return {"budget_limit_eur": 0.5, "budget_spent_eur": 0, "budget_reserved_eur": 0,
                    "budget_remaining_eur": 0, "global_budget_remaining_eur": 0, "global_budget_limit_eur": 100,
                    "budget_available": False}
        try:
            return self.budget.snapshot(workspace_id)
        except (sqlite3.Error, OSError):
            self.budget_error = "Live AI budgeting is unavailable. Scripted exploration remains available."
            return {"budget_limit_eur": 0.5, "budget_spent_eur": 0, "budget_reserved_eur": 0,
                    "budget_remaining_eur": 0, "global_budget_remaining_eur": 0, "global_budget_limit_eur": 100,
                    "budget_available": False}

    def live_unavailable_reason(self, workspace_id):
        if not self.live_enabled:
            return "Live AI is paused by the team. Scripted exploration remains available."
        if self.budget_error:
            return self.budget_error
        if self.prices.error:
            return self.prices.error
        if not self.budget_status(workspace_id)["budget_available"]:
            return "The live AI budget is exhausted. Scripted exploration remains available."
        if not config.llm_configured():
            return "Live generation is currently unavailable. Explore the scripted scenarios."
        from .. import llm
        try:
            chain = llm.providers()
            if not chain:
                return "Live generation is currently unavailable. Explore the scripted scenarios."
            for provider in chain:
                self.prices.get(provider.base_url, provider.model)
        except DemoLimitError as exc:
            return str(exc)
        except Exception:
            return "Live model configuration is unavailable. Scripted exploration remains available."
        return None

    async def prepare(self):
        from . import loop_agents
        loop_agents.install_all()
        snapshot = os.getenv("DEMO_SNAPSHOT_FILE", "")
        if snapshot and Path(snapshot).is_file():
            self.snapshot = persistence.load_state(Path(snapshot))
            return
        # Build the small curated seed once without any live provider access.
        policy = DemoPolicy()
        with bind_policy(policy):
            wb = PublicDashboard(state_file=self.root / "seed-template.json", seed=True)
            wb.bus.loop = asyncio.get_running_loop()
            wb.processor.start()
            await asyncio.gather(*list(wb.processor._tasks))
            self.snapshot = persistence.state_to_dict(wb)
            wb.processor.stop()
            if wb._save_handle:
                wb._save_handle.cancel()
                wb._save_handle = None

    async def get(self, ident):
        async with self.lock:
            expired = [key for key, ws in self.workspaces.items() if time.monotonic() - ws.last_seen >= self.idle]
            for key in expired:
                await self.workspaces.pop(key).close()
            workspace = self.workspaces.get(ident)
            if workspace and time.monotonic() - workspace.last_seen < self.idle:
                return workspace, False
            if workspace:
                await workspace.close()
                del self.workspaces[ident]
            if len(self.workspaces) >= self.maximum or self.total_created >= self.total_limit:
                return None, False
            ident = secrets.token_urlsafe(32)
            workspace = Workspace(self, ident)
            await workspace.start()
            self.workspaces[ident] = workspace
            self.total_created += 1
            return workspace, True

    async def sweep(self):
        while True:
            await asyncio.sleep(min(30, self.idle))
            async with self.lock:
                expired = [key for key, ws in self.workspaces.items() if time.monotonic() - ws.last_seen >= self.idle]
                for key in expired:
                    await self.workspaces.pop(key).close()


class DemoMiddleware:
    def __init__(self, app, manager):
        self.app, self.manager = app, manager

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/") or scope["path"] == "/api/health":
            return await self.app(scope, receive, send)
        req = Request(scope, receive)
        workspace, fresh = await self.manager.get(req.cookies.get(COOKIE))
        if workspace is None:
            return await JSONResponse({"detail": "The demo is busy. Please try again shortly."}, status_code=503,
                                      headers={"Retry-After": "30"})(scope, receive, send)
        path, method = scope["path"], scope["method"]
        now = time.monotonic()
        if now - workspace.window_start >= 60:
            workspace.window_start, workspace.requests_in_window = now, 0
        workspace.requests_in_window += 1
        if workspace.requests_in_window > 180:
            return await JSONResponse({"detail": "Please slow down and try again shortly."}, status_code=429,
                                      headers={"Retry-After": "10"})(scope, receive, send)
        if path != "/api/demo":
            workspace.last_seen = time.monotonic()
        scope["app"] = SimpleNamespace(state=workspace.state)
        scope.setdefault("state", {})["demo_workspace"] = workspace

        async def respond(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"cache-control", b"no-store"))
                if fresh or path != "/api/demo":
                    cookie = f"{COOKIE}={workspace.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age={self.manager.idle}"
                    if scope.get("scheme") == "https":
                        cookie += "; Secure"
                    headers.append((b"set-cookie", cookie.encode()))
                message["headers"] = headers
            await send(message)

        # Public routes intentionally exclude data imports, remote data sources, settings and provider checks.
        blocked = path.startswith("/api/sources") or path.startswith("/api/llm/check")
        allowed_post = path in {"/api/demo/live-run", "/api/agent/run", "/api/guard", "/api/sim/start", "/api/sim/pause",
                               "/api/sim/speed", "/api/company/start", "/api/company/stop", "/api/company/pause", "/api/company/resume",
                               "/api/data/reset"} or (path.startswith("/api/sim/scenarios/") and path.endswith("/run"))
        if blocked or (method not in {"GET", "HEAD"} and not (method == "POST" and allowed_post)):
            return await JSONResponse({"detail": "This control is unavailable in the public demo."}, status_code=403)(scope, receive, respond)
        if method == "POST" and path != "/api/demo/live-run":
            if path.endswith("/run") and path.startswith("/api/sim/scenarios/"):
                if sum(not run.done for run in workspace.wb.runs.values()) >= 3 or len(workspace.wb.threads) >= 500:
                    return await JSONResponse({"detail": "Finish the current scenarios or reset your workspace first."}, status_code=429)(scope, receive, respond)
            raw = b""
            async for chunk in req.stream():
                raw += chunk
                if len(raw) > 16000:
                    return await JSONResponse({"detail": "Request too large."}, status_code=413)(scope, receive, respond)
            try:
                body = json.loads(raw) if raw else {}
                if not isinstance(body, dict):
                    raise ValueError()
                if path == "/api/company/start":
                    body.update(use_llm=False, reset="keep", clear_archive=False,
                                speed=min(120, max(1, float(body.get("speed", 120)))),
                                day_minutes=min(480, max(1, int(body.get("day_minutes", 480)))), cycle_minutes=10)
                if path == "/api/agent/run":
                    body["use_llm"] = False
                if path == "/api/sim/speed":
                    body["speed"] = min(120, max(1, float(body.get("speed", 120))))
                if path == "/api/data/reset":
                    if workspace.live_task and not workspace.live_task.done():
                        return await JSONResponse({"detail": "Wait for the live run to finish before resetting."}, status_code=409)(scope, receive, respond)
                    with bind_policy(workspace.policy):
                        workspace.state.company.stop()
                        workspace.wb.replace_state(copy.deepcopy(self.manager.snapshot))
                        workspace.wb.refresh_readonly_settings()
                    return await JSONResponse(workspace.status())(scope, receive, respond)
            except (ValueError, TypeError):
                return await JSONResponse({"detail": "Invalid demo request."}, status_code=422)(scope, receive, respond)
            payload = json.dumps(body).encode()
            delivered = False
            original_receive = receive
            async def rewritten_receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": payload, "more_body": False}
                return await original_receive()
            receive = rewritten_receive
        with bind_policy(workspace.policy):
            await self.app(scope, receive, respond)


def create_demo_app(root=None, background=True):
    from .app import _serve_web
    from .routes import router
    from .routes_export import router as export_router
    from .routes_knowledge import router as knowledge_router
    manager = WorkspaceManager(root or os.getenv("DEMO_STATE_DIR", str(config.OUT_DIR / "public-demo")), background)

    @asynccontextmanager
    async def lifespan(app):
        await manager.prepare()
        app.state.demo_manager = manager
        sweeper = asyncio.create_task(manager.sweep())
        try:
            yield
        finally:
            sweeper.cancel()
            await asyncio.gather(sweeper, return_exceptions=True)
            for workspace in list(manager.workspaces.values()):
                await workspace.close()

    app = FastAPI(title="Context public demo", lifespan=lifespan)
    app.state.demo_manager = manager
    app.add_middleware(DemoMiddleware, manager=manager)

    @app.get("/api/demo")
    async def status(request: Request):
        return request.state.demo_workspace.status()

    @app.post("/api/demo/live-run", status_code=202)
    async def live_run(request: Request):
        workspace = request.state.demo_workspace
        if workspace.policy.used:
            return JSONResponse({"detail": "Your live run has already been used."}, status_code=409)
        reason = manager.live_unavailable_reason(workspace.id)
        if reason is not None:
            return JSONResponse({"detail": reason}, status_code=503)
        if manager.running_live >= manager.max_live:
            return JSONResponse({"detail": "All live slots are busy. Please try again shortly."}, status_code=429,
                                headers={"Retry-After": "10"})
        workspace.policy.start_run()
        manager.running_live += 1
        workspace.live_task = asyncio.create_task(workspace.run_live())
        return workspace.status()

    app.include_router(router)
    app.include_router(export_router)
    app.include_router(knowledge_router)
    _serve_web(app)
    return app
