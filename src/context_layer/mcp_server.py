"""MCP interface: the tools an agent calls. Run with `ctx mcp` (stdio)."""

from datetime import datetime
from typing import Any

from mcp.server.mcpserver import MCPServer

from . import config
from .link import Inventory
from .mvp import guard
from .store import ContextStore

mcp = MCPServer("context-layer")


def _store() -> ContextStore:
    return ContextStore.load(config.STORE_FILE, Inventory.load())


@mcp.tool()
def get_context(entity_id: str, at: str | None = None) -> list[dict]:
    """Human knowledge (workarounds, site access...) valid at time `at` (ISO, default now) for a network
    element or site, including what applies to its class and its site. Each item has source, trust and validity."""
    hits = _store().get_context(entity_id, at=datetime.fromisoformat(at) if at else None)
    return [{"matched_via": h.matched_via, **h.assertion.model_dump(mode="json", exclude={"link_notes"})} for h in hits]


@mcp.tool()
def check_action(action: str, entity_id: str, at: str | None = None, observations: dict[str, Any] | None = None) -> dict:
    """Before acting on an element (reboot, replace, dispatch...), check it against human knowledge.
    Returns decision 'go' or 'adapt' with the steps to take first and the cited sources."""
    v = guard.check(_store(), action, entity_id, at=datetime.fromisoformat(at) if at else None, observations=observations)
    return {"decision": v.decision, "steps": v.steps, "reasons": v.reasons}
