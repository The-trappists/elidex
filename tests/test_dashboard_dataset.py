"""`ctx dataset export-dashboard` and the Data page loader: a connected sample of the company dataset (offline)."""

import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from context_layer import cli, config
from context_layer.dataset import dashboard_export as wx
from context_layer.dashboard import persistence, seed
from context_layer.dashboard.app import create_app
from context_layer.dashboard.contracts import TopologyLink, WbElement, WbSite

SIM_START = datetime.fromisoformat(config.DASHBOARD_SIM_START)


@pytest.fixture(scope="module")
def sample(tiny_dataset):
    return wx.export_dashboard(tiny_dataset, n_sites=25, n_threads=120, seed=3)


def test_sample_is_one_connected_subnetwork_with_valid_references(sample):
    s = sample["sample"]
    assert s["connected_components"] == 1 and s["sites"] == 25
    els = [WbElement.model_validate(x) for x in sample["elements"]]
    sites = [WbSite.model_validate(x) for x in sample["sites"]]
    links = [TopologyLink.model_validate(x) for x in sample["links"]]
    assert persistence.validate_refs(els, sites, links) == []
    assert len(els) == s["elements"] and len(links) == s["links"]


def test_elisa_seed_is_kept_and_linked_to_the_rest(sample):
    els = {e["id"]: e for e in sample["elements"]}
    assert els["TRN-042"]["origin"] == "elisa"
    seed_data = seed.load_seed()
    assert {e.id for e in seed_data.elements} <= set(els)
    assert {s.id for s in seed_data.sites} <= {s["id"] for s in sample["sites"]}
    generated = {i for i in els if i not in {e.id for e in seed_data.elements}}
    assert generated
    hub_links = [x for x in sample["links"] if (x["a"] in generated) != (x["b"] in generated)]
    assert hub_links, "the seed must be linked to the generated network"
    assert {p.id for p in seed_data.personas} <= {p["id"] for p in sample["personas"]}
    assert {s.id for s in seed_data.scenarios} == {x["id"] for x in sample["scenarios"]}
    assert set(sample["process_on_import"]) <= {t["id"] for t in sample["threads"]}
    assert any(t.startswith("elisa/") for t in sample["process_on_import"])


def test_threads_are_a_mix_inside_the_subnetwork_and_before_the_sim_start(sample, tiny_dataset):
    from context_layer.dataset.source import load_alias_map, mentions

    ids = {e["id"] for e in sample["elements"]}
    amap = load_alias_map(tiny_dataset)
    seeded = set(sample["process_on_import"])
    sampled = [t for t in sample["threads"] if t["id"] not in seeded]
    kinds = sample["sample"]["threads_by_kind"]
    assert len(sampled) == sum(kinds.values()) <= 120
    assert kinds["knowledge"] and kinds["hard_negative"] and kinds["mention"] and kinds["noise"]
    for t in sampled:
        assert datetime.fromisoformat(t["messages"][0]["sent_at"]) <= SIM_START
        assert set(mentions({"messages": t["messages"]}, amap)) <= ids  # never names an element outside the sample
    authors = {m["author"] for t in sampled for m in t["messages"]}
    assert authors <= {p["name"] for p in sample["personas"]}


def test_true_facts_become_assertions_sourced_from_sampled_threads(sample):
    thread_ids = {t["id"] for t in sample["threads"]}
    assert sample["assertions"]
    for a in sample["assertions"]:
        assert a["sources"] and all(s["file"] in thread_ids for s in a["sources"])


def test_same_seed_same_file_other_seed_other_threads(tiny_dataset, sample):
    again = wx.export_dashboard(tiny_dataset, n_sites=25, n_threads=120, seed=3)
    assert json.dumps(again, sort_keys=True) == json.dumps(sample, sort_keys=True)
    other = wx.export_dashboard(tiny_dataset, n_sites=25, n_threads=120, seed=4)
    assert {t["id"] for t in other["threads"]} != {t["id"] for t in sample["threads"]}
    assert {e["id"] for e in other["elements"]} == {e["id"] for e in sample["elements"]}  # the network does not depend on the seed


def test_cli_writes_a_loadable_export(tiny_dataset, tmp_path, capsys):
    out = tmp_path / "s.json"
    cli.main(["dataset", "export-dashboard", str(tiny_dataset), "--sites", "15", "--threads", "40", "--out", str(out)])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["sample"]["threads"] <= 40 and data["version"] == 1
    assert "Written to" in capsys.readouterr().out


def test_cli_without_a_dataset_exits_with_a_hint(tmp_path):
    with pytest.raises(SystemExit) as e:
        cli.main(["dataset", "export-dashboard", str(tmp_path / "nothing")])
    assert "No dataset" in str(e.value)


# ---------------------------------------------------------------- HTTP


@pytest.fixture
def client(tmp_path, monkeypatch, tiny_dataset):
    monkeypatch.setattr(config, "DASHBOARD_LLM_CALLS_FILE", tmp_path / "llm_calls.jsonl")
    monkeypatch.setattr(config, "DASHBOARD_LLM_CACHE_FILE", tmp_path / "llm_cache.json")
    monkeypatch.setattr(config, "DATASET_DIR", tiny_dataset)
    app = create_app(state_file=tmp_path / "state.json", background=False)
    with TestClient(app) as c:
        c.put("/api/settings", json={"extractor_mode": "scripted"})
        yield c


def test_import_rejects_dangling_references_with_422(client, sample):
    bad = {**sample, "elements": [{**sample["elements"][0], "site_id": "SITE-NOPE"}, *sample["elements"][1:]]}
    r = client.post("/api/data/import", json=bad)
    assert r.status_code == 422 and "SITE-NOPE" in r.json()["detail"]
    bad = {**sample, "links": [*sample["links"], {"id": "LNK-X", "a": "TRN-042", "b": "NOPE-1", "kind": "fiber"}]}
    r = client.post("/api/data/import", json=bad)
    assert r.status_code == 422 and "NOPE-1" in r.json()["detail"]
    assert client.get("/api/state").status_code == 200  # the state was not touched


def test_import_of_the_sample_keeps_and_processes_the_seed_threads(client, sample):
    assert client.post("/api/data/import", json=sample).status_code == 204
    st = client.get("/api/state").json()
    assert len(st["elements"]) == sample["sample"]["elements"]
    seeded = {t["id"]: t for t in st["threads"] if t["id"].startswith("elisa/")}
    assert seeded and all(t["origin"] == "elisa" for t in seeded.values())


def test_load_dataset_replaces_the_state(client):
    r = client.post("/api/data/load-dataset", json={"sites": 20, "threads": 60, "seed": 1})
    assert r.status_code == 200
    body = r.json()
    assert body["sites"] == 20 and body["connected_components"] == 1 and body["threads"] <= 60
    st = client.get("/api/state").json()
    assert len(st["sites"]) == 20 and any(e["id"] == "TRN-042" for e in st["elements"])
    assert len(st["threads"]) >= body["threads"]


def test_load_dataset_validates_its_body(client):
    assert client.post("/api/data/load-dataset", json={"sites": 2}).status_code == 422
    assert client.post("/api/data/load-dataset", json={"threads": 100000}).status_code == 422


def test_load_dataset_refuses_a_dataset_too_big_for_a_button(client, monkeypatch):
    from context_layer.dashboard import routes

    monkeypatch.setattr(routes, "MAX_ONTHEFLY_THREADS", 10)
    r = client.post("/api/data/load-dataset", json={})
    assert r.status_code == 422 and "export-dashboard" in r.json()["detail"]
