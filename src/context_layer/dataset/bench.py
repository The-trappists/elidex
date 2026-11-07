"""Scale check of the core on a generated dataset: load the inventory, link the ground-truth facts, store them, query.

It feeds the linker with the *true* extraction (`facts.jsonl`), so it measures linking, storing and lookup at scale,
not the LLM. Run it before trusting a latency or an over-linking number from the small seed.
"""

from __future__ import annotations

import json
import statistics
import time
from datetime import datetime
from pathlib import Path
from random import Random

from ..link import Inventory, Linker
from ..models import ExtractedItem, Message, Thread
from ..store import ContextStore


def _ms(values: list[float]) -> dict:
    if not values:
        return {}
    values = sorted(values)
    return {"n": len(values), "p50_ms": round(statistics.median(values) * 1000, 3), "p95_ms": round(values[int(len(values) * 0.95) - 1] * 1000, 3), "max_ms": round(values[-1] * 1000, 3)}


def read_manifest(root: Path) -> dict:
    return json.loads((root / "manifest.json").read_text(encoding="utf-8"))


def bench(root: Path, max_facts: int | None = None, queries: int = 500, log=print, on_store=None) -> dict:
    out: dict = {}
    t = time.perf_counter()
    inventory = Inventory.load(root / "network")
    out["load_inventory_s"] = round(time.perf_counter() - t, 2)
    t = time.perf_counter()
    store = ContextStore(inventory)
    out["build_store_graph_s"] = round(time.perf_counter() - t, 2)
    out["inventory"] = {"elements": len(inventory.elements), "sites": len(inventory.sites)}
    log(f"inventory {out['inventory']} loaded in {out['load_inventory_s']} s, graph in {out['build_store_graph_s']} s")

    # ---- entity resolution: aliases are resolved exactly, site names may be ambiguous (by design of the data)
    rng = Random(1)
    elements = rng.sample(list(inventory.elements.values()), min(2000, len(inventory.elements)))
    lat, ok = [], 0
    for e in elements:
        for raw in (e.id, *e.aliases):
            t = time.perf_counter()
            hit = inventory.resolve_element(raw)
            lat.append(time.perf_counter() - t)
            ok += hit is not None and hit.id == e.id
    out["resolve_element"] = {**_ms(lat), "correct": ok, "of": len(lat)}
    sites = rng.sample(list(inventory.sites.values()), min(1000, len(inventory.sites)))
    lat, ok = [], 0
    for s in sites:
        t = time.perf_counter()
        hit = inventory.resolve_site(s.name)
        lat.append(time.perf_counter() - t)
        ok += hit is not None and hit.id == s.id
    out["resolve_site_by_name"] = {**_ms(lat), "correct": ok, "of": len(lat), "ambiguous_or_missed": len(lat) - ok}

    # ---- link and store the true extractions
    linker = Linker(inventory, min_confidence=0.0)
    facts = [json.loads(line) for line in open(root / "ground_truth" / "facts.jsonl", encoding="utf-8")]
    facts = facts[:max_facts] if max_facts else facts
    link_t, class_t, add_t = [], [], []
    stats = {"facts": len(facts), "linked": 0, "abstained": 0, "scope_correct": 0, "class_reach_exact": 0, "class_facts": 0, "over_bound": 0}
    for f in facts:
        item = ExtractedItem.model_validate(f["item"])
        when = datetime.fromisoformat(f["valid_from"])
        # A stand-in thread: the real one names these ids (the linker binds only ids named in the thread).
        named = " ".join([*item.scope.instance_ids, *item.scope.site_ids])
        thread = Thread(id=f["sources"][0]["thread_id"], source="slack", messages=[Message(thread_id="x", source="slack", seq=s, author=item.stated_by, sent_at=when, text=named) for s in item.cited_seq or [1]])
        t = time.perf_counter()
        res = linker.link(item, thread)
        link_t.append(time.perf_counter() - t)
        if res.assertion is None:
            stats["abstained"] += 1
            continue
        stats["linked"] += 1
        reach = f["reach"]
        want = {f["class_id"]} if reach["kind"] == "class" else set(reach["entity_ids"])
        got = res.assertion.applies_to
        stats["scope_correct"] += got == want
        stats["over_bound"] += bool(got - want)
        if reach["kind"] == "class":
            stats["class_facts"] += 1
            cls = res.classes[0]
            members = sum(1 for e in inventory.elements.values() if cls.criteria.matches(e))
            stats["class_reach_exact"] += members == reach["count"]
        for c in res.classes:
            t = time.perf_counter()
            store.add_class(c)
            class_t.append(time.perf_counter() - t)
        t = time.perf_counter()
        store.add_assertion(res.assertion)
        add_t.append(time.perf_counter() - t)
    out["link"] = {**stats, **_ms(link_t)}
    out["add_class"] = _ms(class_t)
    out["add_assertion"] = _ms(add_t)
    out["assertions_stored"] = len(store.assertions)
    log(f"linked {stats['linked']}/{stats['facts']} facts, scope correct {stats['scope_correct']}, over-bound {stats['over_bound']}")

    if on_store:  # e.g. save the linked store to Atlas (ctx dataset bench --save-mongo)
        on_store(store)

    # ---- lookup: what do humans know about this element?
    now = datetime(2026, 11, 7)
    sample = rng.sample(list(inventory.elements), min(queries, len(inventory.elements)))
    lat, with_context = [], 0
    for eid in sample:
        t = time.perf_counter()
        hits = store.get_context(eid, at=now)
        lat.append(time.perf_counter() - t)
        with_context += bool(hits)
    out["get_context"] = {**_ms(lat), "elements_with_context": with_context}
    return out
