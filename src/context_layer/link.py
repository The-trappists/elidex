"""Link: turn what the text mentions into bindings to graph entities, with validity.

Precision first: unknown IDs, too-broad classes and low confidence are abstained, with a note.
"""

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import config
from .models import (
    Binding,
    ContextAssertion,
    ElementClass,
    ExtractedItem,
    NetworkElement,
    Site,
    SourceRef,
    Thread,
    Trust,
)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


class Inventory:
    """Simple network records (synthetic): elements and sites."""

    def __init__(self, elements: list[NetworkElement], sites: list[Site]):
        self.elements = {e.id: e for e in elements}
        self.sites = {s.id: s for s in sites}
        self._alias = {_norm(e.id): e.id for e in elements}
        self._alias |= {_norm(a): e.id for e in elements for a in e.aliases}
        self._site_alias = {_norm(s.id): s.id for s in sites}
        self._site_name = {_norm(s.name): s.id for s in sites}

    @classmethod
    def load(cls, folder: Path = config.INVENTORY_DIR) -> "Inventory":
        with open(folder / "network_elements.csv", encoding="utf-8") as f:
            elements = [
                NetworkElement(
                    id=r["id"],
                    type=r["type"],
                    model=r["model"],
                    install_year=int(r["install_year"]),
                    firmware=r["firmware"] or None,
                    site_id=r["site_id"] or None,
                    aliases=[a for a in r["aliases"].split("|") if a],
                )
                for r in csv.DictReader(f)
            ]
        with open(folder / "sites.csv", encoding="utf-8") as f:
            sites = [Site(**r) for r in csv.DictReader(f)]
        return cls(elements, sites)

    def resolve_element(self, raw: str) -> NetworkElement | None:
        eid = self._alias.get(_norm(raw))
        return self.elements.get(eid) if eid else None

    def resolve_site(self, raw: str) -> Site | None:
        """Exact id first. Then, only when exactly one site fits (precision first): an id without its
        prefix ("NF-017" for SITE-NF-017), the exact site name, or a name fragment of 6+ characters
        ("Sodankylä", "Turku harbour hut"). Ambiguous fragments such as "Turku" are not bound."""
        key = _norm(raw)
        if not key:
            return None
        sid = self._site_alias.get(key)
        if sid:
            return self.sites[sid]
        sid = self._site_name.get(key)
        if sid:
            return self.sites[sid]
        fits = {s for k, s in self._site_alias.items() if k.endswith(key) and len(key) >= 4}
        if not fits and len(key) >= 6:
            fits = {s for k, s in self._site_name.items() if key in k}
        return self.sites[fits.pop()] if len(fits) == 1 else None


@dataclass
class LinkResult:
    assertion: ContextAssertion | None
    classes: list[ElementClass] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class Linker:
    def __init__(self, inventory: Inventory, min_confidence: float = config.MIN_CONFIDENCE):
        self.inventory = inventory
        self.min_confidence = min_confidence

    def link(self, item: ExtractedItem, thread: Thread) -> LinkResult:
        notes: list[str] = []
        if item.confidence < self.min_confidence:
            return LinkResult(None, notes=[f"abstained '{item.topic}': confidence {item.confidence} < {self.min_confidence}"])

        bindings: list[Binding] = []
        classes: list[ElementClass] = []

        # Class as scope: lets the knowledge reach *another* node of the same kind.
        crit = item.scope.element_class
        if crit:
            members = [e for e in self.inventory.elements.values() if crit.matches(e)]
            if not crit.is_specific():
                notes.append(f"class '{crit.label()}' too broad: not bound")
            elif not members:
                notes.append(f"class '{crit.label()}' matches no element: not bound")
            else:
                cls = ElementClass(id=crit.class_id(), label=crit.label(), criteria=crit)
                classes.append(cls)
                bindings.append(Binding(entity=cls.id, role="applies_to"))

        # Instance as evidence when a class carries the scope, as scope otherwise.
        instance_role = "observed_on" if classes else "applies_to"
        for raw in item.scope.instance_ids:
            el = self.inventory.resolve_element(raw)
            if el:
                bindings.append(Binding(entity=el.id, role=instance_role))
            else:
                notes.append(f"unknown element '{raw}': not bound")
        for raw in item.scope.site_ids:
            site = self.inventory.resolve_site(raw)
            if site:
                bindings.append(Binding(entity=site.id, role="applies_to"))
            else:
                notes.append(f"unknown site '{raw}': not bound")
        if item.scope.trigger:
            bindings.append(Binding(entity=f"event:{item.scope.trigger}", role="trigger"))

        if not any(b.role == "applies_to" for b in bindings):
            return LinkResult(None, notes=notes + [f"abstained '{item.topic}': nothing to bind it to"])

        cited = [m for m in thread.messages if m.seq in item.cited_seq] or thread.messages
        stated_role = next((m.role for m in thread.messages if m.author == item.stated_by and m.role), None)
        assertion = ContextAssertion(
            type=item.type,
            topic=item.topic,
            summary=item.summary,
            bound_to=bindings,
            conditions=item.conditions,
            diagnosis=item.diagnosis,
            action=item.action,
            avoid=item.avoid,
            fact=item.fact,
            valid_from=min(m.sent_at for m in cited),
            trust=Trust(level=item.trust_level, stated_by=item.stated_by, role=stated_role, evidence=item.evidence),
            sources=[SourceRef(source=thread.source, file=thread.id, seq=sorted(item.cited_seq))],
            confidence=item.confidence,
            link_notes=notes,
        )
        return LinkResult(assertion, classes, notes)
