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
from .models import ContextAssertion, ElementClass


@dataclass
class ContextHit:
    assertion: ContextAssertion
    matched_via: str  # "TRN-117", "class:...", "site SITE-NF-017"


def _binding_key(a: ContextAssertion) -> tuple:
    return (a.type, a.topic, frozenset((b.entity, b.role) for b in a.bound_to))


def _norm(text: str | None) -> str:
    return " ".join((text or "").lower().split())


def same_knowledge(old: ContextAssertion, new: ContextAssertion) -> bool:
    """Same binding, and either the same author or the same advice.

    Two people who give different advice on the same topic and scope are not merged: both stay, and the
    lifecycle step flags the conflict. The same author (or the same action) seen on another channel is one fact.
    With no action on either side (facts), the advice is the fact itself: two different facts from two people
    are not the same knowledge.
    """
    if _binding_key(old) != _binding_key(new):
        return False
    if old.action or new.action:
        same_advice = _norm(old.action) == _norm(new.action)
    else:
        same_advice = _norm(old.fact) == _norm(new.fact)
    return old.trust.stated_by == new.trust.stated_by or same_advice


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
            if same_knowledge(old, a):
                old.sources += a.sources
                old.valid_from = min(old.valid_from, a.valid_from)
                old.confidence = max(old.confidence, a.confidence)
                old.trust.add_confirmation(a.trust)
                return old, False
        a.id = f"ctx_{len(self.assertions) + 1:04d}"
        self._index(a)
        return a, True

    def merge_into(self, target_id: str, dup: ContextAssertion) -> ContextAssertion:
        """Fold `dup` (an assertion in the store or not) into the older `target_id` and drop `dup`.

        Keeps the target's id and graph edges. Sources are added once, trust and confidence only go up, extra
        bindings get their edges, and references to `dup` (conflicts, closed_by) now point at the target.
        """
        target = self.assertions[target_id]
        known = {(s.source, s.file, tuple(s.seq)) for s in target.sources}
        for src in dup.sources:
            if (src.source, src.file, tuple(src.seq)) not in known:
                target.sources.append(src)
        target.valid_from = min(target.valid_from, dup.valid_from)
        target.confidence = max(target.confidence, dup.confidence)
        target.trust.add_confirmation(dup.trust)
        have = {(b.entity, b.role) for b in target.bound_to}
        for b in dup.bound_to:
            if (b.entity, b.role) not in have:
                target.bound_to.append(b)
                if b.entity not in self.g:
                    self.g.add_node(b.entity, kind="event" if b.entity.startswith("event:") else "unknown")
                self.g.add_edge(target.id, b.entity, key=b.role, role=b.role)
        for other in self.assertions.values():
            if dup.id in other.conflicts_with:
                other.conflicts_with = [c for c in other.conflicts_with if c != dup.id]
                if other.id != target.id and other.id not in target.conflicts_with:
                    other.conflicts_with.append(target.id)
                    target.conflicts_with.append(other.id)
            if other.closed_by == dup.id:
                other.closed_by = target.id
        if dup.id and dup.id in self.assertions:
            self.remove_assertion(dup.id)
        return target

    def remove_assertion(self, assertion_id: str) -> None:
        """Drop an assertion and its graph node (its edges go with the node)."""
        self.assertions.pop(assertion_id, None)
        if assertion_id in self.g:
            self.g.remove_node(assertion_id)

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

    def reach(self, a: ContextAssertion) -> set[str]:
        """The elements and sites an assertion is served for, by scope: elements it applies to, the members of its
        classes, sites it applies to and their elements, and the elements it was seen on (get_context serves those
        to the element itself). A site where it was only seen is not reached. Compare reaches, not binding ids:
        two class ids can cover the same elements."""
        out: set[str] = set()
        for b in a.bound_to:
            if b.role == "trigger" or b.entity not in self.g:
                continue
            kind = self.g.nodes[b.entity].get("kind")
            if kind == "element":
                out.add(b.entity)
            elif b.role != "applies_to":
                continue
            elif kind == "class":
                out |= {u for u, _, k in self.g.in_edges(b.entity, keys=True) if k == "member_of"}
            elif kind == "site":
                out.add(b.entity)
                out |= {u for u, _, k in self.g.in_edges(b.entity, keys=True) if k == "located_at"}
        return out

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
        entity = self.resolve(entity_id)
        for target, via in self.scope_of(entity):
            if target not in self.g:
                continue
            for src, _, data in self.g.in_edges(target, data=True):
                if self.g.nodes[src].get("kind") != "assertion" or data["role"] == "trigger":
                    continue
                # "observed_on" is evidence, not scope: it counts for the entity itself, never for the other
                # members of its class or the other elements of its site.
                if data["role"] == "observed_on" and target != entity:
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
