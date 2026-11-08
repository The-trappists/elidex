"""Simulated clock. Sim time moves `speed` times faster than wall time, and only while running."""

from __future__ import annotations

import time
from datetime import datetime, timedelta

from .contracts import ClockState


class SimClock:
    def __init__(self, start: datetime, speed: float = 1.0, running: bool = False):
        self._base_sim = start
        self._base_wall = time.monotonic()
        self.speed = speed
        self.running = running

    def now(self) -> datetime:
        if not self.running:
            return self._base_sim
        elapsed = time.monotonic() - self._base_wall
        return self._base_sim + timedelta(seconds=elapsed * self.speed)

    def _rebase(self) -> None:
        self._base_sim = self.now()
        self._base_wall = time.monotonic()

    def start(self) -> None:
        self._rebase()
        self.running = True

    def pause(self) -> None:
        self._rebase()
        self.running = False

    def set_speed(self, speed: float) -> None:
        if speed <= 0:
            raise ValueError("speed must be > 0")
        self._rebase()
        self.speed = speed

    def set(self, at: datetime) -> None:
        self._base_sim = at
        self._base_wall = time.monotonic()

    def advance(self, seconds: float) -> None:
        """Jump forward in sim time (used when the clock is paused)."""
        self._rebase()
        self._base_sim += timedelta(seconds=seconds)

    def wall_seconds_for(self, sim_seconds: float) -> float:
        return sim_seconds / self.speed

    def state(self) -> ClockState:
        return ClockState(sim_now=self.now(), speed=self.speed, running=self.running)
