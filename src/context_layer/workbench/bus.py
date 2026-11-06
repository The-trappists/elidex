"""In-process event bus. Publishers call publish() from the event loop thread
(or publish_threadsafe() from a worker thread); each SSE client gets its own queue."""

from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime
from typing import Any, Callable

from .contracts import WbEvent


class EventBus:
    def __init__(self, sim_clock: Callable[[], datetime], history: int = 500):
        self._sim_clock = sim_clock
        self._next_id = 1
        self._subscribers: set[asyncio.Queue[WbEvent]] = set()
        self.history: deque[WbEvent] = deque(maxlen=history)
        self.loop: asyncio.AbstractEventLoop | None = None  # set by the app at startup

    def publish(self, type: str, data: Any) -> WbEvent:
        """Call from the loop thread. `data` must be JSON-serialisable or a Pydantic model."""
        if hasattr(data, "model_dump"):
            data = data.model_dump(mode="json")
        event = WbEvent(id=self._next_id, ts=datetime.now(), sim_time=self._sim_clock(), type=type, data=data)
        self._next_id += 1
        self.history.append(event)
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Slow client: drop it; the browser reconnects and refetches the snapshot.
                self._subscribers.discard(q)
        return event

    def publish_threadsafe(self, type: str, data: Any) -> None:
        """Call from a worker thread (e.g. an LLM call inside asyncio.to_thread)."""
        if self.loop is None:
            self.publish(type, data)
        else:
            self.loop.call_soon_threadsafe(self.publish, type, data)

    def subscribe(self, maxsize: int = 1000) -> asyncio.Queue[WbEvent]:
        q: asyncio.Queue[WbEvent] = asyncio.Queue(maxsize=maxsize)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[WbEvent]) -> None:
        self._subscribers.discard(q)
