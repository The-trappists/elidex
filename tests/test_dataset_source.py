"""Reading a dataset without loading it, and the documents/rows sent to MongoDB and Tiger Data (offline, no database)."""

import json
from datetime import datetime

import pytest

from context_layer.dataset import source
from context_layer.dataset.build import generate


@pytest.fixture(scope="module")
def tiny(tmp_path_factory):
    root = tmp_path_factory.mktemp("ds") / "tiny"
    generate(root, "tiny", seed=5, workers=2, log=lambda *_: None)
    return root


def _threads(root):
    return [json.loads(line) for p in sorted((root / "conversations").glob("threads-*.jsonl")) for line in open(p, encoding="utf-8")]


def test_mentions_resolve_ids_and_aliases_and_ignore_unknown_tokens(tiny):
    amap = source.load_alias_map(tiny)
    el = next(iter(amap.values()))
    alias = next(a for a, eid in amap.items() if eid == el and a != el)
    thread = {"messages": [{"text": f"check {alias} and {el}, not ZZZ-99999 or INC1234567"}]}
    assert source.mentions(thread, amap) == [el]


def test_message_rows_and_thread_doc_have_what_the_databases_need(tiny):
    amap = source.load_alias_map(tiny)
    thread = next(t for t in _threads(tiny) if source.mentions(t, amap))
    doc = source.thread_doc(thread, amap)
    assert doc["_id"] == thread["id"] and doc["n_messages"] == len(thread["messages"]) and doc["mentions"]
    rows = list(source.message_rows(thread, amap))
    assert len(rows) == len(thread["messages"]) and all(len(r) == 9 for r in rows)
    assert set().union(*(r[8] for r in rows)) == set(doc["mentions"])


def test_file_source_filters_by_element_and_period(tiny):
    src = source.FileSource(tiny)
    amap = source.load_alias_map(tiny)
    all_threads = _threads(tiny)
    el = next(e for t in all_threads for e in source.mentions(t, amap))
    got = list(src.threads(element=el))
    assert got and all(el in source.mentions(t, amap) for t in got)
    assert len(got) == sum(el in source.mentions(t, amap) for t in all_threads)
    cut = datetime.fromisoformat(all_threads[len(all_threads) // 2]["messages"][0]["sent_at"])
    assert len(list(src.threads(until=cut))) + len(list(src.threads(since=cut))) == len(all_threads)
    assert len(list(src.threads(limit=3))) == 3
