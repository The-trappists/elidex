"""Knowledge graph over the store: structure, provenance, time, reach, experts, exports. Offline."""

import json
from datetime import datetime

import pytest

from context_layer.graph import KnowledgeGraph, schema as S, to_cypher, to_cytoscape, to_node_link
from context_layer.pipeline import build_store

BEFORE_FIX = datetime(2026, 10, 20, 8, 0)
AFTER_FIX = datetime(2026, 11, 5, 10, 0)
CLASS_ID = "class:transmission_node:installed-upto-2019"


@pytest.fixture(scope="module")
def kg():
    return KnowledgeGraph.build(build_store(lifecycle=True)[0])


def _rule_id(kg):
    return next(n for n, d in kg.g.nodes(data=True)
                if d["kind"] == S.ASSERTION and d["type"] == "workaround" and d["topic"] == "sfp-swap-forwarding-state")


def test_every_node_and_edge_is_typed(kg):
    assert all(d["kind"] in S.NODE_KINDS for _, d in kg.g.nodes(data=True))
    assert all(d["type"] == k for _, _, k, d in kg.g.edges(keys=True, data=True))


def test_network_layer(kg):
    assert kg.g.has_edge("TRN-042", "SITE-TKU-004", key=S.LOCATED_AT)
    members = {u for u, _, k in kg.g.in_edges(CLASS_ID, keys=True) if k == S.MEMBER_OF}
    assert members == {"TRN-042", "TRN-117"}  # TRN-208 (2020) and TRN-305 (2024) are not old units


def test_rule_bindings_become_typed_edges(kg):
    rid = _rule_id(kg)
    assert kg.g.has_edge(rid, CLASS_ID, key=S.APPLIES_TO)
    assert kg.g.has_edge(rid, "TRN-042", key=S.OBSERVED_ON)
    assert kg.g.has_edge(rid, "event:sfp-replacement", key=S.TRIGGER)


def test_provenance_is_erkki_in_chat_and_email(kg):
    prov = kg.provenance(_rule_id(kg))
    assert {p["author"] for p in prov} == {"Erkki Expert"}
    assert {(p["file"], p["seq"]) for p in prov} >= {("elisa/teams_chat.json", 8), ("elisa/email.txt", 1)}
    assert any("Disable the interface" in p["text"] for p in prov)


def test_reach_stays_on_old_units(kg):
    reach = kg.reach(_rule_id(kg))["elements"]
    assert set(reach) == {"TRN-042", "TRN-117"}
    assert "TRN-305" not in reach


def test_site_fact_reaches_elements_at_the_site(kg):
    barrier = next(n for n, d in kg.g.nodes(data=True) if d["kind"] == S.ASSERTION and d["type"] == "access")
    assert kg.reach(barrier) == {"assertion": barrier, "elements": {"RAD-221": "site SITE-NF-017"},
                                 "sites": ["SITE-NF-017"]}


def test_timeline_shows_the_rule_closed_by_the_firmware_message(kg):
    rid = _rule_id(kg)
    before = {r["id"]: r for r in kg.timeline("TRN-117", at=BEFORE_FIX)}
    after = {r["id"]: r for r in kg.timeline("TRN-117", at=AFTER_FIX)}
    assert before[rid]["status"] == "valid"
    assert after[rid]["status"] == "closed"
    assert kg.g.has_edge(rid, after[rid]["closed_by"], key=S.CLOSED_BY)


def test_snapshot_drops_assertions_not_valid_then(kg):
    rid = _rule_id(kg)
    assert rid in kg.snapshot(BEFORE_FIX)
    assert rid not in kg.snapshot(AFTER_FIX)
    assert "TRN-042" in kg.snapshot(AFTER_FIX)  # the network layer stays


def test_experts_for_an_old_unit_put_the_verified_expert_first(kg):
    experts = kg.experts("TRN-117", at=BEFORE_FIX)
    assert experts[0]["person"] == "Erkki Expert"
    assert experts[0]["verified"] == 1
    assert kg.experts("TRN-305") == []


def test_mentions_are_episodic_links_from_raw_text(kg):
    rows = kg.mentions("TRN-042")
    assert {(r["file"], r["seq"]) for r in rows} == {("elisa/teams_chat.json", 1), ("elisa/email.txt", 1)}


def test_neighborhood(kg):
    sub = kg.neighborhood("TRN-117", depth=2)
    assert {"TRN-117", CLASS_ID, _rule_id(kg)} <= set(sub)


def test_where_it_was_seen_does_not_spread_to_the_site():
    """RAD-198's advice binds its site as 'observed_on': RAD-233 at the same site must not inherit it."""
    from context_layer.eval.kb import build_kb, load_spec

    kb = build_kb(load_spec())
    graph = KnowledgeGraph.build(kb.store, [r.thread for r in kb.runs])
    at = datetime(2026, 10, 20, 6, 0)
    graph_topics = {r["topic"] for r in graph.timeline("RAD-233", at)}
    store_topics = {h.assertion.topic for h in kb.store.get_context("RAD-233", at)}
    assert "cold-morning-link-flap" not in graph_topics
    assert graph_topics == store_topics
    assert "cold-morning-link-flap" in {r["topic"] for r in graph.timeline("RAD-198", at)}


def test_exports(kg):
    assert len(to_node_link(kg.g)["nodes"]) == kg.g.number_of_nodes()
    els = to_cytoscape(kg.g)
    json.dumps(els)  # serialisable
    assert sum(e["group"] == "edges" for e in els) == kg.g.number_of_edges()
    cypher = to_cypher(kg.g)
    assert "MERGE (n:Assertion" in cypher and "[r:APPLIES_TO]" in cypher
    assert "localdatetime(" in cypher
