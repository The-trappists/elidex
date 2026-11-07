"""The synthetic company dataset: reproducible, consistent, and usable by the core (tiny scale, offline)."""

import hashlib
import json

import networkx as nx
import pytest

from context_layer.dataset import bench
from context_layer.dataset.build import generate
from context_layer.link import Inventory
from context_layer.models import ExtractedItem


@pytest.fixture(scope="module")
def tiny(tmp_path_factory):
    root = tmp_path_factory.mktemp("ds") / "tiny"
    generate(root, "tiny", seed=5, workers=2, log=lambda *_: None)
    return root


def _jsonl(path):
    return [json.loads(line) for line in open(path, encoding="utf-8")]


def _threads(root):
    return [t for p in sorted((root / "conversations").glob("threads-*.jsonl")) for t in _jsonl(p)]


def test_network_is_one_connected_graph_and_loads_in_the_core(tiny):
    inv = Inventory.load(tiny / "network")
    links = _jsonl(tiny / "network" / "links.jsonl")
    g = nx.Graph()
    g.add_edges_from((link["a"], link["b"]) for link in links)
    assert nx.number_connected_components(g) == 1
    assert {"TRN-042", "RAD-221"} <= set(inv.elements)  # Elisa's seed lives inside the generated mesh
    assert all(link["a"] in inv.elements and link["b"] in inv.elements for link in links)
    assert all(e.site_id in inv.sites for e in inv.elements.values())


def test_every_fact_is_a_valid_extraction_and_points_at_real_threads(tiny):
    ids = {t["id"] for t in _threads(tiny)}
    facts = _jsonl(tiny / "ground_truth" / "facts.jsonl")
    assert facts
    for f in facts:
        ExtractedItem.model_validate(f["item"])
        assert all(s["thread_id"] in ids for s in f["sources"])
        if f["closed_by"]:
            assert f["valid_to"]


def test_threads_are_unique_and_in_time_order(tiny):
    threads = _threads(tiny)
    assert len({t["id"] for t in threads}) == len(threads)
    starts = [t["messages"][0]["sent_at"] for t in threads]
    assert starts == sorted(starts)


def test_same_seed_same_files_whatever_the_worker_count(tiny, tmp_path):
    other = tmp_path / "again"
    generate(other, "tiny", seed=5, workers=1, log=lambda *_: None)

    def digest(root):
        h = hashlib.sha256()
        for p in sorted(root.rglob("*")):
            if p.is_file() and p.name not in ("manifest.json", "README.md"):
                h.update(p.name.encode() + p.read_bytes())
        return h.hexdigest()

    assert digest(tiny) == digest(other)


def test_bench_links_the_true_extractions_with_the_right_scope(tiny):
    r = bench.bench(tiny, queries=20, log=lambda *_: None)
    assert r["link"]["linked"] == r["link"]["facts"]
    assert r["link"]["scope_correct"] == r["link"]["facts"]
    assert r["link"]["over_bound"] == 0
    assert r["link"]["class_reach_exact"] == r["link"]["class_facts"]
