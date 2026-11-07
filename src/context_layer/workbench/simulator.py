"""Scenario runner and auto mode. Owner: simulator agent."""

from __future__ import annotations

import asyncio
import random
import time
from datetime import datetime, timedelta

from .contracts import Scenario, ScenarioRun
from .state import Workbench

TICK_S = 0.25
MAX_ACTIVE_RUNS = 3


class Simulator:
    def __init__(self, wb: Workbench):
        self.wb = wb
        self._last_started: dict[str, float] = {}  # scenario id -> order counter of its last start
        self._counter = 0
        self._last_auto = time.monotonic()

    # ------------------------------------------------------------ public

    async def run_forever(self) -> None:
        """Background task started by the app. Ticks ~4 times a second (see tick())."""
        while True:
            try:
                self.tick()
            except Exception as e:  # noqa: BLE001 - the loop must never die
                self._log("error", f"simulator tick failed: {type(e).__name__}: {e}")
            await asyncio.sleep(TICK_S)

    def tick(self) -> None:
        """Post every due message of every active run, then maybe start an auto scenario."""
        for run in list(self.wb.runs.values()):
            if run.done:
                continue
            try:
                self._advance(run)
            except Exception as e:  # noqa: BLE001
                self._log("error", f"run {run.id} failed: {type(e).__name__}: {e}")
                run.done = True
                self.wb.upsert_run(run)
        try:
            self._maybe_auto_start()
        except Exception as e:  # noqa: BLE001
            self._log("error", f"auto simulation failed: {type(e).__name__}: {e}")

    def start_scenario(self, scenario_id: str) -> ScenarioRun:
        """Create the thread (+ incident if any) and register the run. Raises KeyError if unknown."""
        wb = self.wb
        scenario = wb.scenarios[scenario_id]
        names = [self._author(pid)[0] for pid in self._participants(scenario)]
        thread = wb.create_thread(
            source=scenario.channel,
            subject=scenario.subject or scenario.title,
            participants=names,
            origin="generated",
            scenario_id=scenario.id,
        )
        incident_id = None
        if scenario.incident:
            incident = wb.open_incident(scenario.incident, origin="generated", scenario_id=scenario.id, thread_id=thread.id)
            incident_id = incident.id
        run = ScenarioRun(
            id="",
            scenario_id=scenario.id,
            thread_id=thread.id,
            incident_id=incident_id,
            started_at=wb.now(),
        )
        wb.upsert_run(run)
        run = self._registered(run)
        self._counter += 1
        self._last_started[scenario.id] = self._counter
        return run

    def stop_run(self, run_id: str) -> None:
        run = self.wb.runs.get(run_id)
        if run is None:
            raise KeyError(run_id)
        run.done = True
        self.wb.upsert_run(run)

    # ------------------------------------------------------------ internals

    def _log(self, level: str, text: str) -> None:
        try:
            self.wb.emit("log", {"level": level, "text": text})
        except Exception:  # noqa: BLE001
            pass

    def _registered(self, run: ScenarioRun) -> ScenarioRun:
        """The backend allocates the run id: read the stored run back."""
        if run.id and run.id in self.wb.runs:
            return self.wb.runs[run.id]
        for r in self.wb.runs.values():
            if r.thread_id == run.thread_id:
                return r
        return run

    @staticmethod
    def _participants(scenario: Scenario) -> list[str]:
        ids = list(scenario.participants)
        for m in scenario.messages:
            if m.persona not in ids:
                ids.append(m.persona)
        return ids

    def _author(self, persona_id: str) -> tuple[str, str | None, str | None]:
        """(display name, role, persona id); an unknown persona falls back to its id."""
        p = self.wb.persona(persona_id)
        return (p.name, p.role, p.id) if p else (persona_id, None, None)

    def _advance(self, run: ScenarioRun) -> None:
        wb = self.wb
        scenario = wb.scenarios.get(run.scenario_id)
        if scenario is None:  # deleted while running
            run.done = True
            wb.upsert_run(run)
            return
        changed = False
        while run.next_seq <= len(scenario.messages):
            seq = run.next_seq
            due = run.started_at + timedelta(seconds=sum(m.delay_s for m in scenario.messages[:seq]))
            if due > wb.now():
                break
            msg = scenario.messages[seq - 1]
            name, role, pid = self._author(msg.persona)
            wb.post_message(run.thread_id, author=name, text=msg.text, role=role, persona_id=pid, at=due)
            run.next_seq += 1
            changed = True
            if scenario.resolves_incident_at_seq == seq and run.incident_id:
                wb.resolve_incident(run.incident_id)
        if run.next_seq > len(scenario.messages):
            run.done = True
            changed = True
        if changed:
            wb.upsert_run(run)

    def _maybe_auto_start(self) -> None:
        wb = self.wb
        if not (wb.settings.auto_sim and wb.clock.running):
            self._last_auto = time.monotonic()
            return
        if time.monotonic() - self._last_auto < wb.settings.auto_every_s:
            return
        active = sum(1 for r in wb.runs.values() if not r.done)
        if active >= MAX_ACTIVE_RUNS or not wb.scenarios:
            return
        self._last_auto = time.monotonic()
        # least recently started first (never started = 0), pick randomly among the older half
        ordered = sorted(wb.scenarios, key=lambda sid: self._last_started.get(sid, 0))
        pool = ordered[: max(1, (len(ordered) + 1) // 2)]
        self.start_scenario(random.choice(pool))
