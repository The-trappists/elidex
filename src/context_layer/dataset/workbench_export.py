"""A connected sample of a company dataset, in the Workbench export format (docs/dataset.md, docs/workbench.md).

The Workbench keeps everything in memory and draws every node, so it cannot take the `large` dataset. This builds a
small, coherent slice that `POST /api/data/import` (or the Data page) can load:

- a connected sub-network grown from the Workbench seed (Elisa's TRN-042 and its hub), by walking the links;
- the people who write in the sampled threads, plus the seed personas;
- a mix of threads: knowledge, hard negatives, noise that names sub-network elements, other noise;
- the ground-truth facts of those threads, linked into assertions (so the Knowledge page is not empty);
- the hand-written seed scenarios and seed threads, untouched. Seed threads are listed in `process_on_import`, so the
  Workbench processes them on load exactly as it does at first start.

Same dataset, same options and same seed give the same JSON.
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from random import Random

from .. import config
from ..link import Inventory, Linker
from ..models import ExtractedItem, Message, NetworkElement, Site, Thread
from ..workbench import seed as wb_seed
from ..workbench.contracts import LiveThread, Persona, TopologyLink, WbElement, WbSite
from ..workbench.persistence import validate_refs
from .source import MENTION, load_alias_map, mentions

PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#84cc16", "#f97316"]
TEXT_LIMIT = 4000  # long vendor e-mails are cut: the Workbench draws and stores every character


def _jsonl(path: Path):
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def _sim_start() -> datetime:
    return datetime.fromisoformat(config.WORKBENCH_SIM_START)


# ---------------------------------------------------------------- network


def _read_network(root: Path, seed: wb_seed.SeedData):
    """Dataset sites, elements and links as Workbench objects. The seed objects win for the seed ids."""
    geo = {r["id"]: r for r in _jsonl(root / "network" / "sites.jsonl")}
    seed_sites = {s.id: s for s in seed.sites}
    sites: dict[str, WbSite] = {}
    with open(root / "network" / "sites.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            g = geo.get(r["id"], {})
            sites[r["id"]] = seed_sites.get(r["id"]) or WbSite(id=r["id"], name=r["name"], region=r["region"] or None, lat=g.get("lat"), lon=g.get("lon"))
    seed_els = {e.id: e for e in seed.elements}
    elements: dict[str, WbElement] = {}
    with open(root / "network" / "network_elements.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            elements[r["id"]] = seed_els.get(r["id"]) or WbElement(
                id=r["id"], type=r["type"], model=r["model"], install_year=int(r["install_year"]),
                firmware=r["firmware"] or None, site_id=r["site_id"] or None, aliases=[a for a in r["aliases"].split("|") if a],
            )
    seed_links = {link.id: link for link in seed.links}
    links = {}
    for r in _jsonl(root / "network" / "links.jsonl"):
        links[r["id"]] = seed_links.get(r["id"]) or TopologyLink(id=r["id"], a=r["a"], b=r["b"], kind=r["kind"])
    return sites, elements, links


def select_subnetwork(sites, elements, links, seed: wb_seed.SeedData, n_sites: int):
    """Grow a connected set of sites from the seed sites by walking the links (breadth first, sorted, deterministic).

    The seed always stays whole, even when `n_sites` is smaller than the seed. A seed site the dataset does not link
    to the rest is kept, but then the sample is not connected (the dataset guarantees one component)."""
    site_of = {e.id: e.site_id for e in elements.values()}
    adj: dict[str, set[str]] = defaultdict(set)
    for link in links.values():
        a, b = site_of.get(link.a), site_of.get(link.b)
        if a and b and a != b:
            adj[a].add(b)
            adj[b].add(a)
    start = sorted(s.id for s in seed.sites if s.id in sites)
    chosen: dict[str, None] = dict.fromkeys(start)
    queue = deque(start)
    while queue and len(chosen) < n_sites:
        for nxt in sorted(adj[queue.popleft()]):
            if nxt not in chosen and len(chosen) < n_sites:
                chosen[nxt] = None
                queue.append(nxt)
    keep_sites = {i: sites[i] for i in sorted(chosen)}
    keep_els = {i: e for i, e in sorted(elements.items()) if e.site_id in keep_sites or i in {s.id for s in seed.elements}}
    keep_links = {i: link for i, link in sorted(links.items()) if link.a in keep_els and link.b in keep_els}
    return keep_sites, keep_els, keep_links


def components(sites, elements, links) -> int:
    """Connected components of the site graph (a link joins the sites of its two elements). Inside a site every
    element hangs on the gateway, so the site level is what tells whether the sample is in one piece."""
    site_of = {e.id: e.site_id for e in elements.values()}
    parent = {i: i for i in sites}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for link in links.values():
        a, b = site_of.get(link.a), site_of.get(link.b)
        if a in parent and b in parent:
            parent[find(a)] = find(b)
    return len({find(i) for i in sites})


# ---------------------------------------------------------------- threads


def _reservoir(rng: Random, bucket: list, seen: int, item, k: int) -> None:
    if len(bucket) < k:
        bucket.append(item)
    else:
        j = rng.randrange(seen)
        if j < k:
            bucket[j] = item


def sample_threads(root: Path, element_ids: set[str], n_threads: int, seed: int) -> tuple[list[dict], dict[str, str]]:
    """One streaming pass over the shards. Returns the sampled raw threads (time order) and `{thread_id: kind}`.

    Mix (of `n_threads`): knowledge threads first (up to 30 %), 15 % hard negatives, 35 % noise that names a sub-network
    element (so the Human activity view has something to show), the rest noise that names nothing. A thread that names
    an element outside the sub-network is never taken. Threads after the Workbench sim start are left out (the
    simulated clock must not read the future)."""
    labels: dict[str, dict] = {}
    for p in sorted((root / "ground_truth").glob("labels-*.jsonl")):
        for r in _jsonl(p):
            labels[r["id"]] = r
    alias_map = load_alias_map(root)
    limit = _sim_start()
    rng = Random(f"{seed}-workbench-threads")
    quota = {"knowledge": int(n_threads * 0.30), "hard_negative": int(n_threads * 0.15), "mention": int(n_threads * 0.35)}
    quota["noise"] = n_threads
    buckets: dict[str, list] = {k: [] for k in quota}
    seen = dict.fromkeys(quota, 0)
    for shard in sorted((root / "conversations").glob("threads-*.jsonl")):
        for t in _jsonl(shard):
            if datetime.fromisoformat(t["messages"][0]["sent_at"]) > limit:
                continue
            named = set(mentions(t, alias_map))
            if named - element_ids:
                continue
            kind = labels.get(t["id"], {}).get("kind")
            cat = "knowledge" if kind == "knowledge" else "hard_negative" if kind == "hard_negative" else "mention" if named else "noise"
            seen[cat] += 1
            _reservoir(rng, buckets[cat], seen[cat], t, quota[cat])
    # plain noise fills what the other categories could not (it was sampled with the full size)
    rng.shuffle(buckets["noise"])
    taken = sum(len(buckets[c]) for c in ("knowledge", "hard_negative", "mention"))
    buckets["noise"] = buckets["noise"][: max(0, n_threads - taken)]
    picked = [t for c in ("knowledge", "hard_negative", "mention", "noise") for t in buckets[c]]
    kinds = {t["id"]: c for c in buckets for t in buckets[c]}
    picked.sort(key=lambda t: (t["messages"][0]["sent_at"], t["id"]))
    return picked, kinds


def _to_live(t: dict) -> LiveThread:
    msgs = [
        Message(thread_id=t["id"], source=t["source"], seq=m["seq"], author=m["author"], role=m.get("role"),
                sent_at=datetime.fromisoformat(m["sent_at"]), text=m["text"][:TEXT_LIMIT])
        for m in t["messages"]
    ]
    authors: list[str] = []
    for m in msgs:
        if m.author not in authors:
            authors.append(m.author)
    return LiveThread(
        id=t["id"], source=t["source"], subject=t.get("subject"), messages=msgs, participants=authors,
        origin="synthetic", status="idle", created_at=msgs[0].sent_at, last_message_at=msgs[-1].sent_at,
    )


# ---------------------------------------------------------------- people


def _color(key: str) -> str:
    return PALETTE[sum(map(ord, key)) % len(PALETTE)]


def build_personas(root: Path, seed: wb_seed.SeedData, authors: set[str]) -> list[Persona]:
    """The seed personas (as written) plus every dataset user who authored a sampled thread."""
    personas = {p.id: p for p in seed.personas}
    seed_names = {p.name for p in seed.personas}
    for u in _jsonl(root / "people" / "users.jsonl"):
        if u["id"] in personas or u["name"] in seed_names or u["name"] not in authors:
            continue
        personas[u["id"]] = Persona(
            id=u["id"], name=u["name"], role=u["role"], team=u.get("team"), avatar_color=_color(u["id"]),
            expertise=u.get("expertise", ""), style=u.get("style_note", ""), origin="synthetic",
        )
    return sorted(personas.values(), key=lambda p: (p.origin != "elisa", p.id))


# ---------------------------------------------------------------- ground truth


def link_facts(root: Path, elements: dict[str, WbElement], sites: dict[str, WbSite], thread_ids: set[str]) -> tuple[list[dict], list[dict]]:
    """Ground-truth facts whose source threads are all in the sample and whose instances are all in the sub-network,
    linked with the core Linker (the true extraction is the input, as in `ctx dataset bench`). Returns the
    assertions and classes as JSON dicts."""
    from ..store import ContextStore

    inv = Inventory([NetworkElement.model_validate(e.model_dump(exclude={"origin"})) for e in elements.values()], [Site.model_validate(x.model_dump(include={"id", "name", "region"})) for x in sites.values()])
    store = ContextStore(inv)
    linker = Linker(inv, min_confidence=0.0)
    fact_to_assertion: dict[str, str] = {}
    pending: list[tuple[str, dict]] = []
    for f in _jsonl(root / "ground_truth" / "facts.jsonl"):
        if not all(s["thread_id"] in thread_ids for s in f["sources"]):
            continue
        item = ExtractedItem.model_validate(f["item"])
        if not item.scope.instance_ids or any(i not in elements for i in item.scope.instance_ids):
            continue
        item.scope.site_ids = [s for s in item.scope.site_ids if s in sites]
        when = datetime.fromisoformat(f["valid_from"])
        thread = Thread(id=f["sources"][0]["thread_id"], source="slack", messages=[
            Message(thread_id="x", source="slack", seq=s, author=item.stated_by, sent_at=when, text="") for s in item.cited_seq or [1]
        ])
        res = linker.link(item, thread)
        if res.assertion is None:
            continue
        for c in res.classes:
            store.add_class(c)
        a, _ = store.add_assertion(res.assertion)
        fact_to_assertion[f["fact_id"]] = a.id
        pending.append((a.id, f))
    for aid, f in pending:
        a = store.assertions[aid]
        if f.get("valid_to"):
            a.valid_to = datetime.fromisoformat(f["valid_to"])
        a.closed_by = fact_to_assertion.get(f.get("closed_by") or "")
        a.conflicts_with = [fact_to_assertion[c] for c in f.get("conflicts_with", []) if c in fact_to_assertion]
    return (
        [a.model_dump(mode="json") for a in store.assertions.values()],
        [c.model_dump(mode="json") for c in store.classes.values()],
    )


# ---------------------------------------------------------------- the export


def export_workbench(root: Path, n_sites: int = 40, n_threads: int = 300, seed: int = 42) -> dict:
    """The Workbench export JSON (see `persistence.state_to_dict`) for a connected sample of the dataset at `root`."""
    if not (root / "network" / "sites.csv").exists():
        raise FileNotFoundError(f"No dataset at {root}. Run `ctx dataset generate --scale tiny` first.")
    seed_data = wb_seed.load_seed()
    sites, elements, links = _read_network(root, seed_data)
    sites, elements, links = select_subnetwork(sites, elements, links, seed_data, n_sites)
    problems = validate_refs(elements.values(), sites.values(), links.values())
    if problems:
        raise ValueError("; ".join(problems[:5]))

    picked, kinds = sample_threads(root, set(elements), n_threads, seed)
    threads = [_to_live(t) for t in picked]
    # seed threads (Elisa's chat and the other hand-written history): processed on import, as at first start
    start = _sim_start()
    seed_threads = [t for t in seed_data.threads if t.created_at <= start]
    authors = {m.author for t in threads for m in t.messages}
    personas = build_personas(root, seed_data, authors)
    assertions, classes = link_facts(root, elements, sites, {t.id for t in threads})

    def dump(items) -> list[dict]:
        return [i.model_dump(mode="json") for i in items]

    return {
        "version": 1,
        "saved_at": start.isoformat(),
        "clock": {"sim_now": start.isoformat(), "speed": 10},
        "settings": {},
        "elements": dump(elements.values()),
        "sites": dump(sites.values()),
        "links": dump(links.values()),
        "personas": dump(personas),
        "threads": dump(seed_threads) + dump(threads),
        "incidents": [],
        "scenarios": dump(seed_data.scenarios),
        "runs": [],
        "assertions": assertions,
        "classes": classes,
        "jobs": [], "flags": [], "edits": [], "applications": [],
        "process_on_import": [t.id for t in seed_threads],
        "sample": {
            "dataset": root.name, "seed": seed, "sites": len(sites), "elements": len(elements), "links": len(links),
            "threads": len(threads), "threads_by_kind": {k: sum(1 for v in kinds.values() if v == k) for k in ("knowledge", "hard_negative", "mention", "noise")},
            "personas": len(personas), "assertions": len(assertions), "connected_components": components(sites, elements, links),
        },
    }
