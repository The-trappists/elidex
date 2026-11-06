"""FastAPI app of the Workbench: `uv run ctx workbench` serves context_layer.workbench.app:app."""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .. import config
from .processor import install_llm_sinks
from .routes import emit_clock, router
from .simulator import Simulator
from .slack_bridge import SlackBridge
from .state import Workbench


async def _guarded(wb: Workbench, name: str, coro) -> None:
    """Run a background coroutine; an unfinished or failing part only logs a warning."""
    try:
        await coro
    except asyncio.CancelledError:
        raise
    except NotImplementedError:
        wb.emit("log", {"level": "warning", "text": f"{name} is not implemented yet"})
    except Exception as e:  # noqa: BLE001
        wb.emit("log", {"level": "warning", "text": f"{name} stopped: {type(e).__name__}: {e}"})


async def _clock_ticks(wb: Workbench) -> None:
    while True:
        await asyncio.sleep(10)
        if wb.clock.running:
            emit_clock(wb)


def create_app(state_file=None, seed: bool = True, background: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        loop = asyncio.get_running_loop()
        app.state.closing = False
        wb = Workbench(state_file=state_file, seed=seed)
        wb.bus.loop = loop
        app.state.wb = wb
        from . import persistence

        wb.llm_calls = persistence.read_llm_calls(config.WORKBENCH_LLM_CALLS_FILE)[-500:]
        remove_sinks = install_llm_sinks(wb, loop)
        wb.clock.start()
        wb.processor.start()

        app.state.simulator = Simulator(wb)
        app.state.slack = None
        tasks = [loop.create_task(_clock_ticks(wb))]
        if background:
            tasks.append(loop.create_task(_guarded(wb, "simulator", app.state.simulator.run_forever())))
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

    app = FastAPI(title="Context Workbench", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    _serve_web(app)
    return app


def _serve_web(app: FastAPI) -> None:
    """Serve the built UI with an SPA fallback, when web/dist exists."""
    dist = Path(config.WEB_DIST_DIR)
    if not dist.is_dir():
        return
    index = dist / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "not found")
        target = (dist / path).resolve()
        if path and target.is_file() and dist.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(index)


app = create_app()
