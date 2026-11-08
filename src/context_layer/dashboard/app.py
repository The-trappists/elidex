"""FastAPI app of the Dashboard: `uv run ctx dashboard` serves context_layer.dashboard.app:app."""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .. import config
from . import loop_agents
from .processor import install_llm_sinks
from .routes import emit_clock, router
from .routes_export import router as export_router
from .llm_compact import LlmCompactor
from .sources import router as sources_router
from .routes_knowledge import router as knowledge_router
from .archive import Archive
from .company import CompanyDay
from .simulator import Simulator
from .slack_bridge import SlackBridge
from .state import Dashboard


async def _guarded(wb: Dashboard, name: str, coro) -> None:
    """Run a background coroutine; an unfinished or failing part only logs a warning."""
    try:
        await coro
    except asyncio.CancelledError:
        raise
    except NotImplementedError:
        wb.emit("log", {"level": "warning", "text": f"{name} is not implemented yet"})
    except Exception as e:  # noqa: BLE001
        wb.emit("log", {"level": "warning", "text": f"{name} stopped: {type(e).__name__}: {e}"})


async def _clock_ticks(wb: Dashboard) -> None:
    while True:
        await asyncio.sleep(10)
        if wb.clock.running:
            emit_clock(wb)


def create_app(state_file=None, seed: bool = True, background: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        loop = asyncio.get_running_loop()
        app.state.closing = False
        wb = Dashboard(state_file=state_file, seed=seed)
        wb.bus.loop = loop
        app.state.wb = wb
        from . import persistence

        wb.llm_calls = persistence.read_llm_calls(config.DASHBOARD_LLM_CALLS_FILE)[-500:]
        remove_sinks = install_llm_sinks(wb, loop)
        wb.clock.start()
        wb.processor.start()
        loop_agents.install_all()

        app.state.simulator = Simulator(wb)
        cloud = state_file is None  # tests pass a state file: they never reach Atlas or Tiger
        archive = Archive((Path(state_file).parent if state_file else config.DASHBOARD_DIR) / "archive", atlas=cloud, tiger=cloud)
        app.state.company = CompanyDay(wb, app.state.simulator, archive=archive)
        app.state.slack = None
        app.state.llm_compactor = LlmCompactor(wb)
        tasks = [loop.create_task(_clock_ticks(wb))]
        if background:
            tasks.append(loop.create_task(_guarded(wb, "simulator", app.state.simulator.run_forever())))
            tasks.append(loop.create_task(_guarded(wb, "company day", app.state.company.run_forever())))
            tasks.append(loop.create_task(_guarded(wb, "llm log compaction", app.state.llm_compactor.run_forever())))
        if config.slack_configured():
            slack = SlackBridge(wb, config.SLACK_BOT_TOKEN, config.SLACK_APP_TOKEN, config.SLACK_CHANNEL_ID)
            app.state.slack, wb.slack = slack, slack
            tasks.append(loop.create_task(_guarded(wb, "slack bridge", slack.start())))
        try:
            yield
        finally:
            app.state.closing = True
            for t in tasks:
                t.cancel()
            if app.state.slack is not None:
                with contextlib.suppress(Exception):
                    await app.state.slack.stop()
            wb.processor.stop()
            remove_sinks()
            wb.save_now()

    app = FastAPI(title="Context Dashboard", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(export_router)
    app.include_router(sources_router)
    app.include_router(knowledge_router)
    _serve_web(app)
    return app


def _static_response(dist: Path, path: str) -> FileResponse:
    """A file under `dist`, or its index.html (SPA fallback). Never leaves `dist`."""
    target = (dist / path).resolve()
    if path and target.is_file() and dist.resolve() in target.parents:
        return FileResponse(target)
    return FileResponse(dist / "index.html")


def _serve_web(app: FastAPI) -> None:
    """Serve the built UI with an SPA fallback, when web/dist exists."""
    dist = Path(config.WEB_DIST_DIR)
    if not dist.is_dir():
        return

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "not found")
        return _static_response(dist, path)


app = create_app()
