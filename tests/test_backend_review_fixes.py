"""Fixes from docs/backend-review.md, steps 1-3 and the parse repair (probes L1-L4, R1, S1, O1, O2, U1). Offline."""

from datetime import datetime, timedelta

import pytest

from context_layer import llm, outcome
from context_layer.link import Inventory, Linker
from context_layer.models import (
    ClassCriteria, ExtractedItem, Message, Outcome, Scope, Thread, Trust,
)
from context_layer.mvp.lifecycle import reconcile
from context_layer.store import ContextStore
from context_layer.dashboard.seed import load_seed
from test_dashboard_core import client, seeded  # noqa: F401 - pytest fixture

SEED = load_seed()
INV = Inventory(SEED.elements, SEED.sites)
T0 = datetime(2026, 10, 15, 9, 0)


def thread(texts, authors=("Erkki Expert",), tid="t", t0=T0) -> Thread:
    msgs = [
        Message(thread_id=tid, source="teams", seq=i, author=authors[(i - 1) % len(authors)], role="Network Expert",
                sent_at=t0 + timedelta(minutes=i), text=text)
        for i, text in enumerate(texts, 1)
    ]
    return Thread(id=tid, source="teams", messages=msgs)


def item(**kw) -> ExtractedItem:
    base = dict(type="workaround", topic="t", summary="s", scope=Scope(), trust_level="stated",
                stated_by="Erkki Expert", cited_seq=[1], confidence=0.9, action="bounce the interface")
    return ExtractedItem(**(base | kw))


TH = thread(["On TRN-117 bounce the interface after the SFP swap."])


def bound(res) -> dict[str, str]:
    return {b.entity: b.role for b in res.assertion.bound_to} if res.assertion else {}


# ---------------------------------------------------------------- linker guards (finding 1)


def test_class_that_leaves_out_the_cited_unit_is_dropped_and_the_unit_kept():
    # TRN-117 is from 2018: "transmission nodes from 2020" cannot be the scope of advice given for it.
    res = Linker(INV).link(item(scope=Scope(instance_ids=["TRN-117"], element_class=ClassCriteria(
        type="transmission_node", install_year_min=2020))), TH)
    assert bound(res) == {"TRN-117": "applies_to"} and res.classes == []
    assert any("does not contain TRN-117" in n for n in res.notes)


def test_class_needs_a_type_or_a_model():
    res = Linker(INV).link(item(scope=Scope(instance_ids=["TRN-117"], element_class=ClassCriteria(
        install_year_min=2018, install_year_max=2018))), TH)
    assert res.classes == [] and bound(res) == {"TRN-117": "applies_to"}
    assert any("no element type or model" in n for n in res.notes)


def test_type_is_normalised_and_a_model_alone_gets_its_type():
    linker = Linker(INV)
    spaced = linker.link(item(scope=Scope(element_class=ClassCriteria(type="Transmission Nodes", model="TX-3000"))), TH)
    model_only = linker.link(item(scope=Scope(element_class=ClassCriteria(model="tx-3000"))), TH)
    assert [c.id for c in spaced.classes] == [c.id for c in model_only.classes] == ["class:transmission_node:tx-3000"]
    unknown = linker.link(item(scope=Scope(instance_ids=["TRN-117"], element_class=ClassCriteria(type="toaster", model="TX-3000"))), TH)
    assert unknown.classes == [] and any("not an element type" in n for n in unknown.notes)


def test_ids_the_thread_never_names_are_not_bound():
    res = Linker(INV).link(item(scope=Scope(instance_ids=["TRN-042", "TRN-131"])), TH)
    assert res.assertion is None
    assert any("TRN-042 is not named" in n for n in res.notes) and any("nothing to bind" in n for n in res.notes)
    # spelled differently in the text still counts
    res = Linker(INV).link(item(scope=Scope(instance_ids=["TRN-117"])), thread(["trn 117 bounce it"]))
    assert bound(res) == {"TRN-117": "applies_to"}


def test_site_named_by_short_id_or_name_word():
    site = next(s for s in INV.sites.values() if s.id == "SITE-NF-021")
    for text in ("ok that's NF-021", f"the {site.name.split()[0]} mast road is flooded"):
        res = Linker(INV).link(item(type="access", scope=Scope(site_ids=["SITE-NF-021"])), thread([text]))
        assert bound(res) == {"SITE-NF-021": "applies_to"}, text
    res = Linker(INV).link(item(type="access", scope=Scope(site_ids=["SITE-NF-021"])), thread(["the road is flooded"]))
    assert res.assertion is None


def test_author_must_have_written_in_the_thread():
    linker = Linker(INV)
    two = thread(["TRN-117: bounce it", "agreed"], authors=("Erkki Expert", "Veikko Field"))
    assert linker.link(item(stated_by="erkki", scope=Scope(instance_ids=["TRN-117"])), two).assertion.trust.stated_by == "Erkki Expert"
    res = linker.link(item(stated_by="Matti Somebody", scope=Scope(instance_ids=["TRN-117"])), two)
    assert res.assertion.trust.stated_by == "Erkki Expert" and any("did not write in the thread" in n for n in res.notes)
    quoted = linker.link(item(stated_by="Matti", cited_seq=[1, 2], evidence_quote="Agreed", scope=Scope(instance_ids=["TRN-117"])), two)
    assert quoted.assertion.trust.stated_by == "Veikko Field"
    nobody = linker.link(item(stated_by="Matti", cited_seq=[1, 2], scope=Scope(instance_ids=["TRN-117"])), two)
    assert nobody.assertion is None and "abstained" in nobody.notes[-1]


# ---------------------------------------------------------------- reach and lifecycle (finding 2)


def _store_with(*pairs):
    store, linker, out = ContextStore(INV), Linker(INV), []
    for it, th in pairs:
        res = linker.link(it, th)
        for c in res.classes:
            store.add_class(c)
        out.append(store.add_assertion(res.assertion)[0])
    return store, out


def test_reach_is_by_scope_not_where_it_was_seen():
    store, (a,) = _store_with((item(scope=Scope(instance_ids=["TRN-117"], site_ids=["SITE-OUL-011"])),
                               thread(["TRN-117 at SITE-OUL-011: bounce it"])))
    assert store.reach(a) == {"TRN-117"}  # the site is only where it was seen
    store, (b,) = _store_with((item(type="access", scope=Scope(site_ids=["SITE-OUL-011"])), thread(["SITE-OUL-011 key"])))
    assert "SITE-OUL-011" in store.reach(b) and {e.id for e in INV.elements.values() if e.site_id == "SITE-OUL-011"} <= store.reach(b)


def test_invalidation_closes_a_rule_it_covers_under_another_class_id():
    old_th, new_th = thread(["old TX-3000: bounce"], tid="a"), thread(["firmware 4.2 fixes it"], tid="b", t0=T0 + timedelta(days=10))
    store, (rule, inv) = _store_with(
        (item(topic="sfp", scope=Scope(element_class=ClassCriteria(type="transmission_node", model="TX-3000", install_year_max=2018))), old_th),
        (item(type="invalidation", topic="sfp", action=None, scope=Scope(element_class=ClassCriteria(type="transmission_node", install_year_max=2019))), new_th),
    )
    assert not (rule.applies_to & inv.applies_to)  # different class ids
    reconcile(store, inv)
    assert rule.valid_to == inv.valid_from and rule.closed_by == inv.id


def test_invalidation_covering_part_of_a_rule_keeps_it_open():
    old_th = thread(["TRN-117 and TRN-131: bounce"], tid="a")
    new_th = thread(["TRN-117 is on 4.2 now, fixed"], tid="b", t0=T0 + timedelta(days=10))
    store, (rule, inv) = _store_with(
        (item(topic="sfp", scope=Scope(instance_ids=["TRN-117", "TRN-131"])), old_th),
        (item(type="invalidation", topic="sfp", action=None, scope=Scope(instance_ids=["TRN-117"])), new_th),
    )
    events = reconcile(store, inv)
    assert rule.valid_to is None and any("kept open" in e and "TRN-131" in e for e in events)


# ---------------------------------------------------------------- facts, trust, outcome (findings 4, 5, 6)


def test_two_different_facts_from_two_people_stay_apart_and_conflict():
    th = thread(["TRN-117 hums: the floor scrubber", "TRN-117 hums: a chassis fan"], authors=("Pirjo", "Helmi"))
    store, (a, b) = _store_with(
        (item(type="fact", topic="hum", action=None, fact="the floor scrubber", stated_by="Pirjo", scope=Scope(instance_ids=["TRN-117"])), th),
        (item(type="fact", topic="hum", action=None, fact="a chassis fan", stated_by="Helmi", cited_seq=[2], scope=Scope(instance_ids=["TRN-117"])), th),
    )
    assert a.id != b.id and len(store.assertions) == 2
    reconcile(store, b)
    assert a.conflicts_with == [b.id]


def test_same_fact_from_two_people_merges_and_keeps_both_names():
    th = thread(["TRN-117 counters wrap at 32 bit", "yes, TRN-117 counters wrap at 32 bit"], authors=("Vilma", "Timo"))
    store, (a, b) = _store_with(
        (item(type="fact", topic="wrap", action=None, fact="Counters wrap at 32 bit", stated_by="Vilma", scope=Scope(instance_ids=["TRN-117"])), th),
        (item(type="fact", topic="wrap", action=None, fact="counters wrap at 32 bit", stated_by="Timo", cited_seq=[2], scope=Scope(instance_ids=["TRN-117"])), th),
    )
    assert a is b and a.trust.stated_by == "Vilma" and a.trust.confirmed_by == ["Timo"]


def test_add_confirmation_keeps_the_author_and_only_raises_the_level():
    t = Trust(level="stated", stated_by="Erkki", evidence="said so")
    t.add_confirmation(Trust(level="hunch", stated_by="Erkki"))
    t.add_confirmation(Trust(level="verified", stated_by="Veikko", evidence="traffic is back", confirmed_by=["Aino"]))
    t.add_confirmation(Trust(level="stated", stated_by="Veikko"))
    assert (t.stated_by, t.level, t.evidence, t.confirmed_by) == ("Erkki", "verified", "traffic is back", ["Veikko", "Aino"])


def test_field_confirmation_keeps_the_author_so_a_later_disagreement_is_flagged():
    class _Wb:
        def add_flag(self, *a, **k):
            pass

    th = thread(["TRN-117: bounce it", "TRN-117: no, reseat the SFP"], authors=("Erkki Expert", "Veikko Field"))
    store, (rule,) = _store_with((item(topic="sfp", scope=Scope(instance_ids=["TRN-117"])), th))
    o = Outcome(entity="TRN-117", at=T0, worked=True, evidence="", source="thread", quote="traffic is back")
    rule.outcomes.append(o)
    outcome.settle(_Wb(), rule, o, thread_id="x", job_id="j", author="Veikko Field")
    assert rule.trust.stated_by == "Erkki Expert" and rule.trust.level == "verified"
    assert rule.trust.confirmed_by == ["Veikko Field"] and rule.trust.evidence == "traffic is back"
    res = Linker(INV).link(item(topic="sfp", action="reseat the SFP", stated_by="Veikko Field", cited_seq=[2],
                                scope=Scope(instance_ids=["TRN-117"])), th)
    other, _ = store.add_assertion(res.assertion)
    reconcile(store, other)
    assert rule.conflicts_with == [other.id]


@pytest.mark.parametrize("text, want", [
    ("Link is UP but still no traffic", "failed"),
    ("I'll get back to you after lunch", None),
    ("not fixed yet", "failed"),
    ("nope, same as before", "failed"),
    ("Traffic is back, thanks!", "worked"),
    ("it's back online", "worked"),
    ("port 1 is back, still no traffic on port 2", None),
    ("interface is up", None),
])
def test_outcome_heuristic(text, want):
    msg = type("M", (), {"text": text})()
    got = outcome.heuristic([msg])
    assert (got[0] if got else None) == want


# ---------------------------------------------------------------- applications for cited rules only (finding 4)


def test_agent_run_applies_only_the_cited_rule(client):  # noqa: F811 - pytest fixture
    from context_layer.models import Binding, ContextAssertion, SourceRef

    outcome.install()  # hooks are global and other tests may have cleared them
    seeded(client)
    client.put("/api/settings", json={"use_outcome_loop": True})
    wb = client.app.state.wb
    noise = ContextAssertion(
        type="fact", topic="noise-fact", summary="TRN-042 has a sticker on the door", fact="sticker on the door",
        bound_to=[Binding(entity="TRN-042", role="applies_to")], valid_from=T0 - timedelta(days=400),
        trust=Trust(level="hunch", stated_by="Somebody"), sources=[SourceRef(source="teams", file="x")], confidence=0.5,
    )
    wb.store.add_assertion(noise)
    res = client.post("/api/agent/run", json={"entity_id": "TRN-042", "description": "No traffic"}).json()
    assert len(res["hits"]) >= 2 and res["cited_assertion_ids"]
    assert noise.id not in res["cited_assertion_ids"]  # retrieved, not relied on: a "fixed" reply must not verify it
    assert [a["assertion_id"] for a in res["applications"]] == res["cited_assertion_ids"]
    assert f"Applied {noise.id}" not in wb.threads[res["thread_id"]].messages[-1].text


# ---------------------------------------------------------------- parse repair (finding 7)


def _fake_llm(monkeypatch, answers, chain=("primary",)):
    calls = []

    def fake_call(p, system, user, **kw):
        calls.append((p.name, user))
        return answers[len(calls) - 1], {"id": f"llm_{len(calls)}", "provider": p.name, "error": None}, None

    monkeypatch.setattr(llm, "providers", lambda role="primary", model=None: [llm.Provider(n, "", "k", "m", "json_object") for n in chain])
    monkeypatch.setattr(llm, "call_provider", fake_call)
    return calls


def _validate(text):
    import json

    json.loads(text)


def test_invalid_json_is_repaired_on_the_same_provider(monkeypatch):
    calls = _fake_llm(monkeypatch, ["{not json", '{"items": []}'])
    text, traces = llm.complete_traced("s", "u", json_mode=True, validate=_validate)
    assert text == '{"items": []}' and len(traces) == 2
    assert calls[1][0] == "primary" and "could not be used" in calls[1][1]


def test_invalid_twice_moves_to_the_fallback(monkeypatch):
    calls = _fake_llm(monkeypatch, ["{bad", "{still bad", '{"ok": 1}'], chain=("primary", "fallback"))
    text, _ = llm.complete_traced("s", "u", json_mode=True, validate=_validate)
    assert text == '{"ok": 1}' and [c[0] for c in calls] == ["primary", "primary", "fallback"]


def test_invalid_everywhere_returns_the_last_answer(monkeypatch):
    _fake_llm(monkeypatch, ["{bad", "{still bad"])
    text, traces = llm.complete_traced("s", "u", json_mode=True, validate=_validate)
    assert text == "{still bad" and len(traces) == 2
