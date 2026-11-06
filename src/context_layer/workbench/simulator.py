"""Scenario runner and auto mode. PHASE 0 STUB. Owner: simulator agent."""

from __future__ import annotations

from .contracts import ScenarioRun
from .state import Workbench


class Simulator:
    def __init__(self, wb: Workbench):
        self.wb = wb

    async def run_forever(self) -> None:
        """Background task started by the app. Ticks ~4 times a second:
        posts the due messages of every active run (delay_s is in sim seconds, so it follows the
        clock speed and stops when the clock is paused), opens/resolves incidents, and starts a
        random scenario every settings.auto_every_s wall seconds when settings.auto_sim is on."""
        raise NotImplementedError

    def start_scenario(self, scenario_id: str) -> ScenarioRun:
        """Create the thread (+ incident if any) and register the run. Raises KeyError if unknown."""
        raise NotImplementedError

    def stop_run(self, run_id: str) -> None:
        raise NotImplementedError
