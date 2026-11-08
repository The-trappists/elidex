"""Knowledge export formats and AI activity log compaction, offline (tmp files, no LLM)."""

import csv
import io
import json
import threading
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from context_layer import config, llm
from context_layer.models import Binding, ContextAssertion, SourceRef, Trust
from context_layer.dashboard import llm_compact
from context_layer.dashboard.app import create_app
from context_layer.dashboard.contracts import LlmCall

# ---------------------------------------------------------------- export


def make_app(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DASHBOARD_LLM_CALLS_FILE", tmp_path / "llm_calls.jsonl")
    monkeypatch.setattr(config, "DASHBOARD_LLM_CACHE_FILE", tmp_path / "llm_cache.json")
    return create_app(state_file=tmp_path / "state.json", background=False)


def add(wb, topic, summary, valid_to=None, avoid=()):
    el = next(iter(wb.elements))
    a = ContextAssertion(
        type="fact", topic=topic, summary=summary, bound_to=[Binding(entity=el, role="applies_to")],
        valid_from=wb.now() - timedelta(days=1), valid_to=valid_to, trust=Trust(level="stated", stated_by="Anna"),
        sources=[SourceRef(source="slack", file="t1", seq=[1, 2])], confidence=0.8, avoid=list(avoid),
    )
    return wb.store.add_assertion(a)[0]


def test_export_formats(tmp_path, monkeypatch):
    with TestClient(make_app(tmp_path, monkeypatch)) as c:
        wb = c.app.state.wb
        a1 = add(wb, "reboot", '=HYPERLINK("x") , "quoted"\nline', avoid=["a", "b"])
        a2 = add(wb, "old", "closed one", valid_to=wb.now() - timedelta(hours=1))
        fmts = {f["format"] for f in c.get("/api/knowledge/export/formats").json()}
        assert fmts == {"json", "markdown", "csv", "graphml", "jsonld"}
        assert c.get("/api/knowledge/export", params={"format": "xml"}).status_code == 422

        r = c.get("/api/knowledge/export", params={"format": "json"})
        assert r.headers["content-disposition"].startswith('attachment; filename="knowledge-')
        d = r.json()
        assert d["schema_version"] == 1 and d["valid_at"] and a1.id in {x["id"] for x in d["assertions"]} and a2.id not in {x["id"] for x in d["assertions"]}
        d_all = c.get("/api/knowledge/export", params={"format": "json", "valid_only": "false"}).json()
        assert {a1.id, a2.id} <= {x["id"] for x in d_all["assertions"]}
        at = (wb.now() - timedelta(hours=3)).isoformat()
        assert {a1.id, a2.id} <= {x["id"] for x in c.get("/api/knowledge/export", params={"format": "json", "at": at}).json()["assertions"]}

        r = c.get("/api/knowledge/export", params={"format": "csv", "valid_only": "false"})
        assert r.headers["content-disposition"].endswith('.csv"')
        rows = list(csv.reader(io.StringIO(r.text)))
        assert len(rows) >= 3 and rows[0][0] == "id"
        by = {row[0]: dict(zip(rows[0], row)) for row in rows[1:]}
        assert by[a1.id]["summary"].startswith("'=HYPERLINK")  # formula guard
        assert "\n" in by[a1.id]["summary"] and by[a1.id]["avoid"] == "a | b"

        md = c.get("/api/knowledge/export", params={"format": "markdown"}).text
        assert a1.id in md and "By element and class" in md

        ld = c.get("/api/knowledge/export", params={"format": "jsonld"}).json()
        assert "@context" in ld and any(n["@id"] == f"urn:ctx:assertion:{a1.id}" for n in ld["@graph"])

        r = c.get("/api/knowledge/export", params={"format": "graphml", "valid_only": "false"})
        assert r.headers["content-disposition"].endswith('.graphml"')
        ns = {"g": "http://graphml.graphdrawing.org/xmlns"}
        root = ET.fromstring(r.text)
        ids = {n.get("id") for n in root.findall(".//g:node", ns)}
        assert {a1.id, a2.id} <= ids or any(a1.id in i for i in ids)
        valid_ids = {n.get("id") for n in ET.fromstring(c.get("/api/knowledge/export", params={"format": "graphml"}).text).findall(".//g:node", ns)}
        assert not any(a2.id == i or a2.id in i for i in valid_ids)
        assert root.findall(".//g:edge", ns)


# ---------------------------------------------------------------- compaction

NOW = datetime(2026, 5, 4, 12, 0, 0)


def call(i, age_h, purpose="extract", thread="t1", model="m", user=None, error=None, parsed_ok=None):
    return LlmCall(
        id=f"llm_{i:012d}", ts=NOW - timedelta(hours=age_h), purpose=purpose, thread_id=thread, provider="primary",
        base_url="x", model=model, system="s", user=user or f"u{i}", error=error, parsed_ok=parsed_ok,
    )


def ids(cs):
    return {int(c.id[4:]) for c in cs}


def test_rules():
    calls = [
        call(1, 30, thread="t2"), call(2, 10, thread="t2"),  # same group: only the newest (2) stays
        call(3, 30, purpose="judge"),  # newest of its own group
        call(4, 1),  # recent
        call(5, 5, error="boom"),  # recent failure (24 h)
        call(6, 30, error="boom", thread="t1", purpose="agent"),  # old failure: group newest only
        call(7, 10, thread="gone", purpose="critic"),  # thread no longer exists
        call(8, 20, purpose="check", thread="t1", user="same"), call(9, 12, purpose="check", thread="t1", user="same", model="m2"),
    ]
    kept, removed = llm_compact.compact_calls(calls, NOW, {"t1", "t2"})
    assert ids(kept) == {2, 3, 4, 5, 6, 9}
    assert ids(removed) == {1, 7, 8}


def test_cap():
    calls = [call(i, 0.5 + i * 0.0001) for i in range(600)]
    kept, removed = llm_compact.compact_calls(calls, NOW, {"t1"})
    assert len(kept) == llm_compact.MAX_KEPT and len(removed) == 100


def write(path, calls):
    path.write_text("".join(c.model_dump_json() + "\n" for c in calls), encoding="utf-8")


def test_file_archive_atomic_idempotent(tmp_path):
    live, arch = tmp_path / "llm_calls.jsonl", tmp_path / "archive" / "llm_calls.jsonl"
    calls = [call(1, 30), call(2, 10), call(3, 1)]
    write(live, calls)
    with live.open("a") as f:
        f.write("not json\n")
    res = llm_compact.compact_file(live, arch, NOW, {"t1"})
    assert len(res.removed_ids) == 2 and res.moved == 3
    assert not live.with_name(live.name + ".tmp").exists()
    assert len(live.read_text().splitlines()) == 1
    assert len(arch.read_text().splitlines()) == 3
    res = llm_compact.compact_file(live, arch, NOW, {"t1"})  # nothing left to do
    assert res.moved == 0 and len(arch.read_text().splitlines()) == 3


def test_concurrent_appends_not_lost(tmp_path):
    live, arch = tmp_path / "llm_calls.jsonl", tmp_path / "archive" / "llm_calls.jsonl"
    write(live, [call(i, 40, thread=f"x{i}") for i in range(50)])
    sink = llm.jsonl_sink(live)
    stop = threading.Event()
    written = []

    def writer():
        n = 0
        while not stop.is_set() and n < 300:
            c = call(1000 + n, 0.1)
            sink(json.loads(c.model_dump_json()))
            written.append(c.id)
            n += 1

    t = threading.Thread(target=writer)
    t.start()
    for _ in range(5):
        llm_compact.compact_file(live, arch, NOW, {"t1"})
    t.join()
    live_ids = {json.loads(x)["id"] for x in live.read_text().splitlines()}
    assert set(written) <= live_ids


def test_routes_compact_and_summary(tmp_path, monkeypatch):
    live = tmp_path / "llm_calls.jsonl"
    calls = [call(1, 30, thread="gone"), call(2, 0.1, thread=None)]
    for c in calls:
        c.ts = datetime.now() - (NOW - c.ts)
    write(live, calls)
    with TestClient(make_app(tmp_path, monkeypatch)) as c:
        assert c.get("/api/llm/summary").json()["total_kept"] == 2
        s = c.post("/api/llm/compact").json()
        assert s["total_kept"] == 1 and s["archived_total"] == 1 and s["last_removed"] == 1 and s["last_compacted_at"]
        assert (tmp_path / "archive" / "llm_calls.jsonl").exists()
        assert len(c.get("/api/llm/calls").json()) == 1
        assert c.get("/export/llm-calls.jsonl").status_code in (200, 404)
