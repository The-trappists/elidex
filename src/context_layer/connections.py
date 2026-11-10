"""Per-workspace, memory-only connections to external tools (AI providers and Slack).

Credentials live in this process only: they are never written to disk, state snapshots,
exports, logs or LLM traces. A registry is bound to a workspace through a ContextVar, so
asyncio tasks and `asyncio.to_thread` workers inherit the same mutable registry. Public
demo workspaces get their own registry; the team dashboard has one shared registry for the
lifetime of the process.

The AI provider list is a fixed allowlist of HTTPS OpenAI-compatible endpoints. The browser
can choose a provider and a model, never an endpoint or a database URI.
"""

from __future__ import annotations

import asyncio
import os
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterator

from .demo_policy import DemoLimitError


# Fixed, approved HTTPS endpoints. No path comes from the request.
PROVIDERS: dict[str, str] = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "mistral": "https://api.mistral.ai/v1",
    "groq": "https://api.groq.com/openai/v1",
    "openai": "https://api.openai.com/v1",
    "featherless": "https://api.featherless.ai/v1",
}

MAX_INPUT_CHARS = 24_000
PERSONAL_WINDOW_S = 600.0


@dataclass(frozen=True)
class AiConnection:
    """A visitor's provider key. `repr` never shows the key."""

    provider: str
    model: str
    base_url: str
    api_key: str = field(repr=False)

    def __repr__(self) -> str:  # noqa: D105 - explicit, safe representation
        return f"AiConnection(provider={self.provider!r}, model={self.model!r})"


class ConnectionRegistry:
    """The connections of one workspace. Mutations are serialized; stale connects never win."""

    def __init__(self, *, public_demo: bool = False, server_slack: Any = None):
        self.public_demo = public_demo
        self.server_slack = server_slack
        self.ai: AiConnection | None = None
        self.slack_bridge: Any = None
        self._lock = asyncio.Lock()
        self._ai_generation = 0
        self._ai_installed = 0
        self._slack_generation = 0
        self._slack_installed = 0
        self._personal_was_connected = False
        self._personal_calls = 0
        self._personal_window = time.monotonic()
        self._personal_lock = threading.Lock()
        self.max_personal_calls = max(1, int(os.getenv("DEMO_PERSONAL_MAX_CALLS", "30")))

    # ------------------------------------------------------------ context

    @property
    def has_ai(self) -> bool:
        return self.ai is not None

    @property
    def allow_server_ai(self) -> bool:
        """A public workspace that ever used a personal key never falls back to deployment keys."""
        return not (self.public_demo and self._personal_was_connected)

    # ------------------------------------------------------------ AI mutations

    def begin_ai_mutation(self) -> int:
        self._ai_generation += 1
        return self._ai_generation

    async def install_ai(self, token: int, connection: AiConnection) -> bool:
        async with self._lock:
            if token < self._ai_installed:
                return False
            self._ai_installed = token
            self.ai = connection
            self._personal_was_connected = True
            return True

    async def clear_ai(self, token: int) -> bool:
        async with self._lock:
            if token < self._ai_installed:
                return False
            self._ai_installed = token
            self.ai = None
            return True

    # ------------------------------------------------------------ Slack mutations

    def begin_slack_mutation(self) -> int:
        self._slack_generation += 1
        return self._slack_generation

    async def install_slack(self, token: int, bridge: Any) -> tuple[Any, bool]:
        async with self._lock:
            if token < self._slack_installed:
                return None, False
            self._slack_installed = token
            old = self.slack_bridge
            self.slack_bridge = bridge
            return old, True

    async def clear_slack(self, token: int) -> tuple[Any, bool]:
        async with self._lock:
            if token < self._slack_installed:
                return None, False
            self._slack_installed = token
            old = self.slack_bridge
            self.slack_bridge = None
            return old, True

    async def close(self) -> None:
        """Workspace expiry or app shutdown: stop listeners and drop credentials."""
        self._ai_generation += 1
        self._slack_generation += 1
        async with self._lock:
            self._ai_installed = self._ai_generation
            self._slack_installed = self._slack_generation
            self.ai = None
            bridge = self.slack_bridge
            self.slack_bridge = None
        if bridge is not None:
            await bridge.stop()

    # ------------------------------------------------------------ personal call bounds

    def reserve_personal_call(self, system: str, user: str) -> None:
        """Bound a public workspace's calls to its own key (never the shared budget)."""
        if len(system) + len(user) > MAX_INPUT_CHARS:
            raise DemoLimitError("This request is too large for the personal AI demo limit.")
        now = time.monotonic()
        with self._personal_lock:
            if now - self._personal_window >= PERSONAL_WINDOW_S:
                self._personal_window, self._personal_calls = now, 0
            if self._personal_calls >= self.max_personal_calls:
                raise DemoLimitError(
                    "Your personal AI call limit for this demo session is reached. "
                    "Wait for the ten-minute window to reset."
                )
            self._personal_calls += 1

    # ------------------------------------------------------------ snapshot

    def snapshot(self) -> dict[str, Any]:
        from . import config

        if self.ai is not None:
            ai = {"connected": True, "provider": self.ai.provider, "model": self.ai.model, "source": "session"}
        elif not self.public_demo and config.llm_configured():
            ai = {"connected": True, "provider": _server_provider_name(), "model": config.LLM_MODEL or None, "source": "server"}
        else:
            ai = {"connected": False, "provider": None, "model": None, "source": "none"}

        bridge = self.slack_bridge if self.slack_bridge is not None else (None if self.public_demo else self.server_slack)
        if bridge is not None:
            try:
                slack = bridge.status()
            except Exception:  # noqa: BLE001 - a bridge that is still starting
                slack = {"connected": False, "channel": None, "error": "Slack status is unavailable."}
        else:
            slack = {"connected": False, "channel": None, "error": None}

        infrastructure = (
            {"mongodb_configured": False, "tiger_configured": False}
            if self.public_demo
            else {"mongodb_configured": config.mongo_configured(), "tiger_configured": config.tiger_configured()}
        )
        return {"ai": ai, "slack": slack, "infrastructure": infrastructure, "public_demo": self.public_demo}


def _server_provider_name() -> str:
    from . import config

    base = (config.LLM_BASE_URL or "").lower()
    if config.is_google_vertex_primary() or "generativelanguage.googleapis.com" in base or "aiplatform" in base:
        return "gemini"
    for name in ("mistral", "groq", "openai", "featherless"):
        if name in base:
            return name
    return "server"


# ---------------------------------------------------------------- context binding


_connections: ContextVar[ConnectionRegistry | None] = ContextVar("connections", default=None)


def current_connection() -> ConnectionRegistry | None:
    return _connections.get()


@contextmanager
def bind_connections(registry: ConnectionRegistry) -> Iterator[ConnectionRegistry]:
    token = _connections.set(registry)
    try:
        yield registry
    finally:
        _connections.reset(token)


# ---------------------------------------------------------------- connection test


def test_ai_connection(provider: str, model: str, api_key: str) -> None:
    """One real, small request to the fixed endpoint. Raises on any failure."""
    from . import llm  # shared seam: tests replace llm.OpenAI

    spec = PROVIDERS[provider]
    client = llm.OpenAI(base_url=spec, api_key=api_key, timeout=20, max_retries=0)
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Reply with the single word: ok"}],
            max_tokens=8,
            temperature=0,
        )
        if not getattr(response, "choices", None):
            raise RuntimeError("The provider returned no answer.")
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()


def describe_provider_error(exc: Exception, secrets: tuple[str, ...] = ()) -> str:
    """A helpful message that never includes an upstream body or the key."""
    name = type(exc).__name__
    if name in {"AuthenticationError", "PermissionDeniedError"}:
        message = "The provider rejected this API key."
    elif name in {"NotFoundError"}:
        message = "The provider does not offer this model."
    elif name in {"RateLimitError"}:
        message = "The provider rate-limited the connection test. Try again shortly."
    elif name in {"APITimeoutError", "APIConnectionError"}:
        message = "Could not reach the provider. Check your network and try again."
    elif name in {"BadRequestError", "UnprocessableEntityError"}:
        message = "The provider rejected the request. Check the model name."
    else:
        message = f"The provider rejected the connection test ({name})."
    for secret in secrets:
        if secret:
            message = message.replace(secret, "[redacted]")
    return message


def sanitize(text: str | None, secrets: tuple[str, ...] = (), limit: int = 300) -> str:
    message = (text or "The connection failed.").strip()
    for secret in secrets:
        if secret:
            message = message.replace(secret, "[redacted]")
    return message[:limit]
