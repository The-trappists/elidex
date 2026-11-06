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


def _graph():
    from .graph import KnowledgeGraph

    return KnowledgeGraph.build(_store())


def _json(rows):
    import json

    return json.loads(json.dumps(rows, default=str))


@mcp.tool()
def get_provenance(assertion_id: str) -> list[dict]:
    """The original messages (Teams, email) an assertion was extracted from: author, role, time and verbatim text.
    Use it to cite the human source or to judge how much to trust a piece of knowledge."""
    return _json(_graph().provenance(assertion_id))


@mcp.tool()
def find_experts(entity_id: str | None = None, at: str | None = None) -> list[dict]:
    """People who stated knowledge about an element or site (including its class and site), most verified first.
    Use it when no assertion covers the case and a human must be asked."""
    return _json(_graph().experts(entity_id, at=datetime.fromisoformat(at) if at else None))


@mcp.tool()
def get_timeline(entity_id: str, at: str | None = None) -> list[dict]:
    """Every piece of human knowledge that ever covered an entity, oldest first, with status at `at`
    (valid, closed, future), what closed it and conflicts. Explains why advice changed over time."""
    return _json(_graph().timeline(entity_id, at=datetime.fromisoformat(at) if at else None))


@mcp.tool()
def get_rule_reach(assertion_id: str) -> dict:
    """Which network elements an assertion applies to (directly, through its class or its site)."""
    return _graph().reach(assertion_id)


@mcp.tool()
def check_action(action: str, entity_id: str, at: str | None = None, observations: dict[str, Any] | None = None) -> dict:
    """Before acting on an element (reboot, replace, dispatch...), check it against human knowledge.
    Returns decision 'go' or 'adapt' with the steps to take first and the cited sources."""
    v = guard.check(_store(), action, entity_id, at=datetime.fromisoformat(at) if at else None, observations=observations)
    return {"decision": v.decision, "steps": v.steps, "reasons": v.reasons}
