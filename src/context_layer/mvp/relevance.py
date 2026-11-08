"""Problem relevance: does a retrieved rule talk about the problem the agent has, or about another problem of the
same element?

Graph scope and time give everything humans said about an element that is valid now. On a real network one element
is covered by hundreds of rules (docs/evaluation.md, part 3: a TX-3000 node has a median of 316 valid facts in the
company dataset), so the agent also needs to know which of them are about *its* problem. This module answers that
with a fact, like the check status of `conditions.py`, not with a drop:

- "matches the problem": the rule covers at least `threshold` of the weight of the problem's words;
- "other problem": it does not (knowledge about the same element, but another symptom);
- "not assessed": the problem description has no word the knowledge base uses.

Score = sum of IDF of the problem's concepts that the rule mentions / sum of IDF of the problem's concepts that the
knowledge base knows at all. Words are reduced to concepts by a small field thesaurus (SFP = transceiver = optic,
reboot = restart, ...), so a reworded incident still matches. Deterministic, explainable (the matched concepts are
listed), about 0.1 ms per rule. A dense embedding model can replace `concepts()` later; the interface stays.
"""

from __future__ import annotations

import math
import re
import weakref
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal

from ..models import ContextAssertion

RelevanceStatus = Literal["matches the problem", "other problem", "not assessed"]
DEFAULT_THRESHOLD = 0.4  # chosen on the dev wording by `ctx dataset eval` (docs/evaluation.md, part 3)

# Field vocabulary of transmission, radio and power operations: each line is one concept, its first word is the name.
_THESAURUS = """
sfp sfps transceiver transceivers optic optics module modules xfp qsfp gbic
port ports interface interfaces
link links uplink uplinks
swap swaps swapped swapping replace replaced replacing replacement change changed changing fitted
down dead
up
flap flaps flapping flapped
reboot reboots rebooted rebooting restart restarts restarted restarting reload reloaded
power powered mains grid electricity
cycle cycled cycling
outage outages cut cuts blackout
cold colder frost frosty freezing minus subzero
snow snowfall snowy ice icing iced sleet
storm storms wind winds windy gale gales gust gusts
lightning thunder thunderstorm thunderstorms
speed speeds 1g 10g gbit gbps negotiation negotiated negotiate autoneg
alarm alarms warning warnings alert alerts
fan fans cooling airflow
filter filters dust dusty intake
clock clocks sync synchronisation synchronization synchronised synchronized ptp timing
licence licences license licenses licensed unlicensed licensing
upgrade upgrades upgraded update updates updated release releases firmware software
config configuration configurations
commit commits committing
hang hangs hanging stuck frozen unresponsive
traffic packet packets
drop drops dropping dropped loss
throughput capacity bandwidth
antenna antennas dish dishes sector sectors
tilt tilted alignment align aligned misaligned
vswr reflected
heater heaters heating heat
battery batteries
slow sluggish slowly
memory ram leak leaks
login logins log logged password
lock locked lockout locks
admin administrator
counter counters statistics stats graph graphs
fade fades fading
microwave mw
second 2nd
cabinet cabinets
key keys padlock barrier gate gates
access enter entry dispatch dispatched visit visiting truck
caretaker landlord
road roads
"""
_CONCEPT = {w: line.split()[0] for line in _THESAURUS.strip().splitlines() for w in line.split()}

_STOP = set(
    """a an the and or but if then than so of on in at to for from by with without into onto over under after before
    since until during while when whenever is are was were be been being it its this that these those there here we
    our us you your they them their he she his her i me my do does did done has have had having can could will would
    shall should may might must not no yes any some all each every very just only also still again now today tonight
    tomorrow yesterday morning evening night around about as how what which who whom why where get got gets getting
    keeps keep kept shows show shown seems seem looks look goes go going went came come comes our us one two three
    several few many more most other another same such own nearby seconds minutes minute hours hour days weeks
    months site sites back unit units node nodes element elements model models""".split()
)
# Scope phrases ("installed up to 2018") are the graph's job, not the problem's: removed before matching.
_SCOPE = re.compile(r"\binstalled\s+(?:up\s+to\s+|from\s+|in\s+|between\s+)?\d{4}(?:\s*(?:-|and|to)\s*\d{4})?|\bup\s+to\s+\d{4}\b")
# Longest forms first: an alias ("hel101-trn2") and a site id ("site-nf-017") before a plain id ("trn-042").
_ID = re.compile(r"\b[a-z]{3}\d{3,4}-[a-z]{3}\d+\b|\bsite-[a-z]+-\d+\b|\b[a-z]{2,4}-?\d{2,5}\b")
_NEG_TEMP = re.compile(r"-\s?\d{1,2}\s?(?:°\s?)?(?:c\b|degrees?)")
_TOKEN = re.compile(r"[a-z0-9]+")


def _stem(w: str) -> str:
    """Light plural / tense stripping for words the thesaurus does not list."""
    for suffix in ("ing", "ed", "es", "s"):
        if len(w) > len(suffix) + 3 and w.endswith(suffix):
            return w[: -len(suffix)]
    return w


def terms(text: str | None, keep_ids: bool = False) -> list[str]:
    """The concept of every word, in order, with repeats. Element and site ids are removed, or kept as one token
    each ("trn10234") with `keep_ids` (for a text search over raw chats, where the id is the strongest clue)."""
    if not text:
        return []
    text = text.lower()
    out = ["cold"] if _NEG_TEMP.search(text) else []  # "-25 C": a temperature below zero
    if keep_ids:
        out += [m.replace("-", "") for m in _ID.findall(text)]
    text = _ID.sub(" ", _SCOPE.sub(" ", text)).replace("up and down", "flap")  # a link that goes up and down flaps
    for w in _TOKEN.findall(text):
        if w in _STOP or w.isdigit():
            continue
        c = _CONCEPT.get(w) or _CONCEPT.get(_stem(w)) or _stem(w)
        if len(c) > 1:
            out.append(c)
    return out


def concepts(text: str | None) -> set[str]:
    """The concepts a text talks about: element and site ids removed, synonyms merged, stopwords dropped."""
    return set(terms(text))


def rule_text(a: ContextAssertion) -> str:
    """What a rule says about *when* it applies and what the problem is. Site access knowledge also says "access":
    that is what a dispatch asks for, whatever words the gate or key instructions use."""
    trigger = " ".join(b.entity.removeprefix("event:").replace("-", " ") for b in a.bound_to if b.role == "trigger")
    parts = ["access" if a.type == "access" else "", a.topic.replace("-", " "), a.summary, a.diagnosis, a.fact, a.action,
             trigger, *(c.text for c in a.conditions)]
    return " ".join(p for p in parts if p)


@dataclass
class RelevanceReport:
    status: RelevanceStatus
    score: float | None = None
    matched: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)

    def line(self) -> str:
        if self.status == "not assessed":
            return "Problem match: not assessed (no known word in the problem)"
        return f"Problem match: {self.status} ({self.score:.0%}: {', '.join(self.matched) or 'nothing'})"


_INDEXES: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def index_for(store) -> "RelevanceIndex":
    """The index of a ContextStore, rebuilt when assertions were added or removed."""
    cached = _INDEXES.get(store)
    if cached and cached[0] == len(store.assertions):
        return cached[1]
    index = RelevanceIndex(store.assertions.values())
    _INDEXES[store] = (len(store.assertions), index)
    return index


def assess_for(store, entity_id: str, assertions: Iterable[ContextAssertion], problem: str | None,
               threshold: float = DEFAULT_THRESHOLD) -> dict[str, "RelevanceReport"]:
    """Problem match of rules retrieved for an element: the element's site name is scope, so it is ignored."""
    el = store.inventory.resolve_element(entity_id)
    site = store.inventory.sites.get(el.site_id) if el and el.site_id else None
    return index_for(store).assess_all(assertions, problem, threshold, ignore=[site.name] if site else [])


class RelevanceIndex:
    """IDF of concepts over a set of rules (the knowledge base), plus each rule's concepts (cached)."""

    def __init__(self, assertions: Iterable[ContextAssertion]):
        assertions = list(assertions)
        self._concepts: dict[str, set[str]] = {a.id: concepts(rule_text(a)) for a in assertions}
        # An invalidation is about the problem of the rules it closed ("4.3 fixes the leak" answers "node sluggish").
        for a in assertions:
            if a.closed_by and a.closed_by in self._concepts:
                self._concepts[a.closed_by] |= self._concepts[a.id]
        df: dict[str, int] = {}
        n = len(assertions)
        for cs in self._concepts.values():
            for c in cs:
                df[c] = df.get(c, 0) + 1
        self.n = n
        self.idf = {c: math.log(1 + (n - d + 0.5) / (d + 0.5)) for c, d in df.items()}

    def rule_concepts(self, a: ContextAssertion) -> set[str]:
        if a.id not in self._concepts:
            self._concepts[a.id] = concepts(rule_text(a))
        return self._concepts[a.id]

    def problem_concepts(self, problem: str | None, ignore: Iterable[str] = ()) -> list[str]:
        """The problem's concepts that the knowledge base uses (the others cannot tell rules apart). `ignore`: scope
        words of the case, such as its site's name ("Salo Niemiranta mast"), which the graph already handled."""
        skip = concepts(" ".join(ignore))
        return sorted(c for c in concepts(problem) if c in self.idf and c not in skip)

    def score(self, a: ContextAssertion, q: list[str]) -> tuple[float, list[str]]:
        doc = self.rule_concepts(a)
        matched = [c for c in q if c in doc]
        total = sum(self.idf[c] for c in q)
        return (sum(self.idf[c] for c in matched) / total if total else 0.0), matched

    def assess_all(self, assertions: Iterable[ContextAssertion], problem: str | None,
                   threshold: float = DEFAULT_THRESHOLD, ignore: Iterable[str] = ()) -> dict[str, RelevanceReport]:
        q = self.problem_concepts(problem, ignore)
        out: dict[str, RelevanceReport] = {}
        for a in assertions:
            if not q:
                out[a.id] = RelevanceReport("not assessed")
                continue
            score, matched = self.score(a, q)
            status: RelevanceStatus = "matches the problem" if score >= threshold else "other problem"
            out[a.id] = RelevanceReport(status, round(score, 3), matched, [c for c in q if c not in matched])
        return out

    def assess(self, a: ContextAssertion, problem: str | None, threshold: float = DEFAULT_THRESHOLD) -> RelevanceReport:
        return self.assess_all([a], problem, threshold)[a.id]
