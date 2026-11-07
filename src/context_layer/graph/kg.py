"""KnowledgeGraph: one typed, temporal graph over the network, the context assertions and their provenance.

It is a *view* rebuilt from the ContextStore (the source of truth for assertions) and the threads
(the raw messages). Nothing here changes the store, so the pipeline, guard, agent and workbench
keep working unchanged.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

import networkx as nx

from ..link import mention_pattern
from ..listen import discover_threads
from ..models import ContextAssertion, Thread
from ..store import ContextStore
from . import schema as S

_SCOPE_EDGES = (S.APPLIES_TO, S.OBSERVED_ON)


def _kind_for(entity_id: str) -> str:
    if entity_id.startswith("event:"):
        return S.EVENT
    if entity_id.startswith("class:"):
        return S.CLASS
    return S.ELEMENT


class KnowledgeGraph:
    def __init__(self, store: ContextStore, g: nx.MultiDiGraph):
        self.store = store
        self.g = g

    # ------------------------------------------------------------ build

    @classmethod
    def build(cls, store: ContextStore, threads: Iterable[Thread] | None = None) -> "KnowledgeGraph":
        """Build from the store; threads default to every thread under data/."""
        kg = cls(store, nx.MultiDiGraph())
        kg._add_network()
        kg._add_threads(list(discover_threads() if threads is None else threads))
        for a in store.assertions.values():
            kg._add_assertion(a)
        for a in store.assertions.values():
            kg._add_lifecycle(a)
        return kg

    def _node(self, node_id: str, kind: str, **props: Any) -> None:
        if node_id in self.g:
            self.g.nodes[node_id].update({k: v for k, v in props.items() if v is not None})
        else:
            self.g.add_node(node_id, kind=kind, **props)

    def _edge(self, src: str, dst: str, etype: str, **props: Any) -> None:
        if not self.g.has_edge(src, dst, key=etype):
            self.g.add_edge(src, dst, key=etype, type=etype, **props)

    def _add_network(self) -> None:
        inv = self.store.inventory
        for s in inv.sites.values():
            self._node(s.id, S.SITE, label=s.name, name=s.name, region=s.region)
        for e in inv.elements.values():
            self._node(e.id, S.ELEMENT, label=e.id, type=e.type, model=e.model, install_year=e.install_year,
                       firmware=e.firmware, aliases=list(e.aliases))
            if e.site_id:
                self._node(e.site_id, S.SITE, label=e.site_id)
                self._edge(e.id, e.site_id, S.LOCATED_AT)
        for c in self.store.classes.values():
            crit = c.criteria
            self._node(c.id, S.CLASS, label=c.label, type=crit.type, model=crit.model,
                       install_year_min=crit.install_year_min, install_year_max=crit.install_year_max)
            for e in inv.elements.values():
                if crit.matches(e):
                    self._edge(e.id, c.id, S.MEMBER_OF)

    def _add_threads(self, threads: list[Thread]) -> None:
        inv = self.store.inventory
        # The same matcher as the linker: an id the linker accepts as named is a mention here too.
        keys = [(k, eid) for eid, e in inv.elements.items() for k in [eid, *e.aliases]] + [(sid, sid) for sid in inv.sites]
        patterns = [(p, target) for k, target in keys if (p := mention_pattern(k)) is not None]
        for t in threads:
            tnode = S.thread_id(t.id)
            self._node(tnode, S.THREAD, label=t.subject or t.id, file=t.id, source=t.source, subject=t.subject,
                       started_at=t.started_at)
            for m in t.messages:
                mnode = S.message_id(t.id, m.seq)
                pnode = S.person_id(m.author)
                self._node(mnode, S.MESSAGE, label=f"{t.source} #{m.seq}", file=t.id, source=t.source, seq=m.seq,
                           author=m.author, role=m.role, sent_at=m.sent_at, text=m.text)
                self._node(pnode, S.PERSON, label=m.author, name=m.author, role=m.role)
                self._edge(mnode, tnode, S.PART_OF)
                self._edge(pnode, mnode, S.AUTHORED)
                # An email is one message: its subject is part of what it says.
                text = f"{t.subject}\n{m.text}" if t.subject and len(t.messages) == 1 else m.text
                for pattern, target in patterns:
                    if pattern.search(text):
                        self._edge(mnode, target, S.MENTIONS)

    def _add_assertion(self, a: ContextAssertion) -> None:
        self._node(
            a.id, S.ASSERTION, label=f"{a.id} {a.topic}", type=a.type, topic=a.topic, summary=a.summary,
            diagnosis=a.diagnosis, action=a.action, avoid=list(a.avoid), fact=a.fact,
            conditions=[c.text for c in a.conditions], valid_from=a.valid_from, valid_to=a.valid_to,
            trust_level=a.trust.level, stated_by=a.trust.stated_by, evidence=a.trust.evidence,
            confidence=a.confidence, payload=a.model_dump_json(),
        )
        for b in a.bound_to:
            if b.entity not in self.g:
                self._node(b.entity, _kind_for(b.entity), label=b.entity)
            self._edge(a.id, b.entity, S.BINDING_EDGE[b.role])
        person = S.person_id(a.trust.stated_by)
        self._node(person, S.PERSON, label=a.trust.stated_by, name=a.trust.stated_by, role=a.trust.role)
        self._edge(a.id, person, S.STATED_BY, trust_level=a.trust.level)
        for ref in a.sources:
            tnode = S.thread_id(ref.file)
            if tnode not in self.g:  # thread not loaded: keep the pointer anyway
                self._node(tnode, S.THREAD, label=ref.file, file=ref.file, source=ref.source)
            msgs = [S.message_id(ref.file, seq) for seq in ref.seq]
            msgs = [m for m in msgs if m in self.g]
            for m in msgs or [tnode]:
                self._edge(a.id, m, S.DERIVED_FROM)

    def _add_lifecycle(self, a: ContextAssertion) -> None:
        if a.closed_by and a.closed_by in self.g:
            self._edge(a.id, a.closed_by, S.CLOSED_BY, at=a.valid_to)
        for other in a.conflicts_with:
            if other in self.g and a.id < other:
                self._edge(a.id, other, S.CONFLICTS_WITH)

    # ------------------------------------------------------------ helpers

    def kind(self, node_id: str) -> str | None:
        return self.g.nodes[node_id].get("kind") if node_id in self.g else None

    def _out(self, node_id: str, *etypes: str) -> list[str]:
        return [v for _, v, k in self.g.out_edges(node_id, keys=True) if k in etypes]

    def _in(self, node_id: str, *etypes: str) -> list[str]:
        return [u for u, _, k in self.g.in_edges(node_id, keys=True) if k in etypes]

    def _valid(self, aid: str, at: datetime) -> bool:
        n = self.g.nodes[aid]
        return n["valid_from"] <= at and (n["valid_to"] is None or at < n["valid_to"])

    def resolve(self, raw: str) -> str:
        return raw if raw in self.g else self.store.resolve(raw)

    def scope_of(self, entity_id: str) -> list[tuple[str, str]]:
        """(node, how it was reached): the entity, its classes, its site."""
        eid = self.resolve(entity_id)
        if eid not in self.g:
            return []
        scope = [(eid, eid)]
        scope += [(c, c) for c in self._out(eid, S.MEMBER_OF)]
        scope += [(s, f"site {s}") for s in self._out(eid, S.LOCATED_AT)]
        return scope

    def assertions_in_scope(self, entity_id: str) -> list[tuple[str, str]]:
        """(assertion id, matched via) for every assertion bound to the entity, its classes or its site.

        Same rule as ContextStore.get_context: OBSERVED_ON is evidence, not scope. It counts for the entity
        itself, never for the other members of its class or the other elements of its site.
        """
        entity = self.resolve(entity_id)
        seen: dict[str, str] = {}
        for target, via in self.scope_of(entity_id):
            edges = _SCOPE_EDGES if target == entity else (S.APPLIES_TO,)
            for aid in self._in(target, *edges):
                seen.setdefault(aid, via)
        return list(seen.items())

    # ------------------------------------------------------------ queries (graph tools for agents)

    def stats(self) -> dict:
        nodes: dict[str, int] = {}
        edges: dict[str, int] = {}
        for _, d in self.g.nodes(data=True):
            nodes[d["kind"]] = nodes.get(d["kind"], 0) + 1
        for _, _, k in self.g.edges(keys=True):
            edges[k] = edges.get(k, 0) + 1
        return {"nodes": dict(sorted(nodes.items())), "edges": dict(sorted(edges.items()))}

    def provenance(self, assertion_id: str) -> list[dict]:
        """The messages an assertion was extracted from: who said it, where, when, verbatim."""
        if self.kind(assertion_id) != S.ASSERTION:
            return []
        out = []
        for node in self._out(assertion_id, S.DERIVED_FROM):
            d = self.g.nodes[node]
            if d["kind"] == S.MESSAGE:
                out.append({"message": node, "file": d["file"], "source": d["source"], "seq": d["seq"],
                            "author": d["author"], "role": d.get("role"), "sent_at": d["sent_at"], "text": d["text"]})
            else:
                out.append({"message": None, "file": d.get("file"), "source": d.get("source"), "seq": None,
                            "author": None, "role": None, "sent_at": None, "text": None})
        return sorted(out, key=lambda r: (r["sent_at"] or datetime.min, r["seq"] or 0))

    def experts(self, entity_id: str | None = None, at: datetime | None = None) -> list[dict]:
        """People who stated knowledge about an entity (with its classes and site), most verified first.

        Answers "who do we ask about TRN-117?" when no assertion covers the case yet.
        """
        if entity_id is None:
            aids = [n for n, d in self.g.nodes(data=True) if d["kind"] == S.ASSERTION]
        else:
            aids = [aid for aid, _ in self.assertions_in_scope(entity_id)]
        if at is not None:
            aids = [aid for aid in aids if self._valid(aid, at)]
        people: dict[str, dict] = {}
        for aid in aids:
            for p in self._out(aid, S.STATED_BY):
                row = people.setdefault(p, {"person": self.g.nodes[p]["name"], "role": self.g.nodes[p].get("role"),
                                            "assertions": [], "verified": 0})
                row["assertions"].append(aid)
                row["verified"] += self.g.nodes[aid]["trust_level"] == "verified"
        return sorted(people.values(), key=lambda r: (-r["verified"], -len(r["assertions"]), r["person"]))

    def timeline(self, entity_id: str, at: datetime | None = None) -> list[dict]:
        """Every assertion that ever covered the entity, oldest first, with its status at `at`."""
        at = at or datetime.now()
        rows = []
        for aid, via in self.assertions_in_scope(entity_id):
            d = self.g.nodes[aid]
            if d["valid_from"] > at:
                status = "future"
            elif d["valid_to"] is not None and d["valid_to"] <= at:
                status = "closed"
            else:
                status = "valid"
            rows.append({
                "id": aid, "type": d["type"], "topic": d["topic"], "summary": d["summary"], "matched_via": via,
                "valid_from": d["valid_from"], "valid_to": d["valid_to"], "status": status,
                "closed_by": next(iter(self._out(aid, S.CLOSED_BY)), None),
                "conflicts_with": self._out(aid, S.CONFLICTS_WITH) + self._in(aid, S.CONFLICTS_WITH),
                "stated_by": d["stated_by"], "trust": d["trust_level"],
            })
        return sorted(rows, key=lambda r: r["valid_from"])

    def reach(self, assertion_id: str) -> dict:
        """Which elements an assertion reaches: the overlinking check ("a wrong link is worse than none")."""
        if self.kind(assertion_id) != S.ASSERTION:
            return {"assertion": assertion_id, "elements": {}, "sites": []}
        elements: dict[str, str] = {}
        sites: list[str] = []
        for target in self._out(assertion_id, S.APPLIES_TO):
            kind = self.kind(target)
            if kind == S.ELEMENT:
                elements.setdefault(target, "direct")
            elif kind == S.CLASS:
                for e in self._in(target, S.MEMBER_OF):
                    elements.setdefault(e, target)
            elif kind == S.SITE:
                sites.append(target)
                for e in self._in(target, S.LOCATED_AT):
                    elements.setdefault(e, f"site {target}")
        return {"assertion": assertion_id, "elements": dict(sorted(elements.items())), "sites": sorted(sites)}

    def mentions(self, entity_id: str) -> list[dict]:
        """Raw messages that name the entity, extracted or not (episodic memory)."""
        eid = self.resolve(entity_id)
        if eid not in self.g:
            return []
        rows = []
        for m in self._in(eid, S.MENTIONS):
            d = self.g.nodes[m]
            rows.append({"message": m, "file": d["file"], "seq": d["seq"], "author": d["author"],
                         "sent_at": d["sent_at"], "text": d["text"],
                         "extracted_into": self._in(m, S.DERIVED_FROM)})
        return sorted(rows, key=lambda r: (r["sent_at"], r["seq"]))

    def neighborhood(self, node_id: str, depth: int = 1) -> nx.MultiDiGraph:
        """The subgraph within `depth` hops of a node, ignoring edge direction."""
        nid = self.resolve(node_id)
        if nid not in self.g:
            return nx.MultiDiGraph()
        nodes = nx.single_source_shortest_path_length(self.g.to_undirected(as_view=True), nid, cutoff=depth)
        return self.g.subgraph(nodes).copy()

    def snapshot(self, at: datetime) -> nx.MultiDiGraph:
        """The graph as believed at time `at`: assertions not valid then are dropped."""
        drop = [n for n, d in self.g.nodes(data=True) if d["kind"] == S.ASSERTION and not self._valid(n, at)]
        g = self.g.copy()
        g.remove_nodes_from(drop)
        return g
