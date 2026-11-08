"""On-demand context of an element: threads, freshness and similar knowledge (offline: files on a tiny dataset, fakes for Atlas and Tiger)."""

import asyncio
import time
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from context_layer import config, mongo_store
from context_layer.dataset import source as ds_source
from context_layer.dataset import tiger
from context_layer.dashboard import sources
from context_layer.dashboard.app import create_app


def busiest_element(root):
    amap = ds_source.load_alias_map(root)
    counts: dict[str, int] = {}
    for t in ds_source.FileSource(root).threads():
        for e in ds_source.mentions(t, amap):
            counts[e] = counts.get(e, 0) + 1
    el = max(counts, key=counts.get)
    return el, counts[el]


@pytest.fixture
def env(tmp_path, monkeypatch, tiny_dataset):
    monkeypatch.setattr(config, "DASHBOARD_LLM_CALLS_FILE", tmp_path / "llm_calls.jsonl")
    monkeypatch.setattr(config, "DASHBOARD_LLM_CACHE_FILE", tmp_path / "llm_cache.json")
    monkeypatch.setattr(config, "DATASET_DIR", tiny_dataset)
    monkeypatch.setattr(config, "MONGODB_URI", "")
    monkeypatch.setattr(config, "TIGER_DATABASE_URL", "")
    monkeypatch.setattr(config, "EMBEDDING_MODEL", "")
    sources._SCANS.clear()
    app = create_app(state_file=tmp_path / "state.json", background=False)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def busy(tiny_dataset):
    return busiest_element(tiny_dataset)


# ---------------------------------------------------------------- files


def test_status_says_what_is_configured_without_network(env):
    s = env.get("/api/sources").json()
    assert s["files"]["configured"] and not s["atlas"]["configured"] and not s["tiger"]["configured"]


def test_threads_from_files_are_paginated_newest_first(env, busy):
    el, n = busy
    first = env.get(f"/api/sources/elements/{el}/threads", params={"limit": 2}).json()
    assert first["source"] == "files" and first["status"] == "ok" and first["total"] == n
    assert len(first["items"]) == min(2, n) and first["has_more"] == (n > 2)
    item = first["items"][0]
    assert item["preview"] and len(item["preview"]) <= 3 and item["authors"] and item["id"]
    dates = [i["started_at"] for i in first["items"]]
    assert dates == sorted(dates, reverse=True)
    if n > 2:
        second = env.get(f"/api/sources/elements/{el}/threads", params={"limit": 2, "offset": 2}).json()
        assert not {i["id"] for i in second["items"]} & {i["id"] for i in first["items"]}


def test_unknown_element_is_an_empty_ok_answer(env):
    r = env.get("/api/sources/elements/ZZZ-00000/threads").json()
    assert r["status"] == "ok" and r["total"] == 0 and r["items"] == []
    f = env.get("/api/sources/elements/ZZZ-00000/freshness").json()
    assert f["status"] == "ok" and f["messages"] == 0 and f["last_discussed"] is None and f["days_since"] is None


def test_freshness_from_files_has_the_tiger_shape(env, busy):
    el, _ = busy
    f = env.get(f"/api/sources/elements/{el}/freshness").json()
    assert f["source"] == "files" and f["status"] == "ok"
    assert f["messages"] >= 1 and f["active_days"] >= 1 and f["days_since"] is not None
    assert sum(m["messages"] for m in f["by_month"]) == f["messages"]
    assert set(f) >= {"element", "last_discussed", "days_since", "messages", "active_days", "by_month", "source", "status", "detail"}


def test_files_not_configured_is_a_clear_status_not_an_error(env, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATASET_DIR", tmp_path / "missing")
    monkeypatch.setattr(config, "OUT_DIR", tmp_path / "out")
    for path in ("threads", "freshness"):
        r = env.get(f"/api/sources/elements/TRN-042/{path}")
        assert r.status_code == 200 and r.json()["status"] == "not_configured" and "dataset" in r.json()["detail"].lower()


def test_files_scan_failure_becomes_an_error_status(env, monkeypatch, busy):
    def boom(*a):
        raise OSError("disk gone")

    monkeypatch.setattr(sources, "scan_files", boom)
    r = env.get(f"/api/sources/elements/{busy[0]}/threads")
    assert r.status_code == 200 and r.json()["status"] == "error" and "disk gone" in r.json()["detail"]


def test_slow_source_times_out_instead_of_blocking(env, monkeypatch, busy):
    monkeypatch.setattr(sources, "FILES_TIMEOUT_S", 0.2)
    monkeypatch.setattr(sources, "scan_files", lambda *a: time.sleep(1.5))
    t0 = time.time()
    r = env.get(f"/api/sources/elements/{busy[0]}/freshness").json()
    assert time.time() - t0 < 1.2 and r["status"] == "timeout"


# ---------------------------------------------------------------- Atlas and Tiger fakes


class FakeCursor(list):
    def sort(self, *_):
        return self

    def skip(self, n):
        return FakeCursor(self[n:])

    def limit(self, n):
        return FakeCursor(self[:n])


class FakeThreads:
    def __init__(self, docs):
        self.docs = docs

    def count_documents(self, q):
        return len(self.docs)

    def find(self, q, projection=None):
        return FakeCursor(self.docs)


def atlas_doc(i):
    msgs = [{"seq": 1, "author": "Aino", "role": "Architect", "sent_at": f"2026-03-0{i}T10:00:00", "text": f"about {i}"}]
    return {"_id": f"slack/atlas-{i}", "source": "slack", "subject": f"s{i}", "messages": msgs, "n_messages": 4}


def test_threads_from_atlas_when_configured(env, monkeypatch):
    monkeypatch.setattr(config, "MONGODB_URI", "mongodb://fake")
    monkeypatch.setattr(sources, "atlas_db", lambda: {"threads": FakeThreads([atlas_doc(1), atlas_doc(2), atlas_doc(3)])})
    r = env.get("/api/sources/elements/TRN-042/threads", params={"limit": 2}).json()
    assert r["source"] == "atlas" and r["status"] == "ok" and r["total"] == 3
    assert [i["id"] for i in r["items"]] == ["slack/atlas-1", "slack/atlas-2"] and r["has_more"] is True
    assert r["items"][0]["n_messages"] == 4


def test_atlas_failure_falls_back_to_files_and_says_why(env, monkeypatch, busy):
    monkeypatch.setattr(config, "MONGODB_URI", "mongodb://fake")

    def down():
        raise SystemExit("Atlas refused the connection")

    monkeypatch.setattr(sources, "atlas_db", down)
    r = env.get(f"/api/sources/elements/{busy[0]}/threads").json()
    assert r["source"] == "files" and r["status"] == "ok" and r["total"] == busy[1]
    assert r["fallback_from"]["source"] == "atlas" and "refused" in r["fallback_from"]["detail"]


def test_atlas_failure_without_files_reports_the_error(env, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "MONGODB_URI", "mongodb://fake")
    monkeypatch.setattr(config, "DATASET_DIR", tmp_path / "missing")
    monkeypatch.setattr(config, "OUT_DIR", tmp_path / "out")
    monkeypatch.setattr(sources, "atlas_db", lambda: (_ for _ in ()).throw(RuntimeError("no route to host")))
    r = env.get("/api/sources/elements/TRN-042/threads").json()
    assert r["status"] == "error" and r["source"] == "atlas" and "no route" in r["detail"]


class FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_freshness_from_tiger_when_configured(env, monkeypatch):
    monkeypatch.setattr(config, "TIGER_DATABASE_URL", "postgresql://fake")
    monkeypatch.setattr(sources, "tiger_conn", lambda: FakeConn())
    monkeypatch.setattr(tiger, "freshness", lambda conn, el: (datetime(2026, 9, 2), 14, 12))
    monkeypatch.setattr(tiger, "activity", lambda conn, el, bucket: [(datetime(2026, 8, 1), 6, 3), (datetime(2026, 9, 1), 8, 4)])
    f = env.get("/api/sources/elements/TRN-042/freshness").json()
    assert f["source"] == "tiger" and f["status"] == "ok"
    assert f["last_discussed"] == "2026-09-02" and f["messages"] == 14 and f["active_days"] == 12
    now = datetime.fromisoformat(env.get("/api/state").json()["clock"]["sim_now"])
    assert f["days_since"] == (now.date() - datetime(2026, 9, 2).date()).days  # counted from the sim now
    assert f["by_month"] == [{"month": "2026-08", "messages": 6, "people": 3}, {"month": "2026-09", "messages": 8, "people": 4}]


def test_tiger_failure_falls_back_to_files(env, monkeypatch, busy):
    monkeypatch.setattr(config, "TIGER_DATABASE_URL", "postgresql://fake")

    def down():
        raise ConnectionError("timeout expired")

    monkeypatch.setattr(sources, "tiger_conn", down)
    f = env.get(f"/api/sources/elements/{busy[0]}/freshness").json()
    assert f["source"] == "files" and f["status"] == "ok" and f["fallback_from"]["source"] == "tiger"


# ---------------------------------------------------------------- similar knowledge


def seed_knowledge(env):
    # the seed's TRN-042 chat is processed at start: wait for its assertions
    end = time.time() + 10
    while time.time() < end:
        if env.get("/api/state").json()["assertions"]:
            return
        time.sleep(0.05)
    raise AssertionError("no assertions")


def test_similar_falls_back_to_the_offline_ranking_of_the_dashboard(env):
    seed_knowledge(env)
    a = env.get("/api/state").json()["assertions"][0]
    r = env.get("/api/sources/similar", params={"q": a["summary"], "entity": "TRN-042"}).json()
    assert r["source"] == "dashboard" and r["status"] == "ok" and r["mode"].startswith("hash:") and "MONGODB_URI" in r["detail"]
    assert r["items"] and r["items"][0]["id"] == a["id"] and 0 < r["items"][0]["score"] <= 1.0001


def test_similar_from_atlas_when_configured(env, monkeypatch):
    monkeypatch.setattr(config, "MONGODB_URI", "mongodb://fake")
    monkeypatch.setattr(sources, "atlas_db", lambda: object())
    monkeypatch.setattr(mongo_store, "similar", lambda db, col, q, k: [{"_id": "ctx_0001", "topic": "t", "summary": "s", "score": 0.91234, "trust": {"level": "verified"}}])
    r = env.get("/api/sources/similar", params={"q": "port stays down"}).json()
    assert r["source"] == "atlas" and r["items"][0] == {"id": "ctx_0001", "topic": "t", "summary": "s", "score": 0.912, "trust": "verified"}


def test_similar_atlas_error_degrades_to_offline_with_a_reason(env, monkeypatch):
    monkeypatch.setattr(config, "MONGODB_URI", "mongodb://fake")
    monkeypatch.setattr(sources, "atlas_db", lambda: object())

    def not_embedded(*a):
        raise SystemExit("Nothing embedded in 'assertions' yet: run `ctx dataset embed`.")

    monkeypatch.setattr(mongo_store, "similar", not_embedded)
    r = env.get("/api/sources/similar", params={"q": "sfp"}).json()
    assert r["source"] == "dashboard" and r["status"] == "ok" and "Nothing embedded" in r["fallback_from"]["detail"]


def test_bounded_turns_system_exit_and_timeouts_into_source_unavailable():
    def exits():
        raise SystemExit("bad config")

    with pytest.raises(sources.SourceUnavailable, match="bad config"):
        asyncio.run(sources.bounded(exits, what="X"))
    with pytest.raises(sources.SourceUnavailable) as e:
        asyncio.run(sources.bounded(lambda: time.sleep(1), timeout=0.1, what="X"))
    assert e.value.status == "timeout"
