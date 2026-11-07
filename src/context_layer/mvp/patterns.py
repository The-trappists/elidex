"""Patterns across human reports: problems that keep coming back, and problems reported on different elements
at about the same time that share something in the network.

Two kinds:
- "recurring": the same workaround keeps being needed (same topic, 3+ separate reports or applications).
- "linked": two or more elements, reported in separate conversations close in time, share a neighbour in the
  topology, a site or a firmware. The shared neighbour may be an element nobody mentioned (a hidden suspect).

Each pattern gets a short deduction: what the reports share, whether every fix so far was temporary (reboot,
bounce...), and any lasting fix people already stated elsewhere (firmware, replacement) that is not rolled out
everywhere. These are hypotheses, labelled as such.

Scope: built only from knowledge people already gave (assertions, their source threads, field outcomes) plus the
inventory and topology. It never reads alarms or telemetry and never diagnoses a fault. Nothing here is returned by
get_context or the guard: the agent's main path is unchanged and a hypothesis is never served as a rule.
Nobody has to confirm anything: a later lasting fix closes the pattern on its own.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from ..models import ContextAssertion
    from ..store import ContextStore

log = logging.getLogger(__name__)

Level = Literal["watch", "insight", "resolved"]
FixKind = Literal["temporary", "lasting", "unknown"]
Embedder = Callable[[list[str]], list[list[float]]]  # texts -> L2-normalised vectors, in order

HYPOTHESIS_NOTE = "Hypothesis built from captured reports; nobody stated it. Not used as a rule by the agent."

# Words in an action that clear a symptom without removing its cause.
_TEMPORARY = re.compile(
    r"\b(re-?boot|restart|bounce|reset|power[- ]?cycle|re-?enable|disable|re-?seat|clear|flip|wait|defrost|kick|"
    r"reload|toggle|re-?start)\w*",
    re.IGNORECASE,
)
# Words in an action that remove a cause for good.
_LASTING = re.compile(
    r"\b(upgrade|firmware|patch|replace|new lock|rewire|re-?route|relocate|install|swap out|retrofit)\w*",
    re.IGNORECASE,
)
_VERSION = re.compile(r"(?:firmware|fw|version|release|software)\s*v?(\d+(?:\.\d+)+)", re.IGNORECASE)


@dataclass
class PatternSettings:
    lookback_days: int = 90  # reports older than this are ignored
    recurring_min: int = 3  # separate occurrences of the same problem to call it recurring
    same_case_hours: int = 24  # chat + email on the same element and topic within this = one occurrence
    linked_window_hours: int = 6  # reports this close in time can be linked
    max_watch: int = 10  # cap on single sightings kept in the watch list
    max_hypotheses: int = 3
    same_words: float = 0.5  # topic or action word overlap (Jaccard) to call two topics the same problem
    # Symptom checks are generic ("UP", "counters 0"), so only an identical set of 3+ checks counts on its own.
    same_checks: float = 1.0
    min_checks: int = 3
    # Cosine similarity of two problem texts to call them the same problem, with an embedding model. None: read
    # PATTERNS_SAME_MEANING (config). Calibrate it on the real model with `ctx patterns --check-meaning`.
    same_meaning: float | None = None


# ---------------------------------------------------------------- output models


class Occurrence(BaseModel):
    """One time a person reported a problem on an element, or a workaround was applied there."""

    element: str
    at: datetime
    topic: str
    problem: str = ""  # the topic group: topics that name the same problem share it (see group_topics)
    assertion_id: str
    kind: Literal["reported", "applied"]
    sources: list[str] = Field(default_factory=list)  # thread files, or the outcome's case id
    by: str | None = None
    action: str | None = None
    worked: bool | None = None  # for "applied"


class Factor(BaseModel):
    """Something the affected elements have in common."""

    kind: Literal["dependency", "link", "site", "firmware", "model"]
    entity: str  # element, link id, site id or "TX-3000 firmware 3.8"
    strength: Literal["strong", "medium", "weak"]
    covers: list[str]
    detail: str
    reported: bool | None = None  # dependency: was the neighbour itself reported? False = hidden suspect


class Fix(BaseModel):
    assertion_id: str
    action: str
    stated_by: str
    at: datetime
    kind: FixKind
    applied: int = 0  # occurrences in the pattern that used it


class Hypothesis(BaseModel):
    text: str
    basis: list[str]
    strength: Literal["strong", "medium", "weak"]


class Pattern(BaseModel):
    id: str
    kind: Literal["recurring", "linked"]
    level: Level
    title: str
    elements: list[str]
    topics: list[str]
    first_seen: datetime
    last_seen: datetime
    count: int  # occurrences (recurring) or episodes (linked)
    occurrences: list[Occurrence]
    factors: list[Factor] = Field(default_factory=list)
    fixes: list[Fix] = Field(default_factory=list)  # what people did when it happened
    lasting_fixes: list[Fix] = Field(default_factory=list)  # lasting fixes people stated that reach these elements
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    status_note: str | None = None
    resolved_by: str | None = None
    people: list[str] = Field(default_factory=list)  # who to ask
    grouped: list[str] = Field(default_factory=list)  # why differently named topics count as one problem
    note: str = HYPOTHESIS_NOTE


# ---------------------------------------------------------------- helpers


_NOT_DONE = re.compile(r"\b(before|instead of|not|don't|do not|never|avoid|without|unless|rather than)\s+(\w+\s+){0,2}$",
                       re.IGNORECASE)


def classify_fix(action: str | None) -> FixKind:
    """The first thing the action tells you to do decides. "Reset F3 ... before replacing it" is temporary."""
    if not action:
        return "unknown"
    found = []
    for kind, rx in (("temporary", _TEMPORARY), ("lasting", _LASTING)):
        for m in rx.finditer(action):
            if not _NOT_DONE.search(action[: m.start()]):
                found.append((m.start(), kind))
                break
    return min(found)[1] if found else "unknown"


def stated_version(a: ContextAssertion) -> tuple[int, ...] | None:
    for text in (a.action, a.fact, a.summary):
        if text and (m := _VERSION.search(text)):
            return _version(m[1])
    return None


def _version(raw: str | None) -> tuple[int, ...] | None:
    if not raw:
        return None
    try:
        return tuple(int(p) for p in raw.split("."))
    except ValueError:
        return None


def _vstr(v: tuple[int, ...]) -> str:
    return ".".join(map(str, v))


def _pid(kind: str, key: str) -> str:
    return f"pat-{kind}-{hashlib.sha1(key.encode()).hexdigest()[:8]}"


def _fmt(t: datetime) -> str:
    return f"{t:%Y-%m-%d %H:%M}"


def _join(items: Iterable[str]) -> str:
    items = list(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _all(items: list[str]) -> str:
    return "both" if len(items) == 2 else "all"


def _norm(text: str | None) -> str:
    return " ".join((text or "").lower().split())


class _Net:
    """Inventory + topology lookups."""

    def __init__(self, store: ContextStore, links: Iterable[tuple[str, str, str, str]], at: datetime):
        self.store = store
        self.inv = store.inventory
        self.at = at
        self.adj: dict[str, dict[str, str]] = {}  # element -> {neighbour: link id}
        self.link_kind: dict[str, str] = {}
        for lid, a, b, kind in links:
            if a in self.inv.elements and b in self.inv.elements:
                self.adj.setdefault(a, {})[b] = lid
                self.adj.setdefault(b, {})[a] = lid
                self.link_kind[lid] = kind

    def known(self) -> list[ContextAssertion]:
        """Assertions already stated at `at`: nothing from the future."""
        return [a for a in self.store.assertions.values() if a.valid_from <= self.at]

    def reach(self, a: ContextAssertion) -> set[str]:
        """Elements an assertion covers: direct elements, class members, elements at a bound site."""
        out: set[str] = set()
        for b in a.bound_to:
            if b.role == "trigger":
                continue
            if b.entity in self.inv.elements:
                out.add(b.entity)
            elif b.entity in self.store.classes:
                crit = self.store.classes[b.entity].criteria
                out |= {e.id for e in self.inv.elements.values() if crit.matches(e)}
            elif b.entity in self.inv.sites:
                out |= {e.id for e in self.inv.elements.values() if e.site_id == b.entity}
        return out


# ---------------------------------------------------------------- topic grouping
#
# The extractor names each piece of knowledge with a topic slug. A real LLM does not always reuse the slug for the
# same problem ("turku-harbour-hut-breaker-f3-trip" vs "harbour-hut-breaker-trip"), which would split the repeats.
# Two topics count as one problem when they are about the same place AND say the same thing. Both are required:
# similar words on unrelated elements, or one element with two different problems, stay apart.

_STOP = {
    "a", "an", "the", "and", "or", "of", "on", "in", "at", "to", "for", "from", "with", "by", "it", "its", "is", "be",
    "then", "again", "once", "first", "if", "that", "this", "so", "bit", "little", "about", "around", "until",
    "after", "before", "back", "up", "down", "out", "try", "just", "only", "when", "while", "any", "all", "not", "no",
    "do", "don't", "can", "cannot", "can't", "will", "should", "must", "make", "sure", "check", "issue", "problem",
}


def _stem(w: str) -> str:
    """Crude, on purpose: "tripped" -> "trip", "disabling" -> "disabl", "counters" -> "counter"."""
    for suffix in ("ing", "ed", "es", "s"):
        if len(w) > len(suffix) + 3 and w.endswith(suffix):
            w = w[: -len(suffix)]
            if suffix in ("ing", "ed") and len(w) > 3 and w[-1] == w[-2] and w[-1] not in "aeiouls":
                w = w[:-1]
            return w
    return w


def _words(text: str | None, noise: re.Pattern | None) -> set[str]:
    text = (text or "").lower().replace("-", " ").replace("_", " ")
    if noise is not None:
        text = noise.sub(" ", text)
    words = (w.strip(".,;:!?'\"()") for w in text.split())
    return {_stem(w) for w in words if len(w) > 1 and w not in _STOP and not w.isdigit()}


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _checks(a: ContextAssertion) -> set[tuple[str, str, str]]:
    return {(c.check.field, c.check.op, str(c.check.value).lower()) for c in a.conditions if c.check}


def _noise_pattern(net: _Net) -> re.Pattern | None:
    """Element ids, aliases and models: they say *where*, which the place check already covers, not *what*."""
    keys = {k for e in net.inv.elements.values() for k in (e.id, e.model, *e.aliases) if k}
    parts = [r"[-\s_]?".join(re.escape(p) for p in re.split(r"[^A-Za-z0-9]+", k) if p) for k in keys]
    parts = [p for p in parts if p]
    if not parts:
        return None
    return re.compile(r"(?<![a-z0-9])(" + "|".join(sorted(parts, key=len, reverse=True)) + r")(?![a-z0-9])",
                      re.IGNORECASE)


def _contradiction(a: ContextAssertion, b: ContextAssertion) -> str | None:
    """Both expect a different value for the same observable field: two different problems, whatever the words.

    "optical_levels low" (optics still settling) is not "optical_levels normal" (forwarding state); "interface DOWN"
    (power dip) is not "interface UP" (evening sync loss).
    """
    eq_a = {c.check.field: str(c.check.value).lower() for c in a.conditions if c.check and c.check.op == "=="}
    eq_b = {c.check.field: str(c.check.value).lower() for c in b.conditions if c.check and c.check.op == "=="}
    clash = sorted(f for f in eq_a.keys() & eq_b.keys() if eq_a[f] != eq_b[f])
    return f"{clash[0]} {eq_a[clash[0]]} vs {eq_b[clash[0]]}" if clash else None


def _cure_vs_workaround(a: ContextAssertion, b: ContextAssertion) -> bool:
    """One clears the symptom, the other removes the cause: the problem and its cure, not two names for one problem."""
    return {classify_fix(a.action), classify_fix(b.action)} == {"temporary", "lasting"}


def problem_text(topic: str, summary: str | None, action: str | None, diagnosis: str | None,
                 noise: re.Pattern | None) -> str:
    """What is embedded: the problem and its fix, without element ids and models (place is checked apart)."""
    parts = [topic.replace("-", " ").replace("_", " "), diagnosis, summary, action]
    text = ". ".join(p.strip().rstrip(".") for p in parts if p and p.strip())
    return " ".join((noise.sub(" ", text) if noise is not None else text).split())


def _cosine(u: list[float], v: list[float]) -> float:
    return sum(x * y for x, y in zip(u, v))  # vectors are L2-normalised


def _same_problem(net: _Net, a: ContextAssertion, b: ContextAssertion, noise: re.Pattern | None,
                  s: PatternSettings, vectors: dict[str, list[float]] | None = None,
                  threshold: float = 1.0) -> str | None:
    """Why a and b are the same problem under two topic names, or None.

    Place first (same element, overlapping scope or same model), then two guards that no wording can overrule
    (contradicting symptom checks; a workaround vs its cure), then the evidence: similar topic words, similar fix
    words, identical symptom checks, or, with an embedding model, the same meaning.
    """
    ea = {e for e in a.about if e in net.inv.elements}
    eb = {e for e in b.about if e in net.inv.elements}

    def models(es: set[str]) -> set[tuple[str, str]]:
        return {(net.inv.elements[e].type, net.inv.elements[e].model) for e in es}

    model_only = False
    if ea & eb:
        place = f"same element {_join(sorted(ea & eb))}"
    elif net.reach(a) & net.reach(b):
        place = "overlapping scope"
    elif models(ea) & models(eb):
        place = "same model " + _join(sorted(m for _, m in models(ea) & models(eb)))
        model_only = True
    else:
        return None
    if _contradiction(a, b) or _cure_vs_workaround(a, b):
        return None
    if _jaccard(_words(a.topic, noise), _words(b.topic, noise)) >= s.same_words:
        return f"{place}, similar topic names"
    if _jaccard(_words(a.action, noise), _words(b.action, noise)) >= s.same_words:
        return f"{place}, the same fix in other words"
    ca, cb = _checks(a), _checks(b)
    if len(ca | cb) >= s.min_checks and _jaccard(ca, cb) >= s.same_checks:
        return f"{place}, identical symptom checks"
    # Meaning is the fuzziest evidence: "similar kind of problem" on two units of one model is often two unit-specific
    # causes (RAD-176's frost margin "on RAD-176 only" vs RAD-198's iced dish, similarity 0.82 on gemini-embedding-001).
    # So meaning needs a real shared place: the same element, or an overlapping class or site scope.
    if vectors and not model_only and a.id in vectors and b.id in vectors:
        sim = _cosine(vectors[a.id], vectors[b.id])
        if sim >= threshold:
            return f"{place}, same meaning in other words (similarity {sim:.2f})"
    return None


def group_topics(
    net: _Net, s: PatternSettings, embedder: Embedder | None = None
) -> tuple[dict[str, str], dict[str, list[str]], str]:
    """(topic -> group key, group key -> reasons, how meaning was compared). The key is the group's oldest topic."""
    from .. import config

    by_topic: dict[str, list[ContextAssertion]] = {}
    for a in sorted(net.known(), key=lambda a: a.valid_from):
        if a.type == "workaround":
            by_topic.setdefault(a.topic, []).append(a)
    parent = {t: t for t in by_topic}

    def find(t: str) -> str:
        while parent[t] != t:
            t = parent[t]
        return t

    noise = _noise_pattern(net)
    threshold = s.same_meaning if s.same_meaning is not None else config.PATTERNS_SAME_MEANING
    vectors: dict[str, list[float]] = {}
    meaning = "off: words only (set EMBEDDING_MODEL to also compare meaning)"
    if embedder is not None:
        items = [a for group in by_topic.values() for a in group]
        try:
            vecs = embedder([problem_text(a.topic, a.summary, a.action, a.diagnosis, noise) for a in items])
            vectors = {a.id: v for a, v in zip(items, vecs)}
            meaning = f"on: {getattr(embedder, 'label', 'embeddings')}, same problem from similarity {threshold:.2f}"
        except (Exception, SystemExit) as e:  # noqa: BLE001 - no network, quota, bad model: words still work
            log.warning("patterns: embeddings failed, words only: %s", e)
            meaning = f"failed ({type(e).__name__}: {str(e)[:120]}): words only"

    reasons: dict[str, list[str]] = {}
    members = {t: list(group) for t, group in by_topic.items()}  # group key -> its assertions

    def compatible(r1: str, r2: str) -> bool:
        """Grouping is transitive (A~X, X~B puts A with B), so the guards must hold for every member of both."""
        return not any(_contradiction(a, b) or _cure_vs_workaround(a, b) for a in members[r1] for b in members[r2])

    topics = list(by_topic)  # oldest first, so the oldest topic of a group becomes its key
    for i, t1 in enumerate(topics):
        for t2 in topics[i + 1:]:
            r1, r2 = find(t1), find(t2)
            if r1 == r2 or not compatible(r1, r2):
                continue
            why = next((w for a in by_topic[t1] for b in by_topic[t2]
                        if (w := _same_problem(net, a, b, noise, s, vectors, threshold))), None)
            if why:
                parent[r2] = r1
                members[r1] += members.pop(r2)
                reasons.setdefault(r1, []).extend(reasons.pop(r2, []))
                reasons[r1].append(f"'{t2}' counted with '{t1}': {why}")
    return {t: find(t) for t in by_topic}, reasons, meaning


# ---------------------------------------------------------------- embeddings (the model of embed.py, cached)


def model_embedder(cache_path: Path | None = None) -> Embedder | None:
    """The configured embedding model (EMBEDDING_MODEL, see embed.py), with a disk cache; None when not configured.

    The hashed-words fallback of embed.py is not used here: it compares words, which the grouping already does.
    """
    from .. import config, embed

    if not config.EMBEDDING_MODEL:
        return None
    model = config.EMBEDDING_MODEL
    path = cache_path or config.OUT_DIR / "patterns" / "embeddings.json"

    def run(texts: list[str]) -> list[list[float]]:
        try:
            cache = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except ValueError:
            cache = {}
        vectors: dict[str, list[float]] = cache.get(model, {})
        keys = [hashlib.sha1(t.encode()).hexdigest() for t in texts]
        missing = sorted({(k, t) for k, t in zip(keys, texts) if k not in vectors})
        if missing:
            for (k, _), v in zip(missing, embed.embed([t for _, t in missing])):
                vectors[k] = [round(x, 6) for x in v]
            cache[model] = vectors
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(cache), encoding="utf-8")
        out = []
        for k in keys:
            v = vectors[k]
            norm = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / norm for x in v])
        return out

    run.label = model  # type: ignore[attr-defined]
    return run


def check_meaning(embedder: Embedder, threshold: float, pairs_file: Path | None = None) -> dict:
    """Score the labelled pairs of data/eval/pattern_pairs.json with a model: does `threshold` keep the look-alikes
    apart and the paraphrases together? Run by a human with the key (`ctx patterns --check-meaning`)."""
    from .. import config
    from ..workbench.seed import load_seed

    seed = load_seed()
    keys = {k for e in seed.elements for k in (e.id, e.model, *e.aliases) if k}
    parts = [r"[-\s_]?".join(re.escape(p) for p in re.split(r"[^A-Za-z0-9]+", k) if p) for k in keys]
    noise = re.compile(r"(?<![a-z0-9])(" + "|".join(sorted(parts, key=len, reverse=True)) + r")(?![a-z0-9])",
                       re.IGNORECASE)
    path = pairs_file or config.DATA_DIR / "eval" / "pattern_pairs.json"
    pairs = json.loads(path.read_text(encoding="utf-8"))["pairs"]

    def text(side: dict) -> str:
        return problem_text(side["topic"], side.get("summary"), side.get("action"), side.get("diagnosis"), noise)

    vecs = embedder([text(side) for p in pairs for side in (p["a"], p["b"])])
    rows = []
    for i, p in enumerate(pairs):
        sim = _cosine(vecs[2 * i], vecs[2 * i + 1])
        # A pair marked stopped_by_place shares only a model: meaning is never compared for it (see _same_problem).
        # It is shown for information and does not count for the threshold.
        stopped = bool(p.get("stopped_by_place"))
        rows.append({"why": p["why"], "same": p["same"], "similarity": round(sim, 3), "stopped_by_place": stopped,
                     "ok": stopped or (sim >= threshold) == p["same"]})
    counted = [r for r in rows if not r["stopped_by_place"]]
    same = [r["similarity"] for r in counted if r["same"]]
    diff = [r["similarity"] for r in counted if not r["same"]]
    lo, hi = min(same), max(diff)
    return {
        "threshold": threshold, "rows": rows, "lowest_same": lo, "highest_different": hi,
        "separable": lo > hi, "suggested": round((lo + hi) / 2, 2) if lo > hi else None,
        "wrong_merges": sum(1 for r in rows if not r["same"] and not r["ok"]),
        "missed": sum(1 for r in rows if r["same"] and not r["ok"]),
    }


# ---------------------------------------------------------------- occurrences


def collect_occurrences(
    store: ContextStore, thread_times: dict[str, datetime], at: datetime, settings: PatternSettings,
    groups: dict[str, str] | None = None,
) -> list[Occurrence]:
    """Every report of a problem on a named element, plus every field application, deduplicated per case."""
    since = at - timedelta(days=settings.lookback_days)
    groups = groups or {}
    raw: list[Occurrence] = []
    for a in store.assertions.values():
        if a.type != "workaround":  # a workaround = someone had a problem and did something about it
            continue
        problem = groups.get(a.topic, a.topic)
        elements = sorted(e for e in a.about if e in store.inventory.elements)
        for src in a.sources:
            t = thread_times.get(src.file, a.valid_from)
            for e in elements:
                raw.append(Occurrence(element=e, at=t, topic=a.topic, problem=problem, assertion_id=a.id,
                                      kind="reported", sources=[src.file], by=a.trust.stated_by, action=a.action))
        for o in a.outcomes:
            if o.entity in store.inventory.elements:
                raw.append(Occurrence(element=o.entity, at=o.at, topic=a.topic, problem=problem, assertion_id=a.id,
                                      kind="applied", sources=[o.case_id or "field outcome"], action=a.action,
                                      worked=o.worked))
    raw = [o for o in raw if since <= o.at <= at]
    raw.sort(key=lambda o: o.at)

    # Chat + email about the same case, or a report and its application the same day, are one occurrence.
    out: list[Occurrence] = []
    same_case = timedelta(hours=settings.same_case_hours)
    for o in raw:
        twin = next((x for x in reversed(out) if x.element == o.element and x.problem == o.problem
                     and o.at - x.at <= same_case), None)
        if twin:
            twin.sources += [s for s in o.sources if s not in twin.sources]
            if o.kind == "applied":
                twin.kind, twin.worked = "applied", o.worked
        else:
            out.append(o)
    return out


# ---------------------------------------------------------------- recurring


def _lasting_fixes_for(net: _Net, elements: set[str], topics: set[str], closers: set[str],
                       since: datetime) -> list[tuple[ContextAssertion, Fix]]:
    """Lasting fixes people stated that reach these elements: on the same topic or that closed the knowledge (any
    date: a fix stated before the repeats began, and not rolled out, is exactly what the report must show), or
    bound to one of the elements themselves since the problem started (a cause someone found, under another topic).
    """
    found = []
    for a in net.known():
        lasting = a.type == "invalidation" or classify_fix(a.action) == "lasting"
        if not lasting or not (net.reach(a) & elements):
            continue
        on_element = a.valid_from >= since and bool({b.entity for b in a.bound_to} & elements)
        if a.id not in closers and a.topic not in topics and not on_element:
            continue
        text = a.action or a.fact or a.summary
        found.append((a, Fix(assertion_id=a.id, action=text, stated_by=a.trust.stated_by, at=a.valid_from,
                             kind="lasting")))
    return found


def _rollout_gaps(net: _Net, fixes: list[tuple[ContextAssertion, Fix]], elements: set[str]) -> list[str]:
    """Elements still below a firmware version that a stated lasting fix names."""
    gaps = []
    for a, _ in fixes:
        v = stated_version(a)
        if not v:
            continue
        for e in sorted(elements):
            fw = _version(net.inv.elements[e].firmware)
            if fw is not None and fw < v:
                gaps.append(f"{e} still runs {net.inv.elements[e].firmware} (fix needs {_vstr(v)})")
    return gaps


def _fixes_applied(occ: list[Occurrence], store: ContextStore) -> list[Fix]:
    """What people did each time, one row per distinct action (the same advice from two people counts once)."""
    by_action: dict[str, Fix] = {}
    for o in occ:
        a = store.assertions.get(o.assertion_id)
        if not a or not a.action:
            continue
        f = by_action.setdefault(_norm(a.action), Fix(assertion_id=a.id, action=a.action, stated_by=a.trust.stated_by,
                                                     at=a.valid_from, kind=classify_fix(a.action)))
        f.applied += 1
    return sorted(by_action.values(), key=lambda f: -f.applied)


def find_recurring(net: _Net, occ: list[Occurrence], at: datetime, s: PatternSettings,
                   reasons: dict[str, list[str]] | None = None) -> list[Pattern]:
    patterns = []
    by_problem: dict[str, list[Occurrence]] = {}
    for o in occ:
        by_problem.setdefault(o.problem or o.topic, []).append(o)
    for problem, group in by_problem.items():
        if len(group) < 2:
            continue
        store = net.store
        names = [o.topic for o in group]
        topics = sorted(set(names))
        topic = max(topics, key=lambda t: (names.count(t), t == problem))  # the most used name heads the title
        elements = sorted({o.element for o in group})
        aids = {o.assertion_id for o in group}
        assertions = [store.assertions[i] for i in aids if i in store.assertions]
        closers = {a.closed_by for a in assertions if a.closed_by}
        fixes = _fixes_applied(group, store)
        lasting = _lasting_fixes_for(net, set(elements), set(topics), closers, group[0].at)
        gaps = _rollout_gaps(net, lasting, set(elements))
        all_closed = bool(assertions) and all(a.valid_to is not None and a.valid_to <= at for a in assertions)
        last = group[-1].at

        level: Level = "insight" if len(group) >= s.recurring_min else "watch"
        status, resolved_by = None, None
        # A proposal ("someone should rewire it") never closes a pattern; a stated or verified fix after the last
        # occurrence, or knowledge closed by a lasting fix, does.
        done = [(a, f) for a, f in lasting if a.trust.level != "hunch" and (a.id in closers or f.at >= last)]
        if done and (all_closed or any(f.at >= last for _, f in done)):
            closer = next((f for a, f in done if a.id in closers), done[0][1])
            resolved_by = closer.assertion_id
            if gaps:
                status = f"Lasting fix stated by {closer.stated_by}, not rolled out everywhere: " + "; ".join(gaps)
                level = "insight"
            else:
                status = f"Lasting fix stated by {closer.stated_by} on {_fmt(closer.at)}."
                level = "resolved"

        factors = _shared_factors(net, set(elements), group, include_dependency=False) if len(elements) > 1 else []
        where = elements[0] if len(elements) == 1 else f"{len(elements)} elements"
        p = Pattern(
            id=_pid("recurring", problem), kind="recurring", level=level,
            title=f"'{topic}' needed {len(group)} times on {where}",
            elements=elements, topics=topics, first_seen=group[0].at, last_seen=last, count=len(group),
            grouped=[r for r in (reasons or {}).get(problem, []) if any(f"'{t}'" in r for t in topics if t != problem)],
            occurrences=group, factors=factors, fixes=fixes, lasting_fixes=[f for _, f in lasting],
            status_note=status, resolved_by=resolved_by,
            people=sorted({o.by for o in group if o.by} | {f.stated_by for _, f in lasting}),
        )
        p.hypotheses = _deduce(p, gaps, s)
        patterns.append(p)
    return patterns


# ---------------------------------------------------------------- linked


def _shared_factors(net: _Net, elements: set[str], occ: list[Occurrence], include_dependency: bool = True) -> list[Factor]:
    """What 2+ of the elements have in common: a topology neighbour, a direct link, a site, a firmware, a model."""
    inv = net.inv
    reported = {o.element for o in occ}
    factors: list[Factor] = []
    if include_dependency:
        neighbours: dict[str, list[str]] = {}
        for e in elements:
            for n in net.adj.get(e, {}):
                neighbours.setdefault(n, []).append(e)
        for n, covered in neighbours.items():
            if len(covered) < 2:
                continue
            links = [net.adj[n][e] for e in sorted(covered)]
            el = inv.elements[n]
            factors.append(Factor(
                kind="dependency", entity=n, strength="strong", covers=sorted(covered), reported=n in reported,
                detail=f"{_join(sorted(covered))} are {_all(covered)} linked to {n} ({el.type.replace('_', ' ')} "
                       f"{el.model}, links {', '.join(links)})",
            ))
        for e in sorted(elements):
            for n, lid in net.adj.get(e, {}).items():
                if n in elements and e < n:
                    factors.append(Factor(kind="link", entity=lid, strength="strong", covers=[e, n],
                                          detail=f"{e} and {n} are connected by {lid} ({net.link_kind[lid]})"))
    groups: dict[tuple[str, str], list[str]] = {}
    for e in sorted(elements):
        el = inv.elements[e]
        if el.site_id:
            groups.setdefault(("site", el.site_id), []).append(e)
        if el.firmware:
            groups.setdefault(("firmware", f"{el.model} firmware {el.firmware}"), []).append(e)
        groups.setdefault(("model", el.model), []).append(e)
    for (kind, key), covered in groups.items():
        if len(covered) < 2:
            continue
        if kind == "site":
            name = inv.sites[key].name if key in inv.sites else key
            factors.append(Factor(kind="site", entity=key, strength="strong", covers=covered,
                                  detail=f"{_join(covered)} are at the same site, {name}"))
        elif kind == "firmware":
            factors.append(Factor(kind="firmware", entity=key, strength="medium", covers=covered,
                                  detail=f"{_join(covered)} {_all(covered)} run {key}"))
        elif not any(f.kind == "firmware" and set(f.covers) == set(covered) for f in factors):
            factors.append(Factor(kind="model", entity=key, strength="weak", covers=covered,
                                  detail=f"{_join(covered)} are {_all(covered)} {key} (different firmware)"))
    return factors


def _episodes(occ: list[Occurrence], window: timedelta) -> list[list[Occurrence]]:
    """Fixed windows from the first unassigned occurrence; a long busy period does not chain into one episode."""
    episodes, current = [], []
    for o in occ:
        if current and o.at - current[0].at > window:
            episodes.append(current)
            current = []
        current.append(o)
    if current:
        episodes.append(current)
    return episodes


def find_linked(net: _Net, occ: list[Occurrence], at: datetime, s: PatternSettings) -> list[Pattern]:
    episodes = _episodes(occ, timedelta(hours=s.linked_window_hours))
    # factor key -> [(episode index, covered elements, factor)]
    hits: dict[tuple[str, str], list[tuple[int, frozenset[str], Factor]]] = {}
    for i, ep in enumerate(episodes):
        elements = {o.element for o in ep}
        if len(elements) < 2:
            continue
        for f in _shared_factors(net, elements, ep):
            if f.strength == "weak":
                continue
            covered_occ = [o for o in ep if o.element in f.covers]
            # Seemingly unrelated: the elements come from separate conversations, not one person linking them.
            if len({src for o in covered_occ for src in o.sources}) < 2:
                continue
            hits.setdefault((f.kind, f.entity), []).append((i, frozenset(f.covers), f))

    # Factors that explain exactly the same reports become one pattern with several candidate causes.
    merged: dict[tuple, list[tuple[str, str]]] = {}
    for key, rows in hits.items():
        sig = tuple(sorted((i, tuple(sorted(c))) for i, c, _ in rows))
        merged.setdefault(sig, []).append(key)

    patterns = []
    for sig, keys in merged.items():
        ep_ids = sorted({i for i, _ in sig})
        elements = sorted({e for _, c in sig for e in c})
        occ_in = [o for i in ep_ids for o in episodes[i] if o.element in elements]
        rank = {"strong": 0, "medium": 1, "weak": 2}
        factors = sorted((hits[k][-1][2] for k in keys), key=lambda f: (rank[f.strength], f.kind))
        for f in factors:  # covers over every episode, not only the last one
            f.covers = sorted({e for i, c, _ in hits[(f.kind, f.entity)] for e in c})
            if f.kind == "dependency":
                f.reported = any(o.element == f.entity for o in occ_in)
        best = factors[0].strength
        many = len(ep_ids) >= 2 or len(elements) >= 3
        if best == "medium" and not many:
            continue  # same firmware twice at the same time is too common to report on its own
        level: Level = "insight" if many else "watch"
        weak = next((f for f in _shared_factors(net, set(elements), occ_in, include_dependency=False)
                     if f.kind == "model" and set(f.covers) == set(elements)), None)
        if weak:
            factors.append(weak)

        anchors = {f.entity for f in factors if f.kind in ("dependency", "site")}
        lasting = [
            (a, Fix(assertion_id=a.id, action=a.action or a.fact or a.summary, stated_by=a.trust.stated_by,
                    at=a.valid_from, kind="lasting"))
            for a in net.known()
            if a.valid_from > occ_in[-1].at and (a.type == "invalidation" or classify_fix(a.action) == "lasting")
            and ({b.entity for b in a.bound_to} & anchors)
        ]
        status, resolved_by = None, None
        if any(a.trust.level != "hunch" for a, _ in lasting):
            lasting.sort(key=lambda af: af[0].trust.level == "hunch")
            level = "resolved"
            resolved_by = lasting[0][1].assertion_id
            status = f"Lasting fix on {_join(sorted({b.entity for b in lasting[0][0].bound_to} & anchors))} " \
                     f"stated by {lasting[0][1].stated_by} on {_fmt(lasting[0][1].at)}."

        when = f"{len(ep_ids)} times" if len(ep_ids) > 1 else f"on {occ_in[0].at:%Y-%m-%d}"
        p = Pattern(
            id=_pid("linked", "|".join(sorted(f"{k}:{e}" for k, e in keys)) + "|" + ",".join(elements)),
            kind="linked", level=level,
            title=f"{_join(elements)} had problems at the same time ({when})",
            elements=elements, topics=sorted({o.topic for o in occ_in}),
            first_seen=occ_in[0].at, last_seen=occ_in[-1].at, count=len(ep_ids), occurrences=occ_in,
            factors=factors, fixes=_fixes_applied(occ_in, net.store), lasting_fixes=[f for _, f in lasting],
            status_note=status, resolved_by=resolved_by,
            people=sorted({o.by for o in occ_in if o.by} | {f.stated_by for _, f in lasting}),
        )
        p.hypotheses = _deduce(p, [], s)
        patterns.append(p)
    return patterns


# ---------------------------------------------------------------- deduction


def _deduce(p: Pattern, gaps: list[str], s: PatternSettings) -> list[Hypothesis]:
    """At most a few hypotheses, strongest first. Each cites what it rests on; none is an instruction."""
    out: list[Hypothesis] = []
    if gaps and p.lasting_fixes:
        f = p.lasting_fixes[0]
        out.append(Hypothesis(
            strength="strong",
            text=f"A lasting fix is already known ({f.action.rstrip('.')}, {f.stated_by}), but not every affected "
                 f"unit has it. The repeats should stop once it is rolled out.",
            basis=[f"{f.assertion_id} stated {_fmt(f.at)}", *gaps],
        ))
    elif p.lasting_fixes and p.level != "resolved":
        f = p.lasting_fixes[0]
        out.append(Hypothesis(
            strength="strong",
            text=f"{f.stated_by} proposed a lasting fix ({f.action.rstrip('.')}), but the workaround is still the "
                 f"one being applied. Doing it once should stop the repeats.",
            basis=[f"{f.assertion_id} stated {_fmt(f.at)}", f"last occurrence {_fmt(p.last_seen)}"],
        ))
    for f in p.factors:
        if f.kind == "dependency":
            hidden = "nobody reported it in these conversations" if not f.reported else "it was reported too"
            out.append(Hypothesis(
                strength="strong",
                text=f"The problems may start at {f.entity}, which {_join(f.covers)} {_all(f.covers)} depend on; "
                     f"{hidden}.",
                basis=[f.detail],
            ))
        elif f.kind == "link":
            out.append(Hypothesis(strength="strong", text=f"The link {f.entity} between {_join(f.covers)} is a "
                                  f"common point worth checking.", basis=[f.detail]))
        elif f.kind == "site":
            out.append(Hypothesis(strength="strong", text=f"Something at {f.entity} (power, cooling, access) may "
                                  f"affect {_join(f.covers)} together.", basis=[f.detail]))
        elif f.kind == "firmware":
            out.append(Hypothesis(strength="medium", text=f"A software issue in {f.entity} would explain "
                                  f"{_join(f.covers)}.", basis=[f.detail]))
    temporary = [f for f in p.fixes if f.kind == "temporary"]
    if temporary and len(temporary) == len([f for f in p.fixes if f.kind != "unknown"]) and p.count >= 2:
        actions = "; ".join(f"'{f.action.rstrip('.')}' ({f.applied}x)" for f in temporary)
        out.append(Hypothesis(
            strength="medium",
            text="Every fix so far cleared the symptom only, and the problem came back: the cause is still there.",
            basis=[actions],
        ))
    if p.kind == "recurring" and p.count >= s.recurring_min and not p.lasting_fixes and not gaps:
        out.append(Hypothesis(strength="weak", text="No lasting fix has been stated yet: ask the people below "
                              "what would remove the cause.", basis=[f"{p.count} occurrences, {_join(p.people) or '-'}"]))
    return out[: s.max_hypotheses]


# ---------------------------------------------------------------- entry points


class PatternReport(BaseModel):
    at: datetime
    meaning: str  # how topics were compared: words only, or words + an embedding model (and whether it failed)
    patterns: list[Pattern]


def find_patterns(
    store: ContextStore,
    links: Iterable[tuple[str, str, str, str]] = (),
    thread_times: dict[str, datetime] | None = None,
    at: datetime | None = None,
    settings: PatternSettings | None = None,
    entity_id: str | None = None,
    embedder: Embedder | None | Literal["auto"] = "auto",
) -> list[Pattern]:
    """All patterns known at `at` (default now), insights first. See analyze()."""
    return analyze(store, links, thread_times, at, settings, entity_id, embedder).patterns


def analyze(
    store: ContextStore,
    links: Iterable[tuple[str, str, str, str]] = (),
    thread_times: dict[str, datetime] | None = None,
    at: datetime | None = None,
    settings: PatternSettings | None = None,
    entity_id: str | None = None,
    embedder: Embedder | None | Literal["auto"] = "auto",
) -> PatternReport:
    """All patterns known at `at` (default now), insights first, and how topics were compared.

    `links`: (link id, a, b, kind). `thread_times` maps a source file to when its thread happened (default: the
    assertion's valid_from). `entity_id` keeps only patterns that involve the element (directly or as a shared
    factor). `embedder`: "auto" uses EMBEDDING_MODEL when set (cached), None compares words only.
    """
    at = at or datetime.now()
    s = settings or PatternSettings()
    net = _Net(store, links, at)
    groups, reasons, meaning = group_topics(net, s, model_embedder() if embedder == "auto" else embedder)
    occ = collect_occurrences(store, thread_times or {}, at, s, groups)
    linked = find_linked(net, occ, at, s)
    # A repeat already explained by a linked pattern is not listed again on its own (one entry per cause).
    covered = [{(o.element, o.at) for o in p.occurrences} for p in linked]
    recurring = [p for p in find_recurring(net, occ, at, s, reasons)
                 if p.level != "watch" or not any({(o.element, o.at) for o in p.occurrences} <= c for c in covered)]
    patterns = recurring + linked
    if entity_id:
        eid = store.resolve(entity_id)
        patterns = [p for p in patterns if eid in p.elements or any(f.entity == eid for f in p.factors)]
    order = {"insight": 0, "watch": 1, "resolved": 2}
    patterns.sort(key=lambda p: (order[p.level], -p.last_seen.timestamp()))
    watches = [p for p in patterns if p.level == "watch"][: s.max_watch]
    kept = [p for p in patterns if p.level != "watch" or p in watches]
    return PatternReport(at=at, meaning=meaning, patterns=kept)


def replay_history(extractor: str = "scripted"):
    """The labelled scenarios (eval timeline + data/eval/patterns_timeline.json) replayed through the real pipeline.

    Returns (store, links, thread_times), ready for find_patterns. Used by `ctx patterns` and the tests.
    """
    import json

    from .. import config
    from ..eval.kb import EvalSpec, TimelineEntry, build_kb, load_spec
    from ..workbench.seed import load_seed

    spec = load_spec()
    extra = json.loads((config.DATA_DIR / "eval" / "patterns_timeline.json").read_text(encoding="utf-8"))
    spec = EvalSpec(timeline=spec.timeline + [TimelineEntry.model_validate(e) for e in extra["timeline"]], cases=[])
    kb = build_kb(spec, extractor)  # type: ignore[arg-type]
    links = [(lk.id, lk.a, lk.b, lk.kind) for lk in load_seed().links]
    times = {r.thread.id: r.thread.started_at for r in kb.runs}
    return kb.store, links, times


def render_markdown(patterns: list[Pattern], at: datetime, title: str = "Patterns in captured knowledge",
                    meaning: str | None = None) -> str:
    """A report a planning team can read without the tool."""
    intro = (f"As of {_fmt(at)}. Built only from what people reported in chats, emails and field outcomes, plus the "
             "inventory and topology. Every cause below is a hypothesis: nobody stated it, and the agent does not use "
             "it as a rule.")
    lines = [f"# {title}", "", intro, ""]
    if meaning:
        lines += [f"Same problem under other words: meaning check {meaning}.", ""]
    sections = [("insight", "Insights: worth a look"), ("watch", "Watch list: seen once"),
                ("resolved", "Resolved: a lasting fix was stated")]
    for level, heading in sections:
        group = [p for p in patterns if p.level == level]
        lines += [f"## {heading} ({len(group)})", ""]
        if not group:
            lines += ["None.", ""]
        for p in group:
            lines += [f"### {p.title}", "",
                      f"- Kind: {p.kind}; first seen {_fmt(p.first_seen)}, last seen {_fmt(p.last_seen)}",
                      f"- Elements: {', '.join(p.elements)}"]
            if p.status_note:
                lines.append(f"- Status: {p.status_note}")
            if p.grouped:
                lines.append("- Counted as one problem: " + "; ".join(p.grouped))
            if p.factors:
                lines.append("- In common: " + "; ".join(f.detail for f in p.factors))
            if p.fixes:
                lines.append("- Fixes applied: " + "; ".join(f"{f.action.rstrip('.')} ({f.kind}, {f.applied}x, "
                                                             f"{f.stated_by})" for f in p.fixes))
            if p.hypotheses:
                lines.append("- Hypotheses:")
                lines += [f"  - [{h.strength}] {h.text} (basis: {'; '.join(h.basis)})" for h in p.hypotheses]
            if p.people:
                lines.append(f"- Who to ask: {', '.join(p.people)}")
            lines.append("- Reports:")
            for o in p.occurrences:
                who = f", advice from {o.by}" if o.by else ""
                what = "workaround applied" if o.kind == "applied" else "reported"
                res = "" if o.worked is None else (", worked" if o.worked else ", did not work")
                lines.append(f"  - {_fmt(o.at)} {o.element}: {o.topic} ({what}{who}{res}; "
                             f"source {', '.join(o.sources)}; {o.assertion_id})")
            lines.append("")
    return "\n".join(lines)
