"""Per-workspace limits for the public demo, propagated into worker threads."""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator


class DemoLimitError(RuntimeError):
    """A public workspace is scripted or has exhausted its live allowance."""


@dataclass
class DemoPolicy:
    trace_sink: Callable[[dict[str, Any]], None] | None = None
    max_calls: int = 12
    max_output_tokens: int = 4096
    max_input_chars: int = 24000
    calls: int = field(default=0, init=False)
    used: bool = field(default=False, init=False)
    active: bool = field(default=False, init=False)
    deadline: float = field(default=0.0, init=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def start_run(self, seconds: float = 60) -> None:
        with self._lock:
            if self.used:
                raise DemoLimitError("Your live run has already been used. Scripted exploration remains available.")
            self.used = True
            self.active = True
            self.deadline = time.monotonic() + max(0.0, min(seconds, 60.0))

    def finish_run(self) -> None:
        with self._lock:
            self.active = False

    def _check(self) -> None:
        if not _live.get() or not self.active or time.monotonic() >= self.deadline or self.calls >= self.max_calls:
            raise DemoLimitError("Live API access is unavailable. Continue exploring in scripted mode.")

    def require_active(self) -> None:
        with self._lock:
            self._check()

    def reserve(self, system: str, user: str) -> float:
        """Reserve one provider attempt, including repairs and fallback attempts."""
        with self._lock:
            self._check()
            if len(system) + len(user) > self.max_input_chars:
                raise DemoLimitError("This request exceeds the live demo context limit.")
            self.calls += 1
            return max(0.001, self.deadline - time.monotonic())

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "used": self.used,
                "active": self.active and time.monotonic() < self.deadline and self.calls < self.max_calls,
                "calls": self.calls,
                "max_calls": self.max_calls,
                "remaining_calls": max(0, self.max_calls - self.calls),
            }


_policy: ContextVar[DemoPolicy | None] = ContextVar("demo_policy", default=None)
_live: ContextVar[bool] = ContextVar("demo_live_permission", default=False)


def current_policy() -> DemoPolicy | None:
    return _policy.get()


@contextmanager
def bind_policy(policy: DemoPolicy, *, allow_live: bool = False) -> Iterator[DemoPolicy]:
    token = _policy.set(policy)
    live_token = _live.set(allow_live)
    try:
        yield policy
    finally:
        _live.reset(live_token)
        _policy.reset(token)
