"""Orchestration: generate the whole company dataset and write it as CSV/JSONL under one folder.

Conversations are produced in time-ordered shards, one file each, in parallel (fork). A run is reproducible:
the same --seed and scale give the same files, whatever the number of workers.
"""

from __future__ import annotations

import csv
import json
import multiprocessing as mp
import os
import time
from datetime import datetime
from pathlib import Path
from random import Random

from .chatter import Chatter
from .knowledge import generate_knowledge
from .network import build_network
from .people import build_people
from .vocab import REGIONS
from .world import T0, T1, World, office_time

SCALES = {
    "tiny": dict(sites=60, staff=60, facts=40, threads=2_000),
    "demo": dict(sites=500, staff=600, facts=300, threads=150_000),  # ~150 MB, fits the Workbench-sized experiments
    "large": dict(sites=5_000, staff=3_000, facts=3_000, threads=3_000_000),  # ~3 GB, a mid-size operator
}
_STATE: dict = {}  # filled before the pool forks, so workers share the world without pickling it


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _write_jsonl(path: Path, rows) -> int:
    n = 0
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(dumps(row) + "\n")
            n += 1
    return n


def _run_shard(task: dict) -> dict:
    """Write one time slice of conversations (and the labels of its hard negatives and knowledge threads)."""
    rng = Random(f"{task['seed']}-shard-{task['shard']}")
    chatter: Chatter = _STATE["chatter"]
    lo, hi = task["lo"], task["hi"]
    starts = sorted(office_time(rng, lo, hi) for _ in range(task["n_noise"]))
    known = sorted(task["knowledge"], key=lambda t: t["messages"][0]["sent_at"])
    label_rows = [{"id": t["id"], "kind": "knowledge", "fact_ids": task["fact_of"].get(t["id"], [])} for t in known]
    n_threads = n_messages = size = 0
    by_source: dict[str, int] = {}
    shard = task["shard"]
    path = Path(task["out"]) / "conversations" / f"threads-{shard:04d}.jsonl"
    ki = 0
    with open(path, "w", encoding="utf-8") as f:
        def emit(thread: dict) -> None:
            nonlocal n_threads, n_messages, size
            line = dumps(thread) + "\n"
            f.write(line)
            size += len(line.encode("utf-8"))
            n_threads += 1
            n_messages += len(thread["messages"])
            by_source[thread["source"]] = by_source.get(thread["source"], 0) + 1

        for i, start in enumerate(starts):
            while ki < len(known) and known[ki]["messages"][0]["sent_at"] <= start.isoformat(timespec="seconds"):
                emit(known[ki])
                ki += 1
            thread, label = chatter.thread(rng, f"{{source}}/{start:%Y-%m}/s{shard:03d}-{i:07d}", start)
            emit(thread)
            if label:
                label_rows.append(label)
        for t in known[ki:]:
            emit(t)
    _write_jsonl(Path(task["out"]) / "ground_truth" / f"labels-{shard:04d}.jsonl", label_rows)
    return {"shard": shard, "threads": n_threads, "messages": n_messages, "bytes": size, "by_source": by_source}


def _plan_shards(knowledge_threads: list[dict], fact_of: dict, n_shards: int, n_noise_total: int, out: Path, seed: int) -> list[dict]:
    span = (T1 - T0) / n_shards
    bounds = [(T0 + span * i, T0 + span * (i + 1)) for i in range(n_shards)]
    tasks = [dict(shard=i, lo=lo, hi=hi, n_noise=n_noise_total // n_shards + (1 if i < n_noise_total % n_shards else 0),
                  knowledge=[], fact_of=fact_of, out=str(out), seed=seed) for i, (lo, hi) in enumerate(bounds)]
    for t in knowledge_threads:
        when = t["messages"][0]["sent_at"]
        index = min(n_shards - 1, max(0, int((datetime.fromisoformat(when) - T0) / span)))
        tasks[index]["knowledge"].append(t)
    return tasks


def generate(out: Path, scale: str = "demo", seed: int = 42, workers: int | None = None, overrides: dict | None = None, log=print) -> dict:
    from ..workbench.seed import load_seed

    started = time.time()
    spec = {**SCALES[scale], **(overrides or {})}
    workers = workers or min(8, os.cpu_count() or 1)
    for sub in ("network", "people", "conversations", "ground_truth"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    for old in list((out / "conversations").glob("threads-*.jsonl")) + list((out / "ground_truth").glob("labels-*.jsonl")):
        old.unlink()  # a smaller run must not leave shards of a bigger one behind

    anchors = load_seed()
    net = build_network(Random(f"{seed}-network"), spec["sites"], anchors)
    people = build_people(Random(f"{seed}-people"), spec["staff"], anchors)
    world = World(net, people)
    log(f"network: {len(net.sites)} sites, {len(net.elements)} elements, {len(net.links)} links · staff: {len(people.users)}")

    # ---- network and people files
    with open(out / "network" / "sites.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "name", "region"])
        w.writerows([s["id"], s["name"], s["region"]] for s in net.sites)
    with open(out / "network" / "network_elements.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "type", "model", "install_year", "firmware", "site_id", "aliases"])
        w.writerows([e["id"], e["type"], e["model"], e["install_year"], e["firmware"] or "", e["site_id"] or "", "|".join(e["aliases"])] for e in net.elements)
    _write_jsonl(out / "network" / "sites.jsonl", net.sites)
    _write_jsonl(out / "network" / "links.jsonl", net.links)
    _write_jsonl(out / "people" / "users.jsonl", people.users)
    teams: dict[str, dict] = {}
    for u in people.users:
        t = teams.setdefault(u["team"], {"members": 0, "regions": set()})
        t["members"] += 1
        t["regions"].add(u["region"])
    (out / "people" / "teams.json").write_text(json.dumps({k: {"members": v["members"], "regions": sorted(v["regions"])} for k, v in teams.items()}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ---- ground-truth knowledge
    bundle = generate_knowledge(Random(f"{seed}-knowledge"), world, spec["facts"])
    fact_of: dict[str, list[str]] = {}
    for fact in bundle.facts:
        for src in fact["sources"]:
            fact_of.setdefault(src["thread_id"], []).append(fact["fact_id"])
    bundle.facts.sort(key=lambda r: r["valid_from"])
    _write_jsonl(out / "ground_truth" / "facts.jsonl", bundle.facts)
    log(f"knowledge: {len(bundle.facts)} facts in {len(bundle.threads)} threads")

    # ---- conversations, in parallel time-ordered shards
    n_shards = max(workers * 3, 24) if spec["threads"] >= 100_000 else max(workers, 4)
    n_noise = max(0, spec["threads"] - len(bundle.threads))
    tasks = _plan_shards(bundle.threads, fact_of, n_shards, n_noise, out, seed)
    _STATE["chatter"] = Chatter(world)
    log(f"conversations: {spec['threads']:,} threads in {n_shards} shards, {workers} workers")
    if workers > 1 and "fork" in mp.get_all_start_methods():
        with mp.get_context("fork").Pool(workers) as pool:
            results = []
            for r in pool.imap_unordered(_run_shard, tasks):
                results.append(r)
                log(f"  shard {r['shard']:>3} done ({len(results)}/{n_shards}, {sum(x['bytes'] for x in results) / 1e6:,.0f} MB so far)")
    else:
        results = [_run_shard(t) for t in tasks]
    results.sort(key=lambda r: r["shard"])

    by_source: dict[str, int] = {}
    for r in results:
        for k, v in r["by_source"].items():
            by_source[k] = by_source.get(k, 0) + v
    manifest = {
        "scale": scale, "seed": seed, "spec": spec, "period": [T0.isoformat(), T1.isoformat()],
        "network": {"sites": len(net.sites), "elements": len(net.elements), "links": len(net.links),
                    "tiers": {t: sum(1 for s in net.sites if s["tier"] == t) for t in ("core", "regional", "aggregation", "access", "mast")},
                    "regions": len(REGIONS), "anchor_sites": len(anchors.sites), "anchor_elements": len(anchors.elements)},
        "people": {"users": len(people.users), "teams": len(teams)},
        "conversations": {"threads": sum(r["threads"] for r in results), "messages": sum(r["messages"] for r in results),
                          "shards": n_shards, "by_source": by_source, "bytes": sum(r["bytes"] for r in results)},
        "ground_truth": {"facts": len(bundle.facts), "knowledge_threads": len(bundle.threads)},
        "generated_seconds": round(time.time() - started, 1),
    }
    manifest["total_bytes"] = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "README.md").write_text(_readme(manifest), encoding="utf-8")
    log(f"done in {manifest['generated_seconds']} s · {manifest['total_bytes'] / 1e9:.2f} GB")
    return manifest


def _readme(m: dict) -> str:
    c, n = m["conversations"], m["network"]
    return f"""# Synthetic company dataset ({m['scale']}, seed {m['seed']})

Generated by `ctx dataset generate` (see docs/dataset.md). Everything is invented: no Elisa data except the
hand-written seed of the Workbench, which is kept inside the generated network.

- Network: {n['sites']:,} sites, {n['elements']:,} elements, {n['links']:,} links ({n['tiers']})
- People: {m['people']['users']:,} users in {m['people']['teams']} teams
- Conversations: {c['threads']:,} threads, {c['messages']:,} messages ({c['by_source']}), {c['bytes'] / 1e6:,.0f} MB
- Ground truth: {m['ground_truth']['facts']:,} facts in {m['ground_truth']['knowledge_threads']:,} knowledge threads; the other threads carry no durable knowledge
- Period: {m['period'][0][:10]} to {m['period'][1][:10]}; total {m['total_bytes'] / 1e9:.2f} GB
"""
