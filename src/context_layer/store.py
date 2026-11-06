"""Store: context assertions in a graph next to the network entities they are bound to.

Nodes: elements, sites, classes, events, assertions.
Edges: element -member_of-> class, element -located_at-> site, assertion -<binding role>-> entity.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import networkx as nx

from .link import Inventory
from .models import TRUST_RANK, ContextAssertion, ElementClass


@dataclass
class ContextHit:
    assertion: ContextAssertion
    matched_via: str  # "TRN-117", "class:...", "site SITE-NF-017"


def _binding_key(a: ContextAssertion) -> tuple:
    return (a.type, a.topic, frozenset((b.entity, b.role) for b in a.bound_to))


class ContextStore:
    def __init__(self, inventory: Inventory):
        self.inventory = inventory
        self.classes: dict[str, ElementClass] = {}
        self.assertions: dict[str, ContextAssertion] = {}
        self.g = nx.MultiDiGraph()
        for site in inventory.sites.values():
            self.g.add_node(site.id, kind="site")
        for el in inventory.elements.values():
            self.g.add_node(el.id, kind="element")
            if el.site_id:
                self.g.add_edge(el.id, el.site_id, key="located_at", role="located_at")

    # ------------------------------------------------------------ write

    def add_class(self, cls: ElementClass) -> None:
        if cls.id in self.classes:
            return
        self.classes[cls.id] = cls
        self.g.add_node(cls.id, kind="class")
        for el in self.inventory.elements.values():
            if cls.criteria.matches(el):
                self.g.add_edge(el.id, cls.id, key="member_of", role="member_of")

    def add_assertion(self, a: ContextAssertion) -> tuple[ContextAssertion, bool]:
        """Store a new assertion, or merge it into the same knowledge from another channel.

        Returns (stored assertion, is_new).
        """
        for old in self.assertions.values():
            if _binding_key(old) == _binding_key(a):
                old.sources += a.sources
                old.valid_from = min(old.valid_from, a.valid_from)
                old.confidence = max(old.confidence, a.confidence)
                if TRUST_RANK[a.trust.level] > TRUST_RANK[old.trust.level]:
                    old.trust = a.trust
                return old, False
        a.id = f"ctx_{len(self.assertions) + 1:04d}"
        self._index(a)
        return a, True

    def _index(self, a: ContextAssertion) -> None:
        self.assertions[a.id] = a
        self.g.add_node(a.id, kind="assertion")
        for b in a.bound_to:
            if b.entity not in self.g:
                self.g.add_node(b.entity, kind="event" if b.entity.startswith("event:") else "unknown")
            self.g.add_edge(a.id, b.entity, key=b.role, role=b.role)

    # ------------------------------------------------------------ read

    def scope_of(self, entity_id: str) -> list[tuple[str, str]]:
        """The entity itself, the classes it belongs to and its site."""
        scope = [(entity_id, entity_id)]
        if entity_id in self.g:
            for _, target, data in self.g.out_edges(entity_id, data=True):
                if data["role"] == "member_of":
                    scope.append((target, target))
                elif data["role"] == "located_at":
                    scope.append((target, f"site {target}"))
        return scope

    def resolve(self, raw: str) -> str:
        el = self.inventory.resolve_element(raw)
        if el:
            return el.id
        site = self.inventory.resolve_site(raw)
        return site.id if site else raw

    def get_context(self, entity_id: str, at: datetime | None = None, include_expired: bool = False) -> list[ContextHit]:
        """What humans know about this entity, valid at time `at` (default: now)."""
        at = at or datetime.now()
        hits: dict[str, ContextHit] = {}
        for target, via in self.scope_of(self.resolve(entity_id)):
            if target not in self.g:
                continue
            for src, _, data in self.g.in_edges(target, data=True):
                if self.g.nodes[src].get("kind") != "assertion" or data["role"] == "trigger":
                    continue
                a = self.assertions[src]
                if (include_expired or a.is_valid_at(at)) and src not in hits:
                    hits[src] = ContextHit(a, via)
        return list(hits.values())

    # ------------------------------------------------------------ persistence

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "classes": [c.model_dump(mode="json") for c in self.classes.values()],
            "assertions": [a.model_dump(mode="json") for a in self.assertions.values()],
        }
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: Path, inventory: Inventory) -> "ContextStore":
        data = json.loads(path.read_text(encoding="utf-8"))
        store = cls(inventory)
        for c in data["classes"]:
            store.add_class(ElementClass.model_validate(c))
        for a in data["assertions"]:
            store._index(ContextAssertion.model_validate(a))
        return store
