"""Push the knowledge graph to Neo4j (optional: `pip install neo4j`, or `uv sync --extra neo4j`).

The in-memory graph stays the default; Neo4j is a mirror for exploration (Neo4j Browser / Bloom)
and for agents that prefer Cypher. Every push is a full, idempotent MERGE of the current view.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import networkx as nx


def _value(v: Any) -> Any:
    if isinstance(v, (list, tuple)):
        return [_value(x) for x in v]
    return v  # the driver maps naive datetime to LocalDateTime


def _props(d: dict) -> dict:
    """Node properties; `kind` becomes the label."""
    return {k: _value(v) for k, v in d.items() if v is not None and v != [] and k != "kind"}


def push(g: nx.MultiDiGraph, uri: str, user: str, password: str, database: str | None = None,
         wipe: bool = False) -> dict:
    """MERGE every node and edge into Neo4j. `wipe` first deletes nodes with our labels."""
    from neo4j import GraphDatabase  # optional dependency

    kinds = sorted({d["kind"] for _, d in g.nodes(data=True)})
    by_kind: dict[str, list[dict]] = {k: [] for k in kinds}
    for n, d in g.nodes(data=True):
        by_kind[d["kind"]].append({"id": n, "props": _props(d)})
    by_rel: dict[tuple[str, str, str], list[dict]] = {}
    for u, v, k, d in g.edges(keys=True, data=True):
        key = (g.nodes[u]["kind"], k, g.nodes[v]["kind"])
        props = {x: _value(y) for x, y in d.items() if x != "type" and y is not None}
        by_rel.setdefault(key, []).append({"src": u, "dst": v, "props": props})

    with GraphDatabase.driver(uri, auth=(user, password)) as driver:
        with driver.session(database=database) as s:
            if wipe:
                s.run("MATCH (n) WHERE any(l IN labels(n) WHERE l IN $kinds) DETACH DELETE n", kinds=kinds)
            for kind in kinds:
                s.run(f"CREATE CONSTRAINT {kind.lower()}_id IF NOT EXISTS FOR (n:{kind}) REQUIRE n.id IS UNIQUE")
            for kind, rows in by_kind.items():
                s.run(f"UNWIND $rows AS row MERGE (n:{kind} {{id: row.id}}) SET n += row.props", rows=rows)
            for (src_kind, rel, dst_kind), rows in by_rel.items():
                s.run(
                    f"UNWIND $rows AS row MATCH (a:{src_kind} {{id: row.src}}), (b:{dst_kind} {{id: row.dst}}) "
                    f"MERGE (a)-[r:{rel}]->(b) SET r += row.props",
                    rows=rows,
                )
    return {"nodes": g.number_of_nodes(), "edges": g.number_of_edges(), "pushed_at": datetime.now().isoformat()}
