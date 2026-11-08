"""Problem relevance, merge of a confirmed hunch, version-aware closure, and the scale evaluation (docs/evaluation.md
part 3). Offline."""

from datetime import datetime, timedelta

from context_layer.agent import Case, run_agent
from context_layer.link import Inventory, Linker
from context_layer.models import ClassCriteria, ExtractedItem, Message, Scope, Thread
from context_layer.mvp import relevance
from context_layer.mvp.lifecycle import fix_predates, reconcile
from context_layer.store import ContextStore
from context_layer.workbench.seed import load_seed
from test_workbench_core import client  # noqa: F401 - pytest fixture

SEED = load_seed()
INV = Inventory(SEED.elements, SEED.sites)
T0 = datetime(2026, 10, 15, 9, 0)


def thread(texts, authors=("Erkki Expert",), tid="t", t0=T0) -> Thread:
    msgs = [Message(thread_id=tid, source="teams", seq=i, author=authors[(i - 1) % len(authors)], sent_at=t0 + timedelta(minutes=i),
                    text=text) for i, text in enumerate(texts, 1)]
    return Thread(id=tid, source="teams", messages=msgs)


def item(**kw) -> ExtractedItem:
    base = dict(type="workaround", topic="t", summary="s", scope=Scope(), trust_level="stated", stated_by="Erkki Expert",
                cited_seq=[1], confidence=0.9)
    return ExtractedItem(**(base | kw))


def store_with(*pairs) -> ContextStore:
    store, linker = ContextStore(INV), Linker(INV)
    for it, th in pairs:
        res = linker.link(it, th)
        for c in res.classes:
            store.add_class(c)
        a, new = store.add_assertion(res.assertion)
        if new:
            reconcile(store, a)
    return store


OLD_TX3000 = Scope(instance_ids=["TRN-042"], element_class=ClassCriteria(type="transmission_node", model="TX-3000", install_year_max=2019),
                   trigger="sfp-replacement")
ERKKI = item(topic="sfp-swap-forwarding-state", scope=OLD_TX3000,
             summary="On older TX-3000 units, after an SFP swap with link UP, normal optics and zero counters, bounce the interface.",
             diagnosis="forwarding state is stuck after the module change", action="disable the interface, wait, enable it",
             avoid=["rebooting the node"])
POWER = item(topic="tx3000-ptp-after-power-cycle", scope=Scope(instance_ids=["TRN-042"], element_class=OLD_TX3000.element_class),
             summary="A clock sync alarm after a power cycle clears by itself in 15 minutes.", action="wait 15 minutes, do not reboot again")
TH_ERKKI = thread(["TRN-042: SFP swapped, traffic stuck. Bounce the interface."], tid="erkki")
TH_POWER = thread(["TRN-042 had a sync alarm after the power cycle, it clears in 15 minutes."], tid="power", t0=T0 + timedelta(hours=1))


# ---------------------------------------------------------------- concepts


def test_concepts_merge_synonyms_and_drop_scope_words():
    assert {"sfp", "swap", "port", "down"} <= relevance.concepts("New transceiver fitted on TRN-10234, the interface is still down.")
    assert "trn" not in relevance.concepts("TRN-10234") and not relevance.concepts("TRN-10234 HEL101-TRN2")
    assert "up" not in relevance.concepts("TX-3000 units installed up to 2018")  # scope, handled by the graph
    assert "cold" in relevance.concepts("outside temperature -25 C")
    assert "flap" in relevance.concepts("the link goes up and down") and "flap" in relevance.concepts("the link flaps")


def test_keep_ids_for_text_search():
    assert "trn10234" in relevance.terms("Port down on TRN-10234", keep_ids=True)


# ---------------------------------------------------------------- relevance in the agent


def test_relevance_tags_the_rule_of_the_problem_and_keeps_the_others():
    store = store_with((ERKKI, TH_ERKKI), (POWER, TH_POWER))
    case = Case(id="c", title="", entity_id="TRN-117", at=T0 + timedelta(days=1),
                description="Replaced the transceiver on TRN-117, link is up but no traffic passes.")
    plain = run_agent(store, case)
    rep = run_agent(store, case, use_relevance=True)
    assert len(plain.hits) == len(rep.hits) == 2  # nothing dropped
    assert [h.assertion.topic for h in rep.matching()] == ["sfp-swap-forwarding-state"]
    assert rep.hits[0].assertion.topic == "sfp-swap-forwarding-state"  # matches first
    other = next(h.assertion.id for h in rep.hits if h.assertion.topic != "sfp-swap-forwarding-state")
    assert rep.relevance[other].status == "other problem"
    assert "disable the interface" in rep.recommendation
    assert not plain.relevance and plain.matching() == plain.hits  # off by default


def test_problem_with_no_known_word_is_not_assessed_and_kept():
    store = store_with((ERKKI, TH_ERKKI))
    case = Case(id="c", title="", entity_id="TRN-117", at=T0 + timedelta(days=1), description="Kiitos, moi!")
    rep = run_agent(store, case, use_relevance=True)
    assert rep.relevance[rep.hits[0].assertion.id].status == "not assessed"
    assert rep.matching() == rep.hits


def test_site_name_of_the_case_does_not_dilute_the_match():
    access = item(type="access", topic="barrier-key", scope=Scope(site_ids=["SITE-NF-017"]), summary="The barrier key is at the service station.",
                  action="pick up the key at the service station")
    store = store_with((access, thread(["For SITE-NF-017 the barrier key is at the service station."], tid="key")))
    case = Case(id="c", title="", entity_id="RAD-221", at=T0 + timedelta(days=1), description="Engineer dispatched to Kemijärvi hill mast: access?")
    rep = run_agent(store, case, use_relevance=True)
    assert rep.relevance[rep.hits[0].assertion.id].status == "matches the problem"


def test_an_invalidation_is_about_the_problem_of_the_rule_it_closed():
    bug = item(type="fact", topic="memory-leak", scope=Scope(element_class=ClassCriteria(type="transmission_node", model="TX-3000")),
               fact="firmware 3.8 leaks memory: the node gets sluggish after 60 days", summary="Firmware 3.8 leaks memory.")
    bug.scope.element_class.install_year_max = 2019
    fix = bug.model_copy(update={"type": "invalidation", "fact": "3.9 fixes the leak", "summary": "3.9 fixes the leak."})
    store = store_with((bug, thread(["TX-3000: firmware 3.8 leaks memory."], tid="bug")),
                       (fix, thread(["TX-3000 release 3.9 fixes the leak."], tid="fix", t0=T0 + timedelta(days=30))))
    closed = next(a for a in store.assertions.values() if a.type == "fact")
    assert closed.valid_to is not None
    inv = next(a for a in store.assertions.values() if a.type == "invalidation")
    rep = relevance.index_for(store).assess(inv, "TRN-117 is very sluggish, memory almost full")
    assert rep.status == "matches the problem"


# ---------------------------------------------------------------- merge of a confirmed hunch


def test_confirmation_without_the_site_merges_into_the_hunch():
    scope = Scope(instance_ids=["RAD-176"], site_ids=["SITE-ROV-008"])
    hunch = item(topic="frost-dip", scope=scope, trust_level="hunch", stated_by="Veikko", action="wait, it recovers by noon", confidence=0.5)
    sure = item(topic="frost-dip", scope=scope, trust_level="verified", stated_by="Erkki Expert", action="wait, it recovers by noon")
    store = store_with((hunch, thread(["RAD-176 at SITE-ROV-008 dips on frosty mornings, my guess."], authors=("Veikko",), tid="h")),
                       (sure, thread(["Confirmed for RAD-176: wait, it recovers by noon."], tid="v", t0=T0 + timedelta(days=5))))
    assert len(store.assertions) == 1
    a = next(iter(store.assertions.values()))
    assert a.trust.level == "verified" and a.trust.stated_by == "Veikko" and "Erkki Expert" in a.trust.confirmed_by
    assert ("SITE-ROV-008", "observed_on") in {(b.entity, b.role) for b in a.bound_to} and len(a.sources) == 2


def test_other_people_with_other_advice_on_the_same_scope_stay_apart():
    scope = Scope(instance_ids=["TRN-088"])
    a1 = item(topic="stuck-link", scope=scope, stated_by="Erkki Expert", action="reseat the module")
    a2 = item(topic="stuck-link", scope=scope, stated_by="Veikko", action="never reseat, bounce the port")
    th = thread(["TRN-088: reseat the module", "TRN-088: never reseat, bounce the port"], authors=("Erkki Expert", "Veikko"))
    store = store_with((a1, th), (a2, th))
    assert len(store.assertions) == 2 and all(a.conflicts_with for a in store.assertions.values())


# ---------------------------------------------------------------- version-aware closure


def _fact(text, kind="fact"):
    from context_layer.models import ContextAssertion, Trust

    return ContextAssertion(type=kind, topic="leak", summary=text, fact=text, bound_to=[], valid_from=T0,
                            trust=Trust(level="stated", stated_by="x"), sources=[], confidence=0.8)


def test_a_release_closes_only_older_firmware():
    assert fix_predates(_fact("firmware 3.9 leaks memory"), _fact("3.9 fixes the memory leak", "invalidation"))
    assert not fix_predates(_fact("firmware 3.8 leaks memory"), _fact("3.9 fixes the memory leak", "invalidation"))
    assert not fix_predates(_fact("firmware 4.2 leaks memory"), _fact("release 4.10 fixes it", "invalidation"))  # numbers, not text
    assert not fix_predates(_fact("older units keep a stale forwarding state"), _fact("firmware 4.2 fixes it", "invalidation"))


# ---------------------------------------------------------------- scale evaluation (tiny dataset)


def test_scale_eval_runs_and_relevance_beats_plain_retrieval(tiny_dataset):
    from context_layer.eval.scale import render, run_scale_eval

    r = run_scale_eval(tiny_dataset, haystack_every=2, naive_cases=100, log=lambda *_: None)
    assert r["linking"]["reach_exact"] == 1.0 and r["linking"]["over_reach_facts"] == 0
    by = {x["pipeline"]: x for x in r["retrieval"]}
    graph = by["graph scope + time (today, plain)"]
    new = by["+ problem relevance, strict (new)"]
    safe = by["+ problem relevance, all rules when none matches (new, default)"]
    assert graph["solution_found"] == 1.0 and graph["noise_wrong_scope"] == 0 and graph["noise_stale"] == 0
    assert new["accuracy"] > graph["accuracy"] and new["precision"] > graph["precision"]
    assert safe["solution_found"] >= new["solution_found"] and safe["precision"] > graph["precision"]
    assert r["lifecycle"]["closed_by_older_release"] == 0
    assert "Retrieval accuracy at company scale" in render(r)


# ---------------------------------------------------------------- relevance on the agent surfaces


def test_workbench_agent_run_tags_the_problem_and_can_be_switched_off(client):  # noqa: F811 - pytest fixture
    from test_workbench_core import seeded

    seeded(client)
    body = {"entity_id": "TRN-042", "description": "Management port of TRN-042 is very slow after a power cycle."}
    res = client.post("/api/agent/run", json=body).json()
    assert all("problem_match" in h for h in res["hits"])
    statuses = [h["problem_match"] for h in res["hits"]]
    assert statuses[0] == "matches the problem"
    assert statuses == sorted(statuses, key=lambda s: s == "other problem")  # matching rules first
    client.put("/api/settings", json={"use_relevance": False})
    assert client.get("/api/settings").json()["use_relevance"] is False
    res = client.post("/api/agent/run", json=body).json()
    assert not any("problem_match" in h for h in res["hits"])


def test_mcp_get_context_takes_a_problem_and_observations(monkeypatch):
    from context_layer import mcp_server

    store = store_with((ERKKI, TH_ERKKI), (POWER, TH_POWER))
    monkeypatch.setattr(mcp_server, "_store", lambda: store)
    at = (T0 + timedelta(days=1)).isoformat()
    plain = mcp_server.get_context("TRN-117", at=at)
    assert len(plain) == 2 and "problem_match" not in plain[0]
    tagged = mcp_server.get_context("TRN-117", at=at, problem="New transceiver fitted, link up, no traffic",
                                    observations={"sfp_replaced": True})
    assert tagged[0]["topic"] == "sfp-swap-forwarding-state" and tagged[0]["problem_match"] == "matches the problem"
    assert tagged[1]["problem_match"] == "other problem" and "track_record" in tagged[0] and "check_status" in tagged[0]


def test_rest_context_takes_a_problem(monkeypatch):
    from fastapi.testclient import TestClient

    from context_layer import api

    store = store_with((ERKKI, TH_ERKKI), (POWER, TH_POWER))
    monkeypatch.setattr(api, "get_store", lambda: store)
    at = (T0 + timedelta(days=1)).isoformat()
    rows = TestClient(api.app).get("/context/TRN-117", params={"at": at, "problem": "sync alarm after the power cycle"}).json()
    assert rows[0]["topic"] == "tx3000-ptp-after-power-cycle" and rows[0]["problem_match"] == "matches the problem"
