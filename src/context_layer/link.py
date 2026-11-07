"""Link: turn what the text mentions into bindings to graph entities, with validity.

Precision first: unknown IDs, too-broad classes and low confidence are abstained, with a note. What the extractor
claims is checked against the thread and the inventory before it is bound (docs/backend-review.md, finding 1):
- an element or site id must be named in the thread;
- a class needs a known element type or a model (the type is filled from the model), and it must contain the
  units the thread is about;
- the author must be someone who wrote in the thread.
"""

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import config
from .models import (
    Binding,
    ClassCriteria,
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


def mention_pattern(key: str) -> re.Pattern | None:
    """`TRN-042` also matches `TRN 042` and `trn042`; never inside a longer token. Letters include non-ASCII ones
    ("Kemijärvi"). None for a key with no letter or digit."""
    parts = [re.escape(p) for p in re.split(r"[\W_]+", key) if p]
    if not parts:
        return None
    return re.compile(r"(?<![^\W_])" + r"[-\s]?".join(parts) + r"(?![^\W_])", re.IGNORECASE)


def _snake(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.strip().lower()).strip("_")


def thread_text(thread: Thread) -> str:
    return "\n".join([thread.subject or "", *(m.text for m in thread.messages)])


class Inventory:
    """Simple network records (synthetic): elements and sites."""

    def __init__(self, elements: list[NetworkElement], sites: list[Site]):
        self.elements = {e.id: e for e in elements}
        self.sites = {s.id: s for s in sites}
        self._alias = {_norm(e.id): e.id for e in elements}
        self._alias |= {_norm(a): e.id for e in elements for a in e.aliases}
        self._site_alias = {_norm(s.id): s.id for s in sites}
        self._site_name = {_norm(s.name): s.id for s in sites}
        # Words of 6+ characters found in one site name only ("Sodankylä", not "exchange"): naming one names the site.
        owners: dict[str, set[str]] = {}
        for s in sites:
            for w in s.name.split():
                if len(_norm(w)) >= 6:
                    owners.setdefault(_norm(w), set()).add(s.id)
        self._site_words: dict[str, set[str]] = {}
        for w, ids in owners.items():
            if len(ids) == 1:
                self._site_words.setdefault(next(iter(ids)), set()).add(w)
        self.types = {e.type for e in elements}
        self._model_types: dict[str, set[str]] = {}
        for e in elements:
            self._model_types.setdefault(e.model.lower(), set()).add(e.type)

    def site_keys(self, site: Site) -> tuple[list[str], set[str]]:
        """How a text can name a site: (id-like keys, normalised name words). The id, the id without its prefix
        ("NF-017" for SITE-NF-017, 4+ characters, as resolve_site accepts it), the whole name, and name words of
        6+ characters that belong to this site only."""
        parts = [p for p in re.split(r"[^A-Za-z0-9]+", site.id) if p]
        ids = [site.id] + ["-".join(parts[i:]) for i in range(1, len(parts)) if len("".join(parts[i:])) >= 4]
        return ids, {_norm(site.name), *self._site_words.get(site.id, set())}

    def type_of_model(self, model: str) -> str | None:
        """The element type of a model, when the inventory gives exactly one."""
        types = self._model_types.get(model.strip().lower(), set())
        return next(iter(types)) if len(types) == 1 else None

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

    # ------------------------------------------------------------ checks on what the extractor claims

    def _author(self, item: ExtractedItem, thread: Thread) -> tuple[str | None, str | None]:
        """(author as written in the thread, note). The extractor's stated_by must be someone who wrote in the
        thread: exact name, then case-insensitive, then a unique first name. Otherwise the author of the message
        holding the evidence quote, then the single author of the cited messages. None: nobody fits."""
        authors = list(dict.fromkeys(m.author for m in thread.messages))
        said = item.stated_by.strip()
        if said in authors:
            return said, None
        if fit := [a for a in authors if a.lower() == said.lower()]:
            return fit[0], None
        first = said.lower().split()[:1]
        fit = [a for a in authors if first and a.lower().split()[:1] == first]
        if len(fit) == 1:
            return fit[0], None
        why = f"stated_by '{said}' did not write in the thread"
        if item.evidence_quote and (quote := " ".join(item.evidence_quote.lower().split())):
            fit = list(dict.fromkeys(m.author for m in thread.messages if quote in " ".join(m.text.lower().split())))
            if len(fit) == 1:
                return fit[0], f"{why}: attributed to {fit[0]}, who wrote the quoted message"
        fit = list(dict.fromkeys(m.author for m in thread.messages if m.seq in item.cited_seq))
        if len(fit) == 1:
            return fit[0], f"{why}: attributed to {fit[0]}, who wrote the cited message(s)"
        return None, why

    def _criteria(self, crit: ClassCriteria, notes: list[str]) -> ClassCriteria | None:
        """The class as the inventory knows it, or None (with a note). The type is snake_case and must exist; a
        class needs a type or a model (a year range alone reaches every kind of element); a model alone gets its
        type from the inventory, so the same class always has the same id."""
        etype = crit.type
        if etype:
            etype = _snake(etype)
            if etype not in self.inventory.types and etype.endswith("s") and etype[:-1] in self.inventory.types:
                etype = etype[:-1]  # "transmission_nodes"
            if etype not in self.inventory.types:
                notes.append(f"class type '{crit.type}' is not an element type in the inventory: class not bound")
                return None
        elif crit.model:
            etype = self.inventory.type_of_model(crit.model)
        if not etype and not crit.model:
            notes.append(f"class '{crit.label()}' has no element type or model: not bound")
            return None
        return crit.model_copy(update={"type": etype})

    @staticmethod
    def _named(text: str, flat: str, keys: list[str]) -> bool:
        """A key is named when its mention pattern matches the text. `flat` is _norm(text): a key whose normalised
        form is not in it cannot match, which skips most regex scans."""
        for k in keys:
            if k and _norm(k) in flat and (p := mention_pattern(k)) is not None and p.search(text):
                return True
        return False

    # ------------------------------------------------------------ link

    def link(self, item: ExtractedItem, thread: Thread) -> LinkResult:
        notes: list[str] = []
        if item.confidence < self.min_confidence:
            return LinkResult(None, notes=[f"abstained '{item.topic}': confidence {item.confidence} < {self.min_confidence}"])

        stated_by, why = self._author(item, thread)
        if stated_by is None:
            return LinkResult(None, notes=[f"abstained '{item.topic}': {why}, and no single author fits"])
        if why:
            notes.append(why)

        # An id the thread never names is not bound: the extractor may return any valid id from its context.
        text = thread_text(thread)
        flat = _norm(text)
        instances: list[NetworkElement] = []
        for raw in item.scope.instance_ids:
            el = self.inventory.resolve_element(raw)
            if not el:
                notes.append(f"unknown element '{raw}': not bound")
            elif not self._named(text, flat, [raw, el.id, *el.aliases]):
                notes.append(f"element {el.id} is not named in the thread: not bound")
            elif el not in instances:
                instances.append(el)

        bindings: list[Binding] = []
        classes: list[ElementClass] = []
        confidence = item.confidence

        # Class as scope: lets the knowledge reach *another* node of the same kind.
        crit = item.scope.element_class and self._criteria(item.scope.element_class, notes)
        if crit:
            members = [e for e in self.inventory.elements.values() if crit.matches(e)]
            outside = [el.id for el in instances if not crit.matches(el)]
            if not crit.is_specific():
                notes.append(f"class '{crit.label()}' too broad: not bound")
            elif not members:
                notes.append(f"class '{crit.label()}' matches no element: not bound")
            elif outside:
                # The class leaves out the unit the advice was given for: the class is wrong, the unit is not.
                notes.append(f"class '{crit.label()}' does not contain {', '.join(outside)}, the unit(s) the thread is about: not bound")
            else:
                cls = ElementClass(id=crit.class_id(), label=crit.label(), criteria=crit)
                classes.append(cls)
                bindings.append(Binding(entity=cls.id, role="applies_to"))
                if item.scope.qualifier:
                    notes.append(f"class wider than stated ('{item.scope.qualifier}')")
                    confidence = round(confidence * 0.8, 4)

        # Instance as evidence when a class carries the scope, as scope otherwise.
        instance_role = "observed_on" if classes else "applies_to"
        bindings += [Binding(entity=el.id, role=instance_role) for el in instances]
        # A site is the scope only when nothing narrower carries it (site access, a local quirk). When a class
        # or an element already scopes the advice, the site is just where it was seen: binding it as scope would
        # reach every other element there (e.g. a TX-5000 next to the TX-3000 the thread is about).
        scoped = any(b.role == "applies_to" for b in bindings)
        for raw in item.scope.site_ids:
            site = self.inventory.resolve_site(raw)
            ids, words = self.inventory.site_keys(site) if site else ([], set())
            if not site:
                notes.append(f"unknown site '{raw}': not bound")
            elif not (self._named(text, flat, [raw, *ids]) or any(w and w in flat for w in words)):
                notes.append(f"site {site.id} is not named in the thread: not bound")
            elif scoped:
                bindings.append(Binding(entity=site.id, role="observed_on"))
                notes.append(f"site {site.id} kept as where it was seen, not as scope")
            else:
                bindings.append(Binding(entity=site.id, role="applies_to"))
        if item.scope.trigger:
            bindings.append(Binding(entity=f"event:{item.scope.trigger}", role="trigger"))

        if not any(b.role == "applies_to" for b in bindings):
            return LinkResult(None, notes=notes + [f"abstained '{item.topic}': nothing to bind it to"])

        cited = [m for m in thread.messages if m.seq in item.cited_seq] or thread.messages
        stated_role = next((m.role for m in thread.messages if m.author == stated_by and m.role), None)
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
            trust=Trust(level=item.trust_level, stated_by=stated_by, role=stated_role, evidence=item.evidence),
            sources=[SourceRef(source=thread.source, file=thread.id, seq=sorted(item.cited_seq))],
            confidence=confidence,
            link_notes=notes,
        )
        return LinkResult(assertion, classes, notes)
