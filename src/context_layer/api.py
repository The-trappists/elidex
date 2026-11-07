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


@app.get("/freshness/{entity_id}")
def freshness(entity_id: str) -> dict:
    """When humans last talked about this element, from Tiger Data (`daily_mentions`): is the knowledge going stale?"""
    if not config.tiger_configured():
        raise HTTPException(503, "Tiger Data is not configured (TIGER_DATABASE_URL).")
    from .dataset import tiger

    with tiger.connect() as conn:
        last, total, days = tiger.freshness(conn, entity_id)
    age = (datetime.now(last.tzinfo) - last).days if last else None
    return {"entity": entity_id, "last_discussed": last, "messages": total or 0, "active_days": days, "days_since": age}


@app.get("/similar")
def similar(q: str, collection: str = "assertions", limit: int = 5) -> list[dict]:
    """Knowledge nearest to a sentence, by vector search in Atlas (run `ctx dataset embed` first)."""
    if not config.mongo_configured():
        raise HTTPException(503, "MongoDB Atlas is not configured (MONGODB_URI).")
    if collection not in ("assertions", "facts"):
        raise HTTPException(422, "collection must be 'assertions' or 'facts'")
    from . import mongo_store
    from .dataset import mongo

    try:
        return mongo_store.similar(mongo.connect(), collection, q, limit)
    except SystemExit as e:  # nothing embedded yet, or another embedding mode
        raise HTTPException(409, str(e)) from e


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
