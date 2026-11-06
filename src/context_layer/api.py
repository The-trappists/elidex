"""REST interface over the context store. Run with `ctx serve`, docs at /docs."""

from datetime import datetime
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import config
from .link import Inventory
from .mvp import guard
from .store import ContextStore

app = FastAPI(title="Context layer", description="What humans know about network entities, for agents.")


@lru_cache
def get_store() -> ContextStore:
    if not config.STORE_FILE.exists():
        raise HTTPException(503, "No store yet: run `ctx run` first.")
    return ContextStore.load(config.STORE_FILE, Inventory.load())


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "store": config.STORE_FILE.exists()}


@app.get("/assertions")
def assertions() -> list[dict]:
    return [a.model_dump(mode="json") for a in get_store().assertions.values()]


@app.get("/context/{entity_id}")
def context(entity_id: str, at: datetime | None = None, include_expired: bool = False) -> list[dict]:
    hits = get_store().get_context(entity_id, at=at, include_expired=include_expired)
    return [{"matched_via": h.matched_via, **h.assertion.model_dump(mode="json")} for h in hits]


def _graph():
    from .graph import KnowledgeGraph

    return KnowledgeGraph.build(get_store())


@app.get("/graph")
def graph(at: datetime | None = None, node: str | None = None, depth: int = 1) -> list[dict]:
    """Cytoscape.js elements: the whole graph, as believed at `at`, or the neighbourhood of `node`."""
    from .graph import to_cytoscape

    kg = _graph()
    g = kg.neighborhood(node, depth) if node else kg.g
    if at:
        believed = kg.snapshot(at)
        g = g.subgraph(n for n in g if n in believed).copy()
    return to_cytoscape(g)


@app.get("/graph/stats")
def graph_stats() -> dict:
    return _graph().stats()


@app.get("/graph/provenance/{assertion_id}")
def graph_provenance(assertion_id: str) -> list[dict]:
    return _graph().provenance(assertion_id)


@app.get("/graph/reach/{assertion_id}")
def graph_reach(assertion_id: str) -> dict:
    return _graph().reach(assertion_id)


@app.get("/graph/experts")
def graph_experts(entity_id: str | None = None, at: datetime | None = None) -> list[dict]:
    return _graph().experts(entity_id, at=at)


@app.get("/graph/timeline/{entity_id}")
def graph_timeline(entity_id: str, at: datetime | None = None) -> list[dict]:
    return _graph().timeline(entity_id, at=at)


@app.get("/graph/mentions/{entity_id}")
def graph_mentions(entity_id: str) -> list[dict]:
    return _graph().mentions(entity_id)


class GuardRequest(BaseModel):
    action: str
    entity_id: str
    at: datetime | None = None
    observations: dict[str, Any] | None = Field(None, description="enables condition checks (MVP C)")


@app.post("/guard")
def check_action(req: GuardRequest) -> dict:
    v = guard.check(get_store(), req.action, req.entity_id, at=req.at, observations=req.observations)
    return {"decision": v.decision, "action": v.action, "steps": v.steps, "reasons": v.reasons}
