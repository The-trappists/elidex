"""Patterns: recurring and linked problems from captured human reports, without flooding and without the future."""

from datetime import datetime, timedelta

import pytest

from context_layer.link import Inventory
from context_layer.models import (
    Binding,
    Check,
    Condition,
    ContextAssertion,
    NetworkElement,
    Site,
    SourceRef,
    Trust,
)
from context_layer.mvp.patterns import (
    classify_fix,
    find_patterns,
    render_markdown,
    replay_history,
)
from context_layer.store import ContextStore

T0 = datetime(2026, 10, 6, 21, 0)
AT = datetime(2026, 11, 7, 12, 0)

# A and K look unrelated (other sites, other models), but both hang off C. D shares nothing with them.
ELEMENTS = [
    NetworkElement(id="A-1", type="transmission_node", model="TX-5000", install_year=2023, firmware="5.0", site_id="S-1"),
    NetworkElement(id="K-1", type="transmission_node", model="TX-3000", install_year=2019, firmware="3.8", site_id="S-2"),
    NetworkElement(id="C-1", type="transmission_node", model="TX-3000", install_year=2018, firmware="3.8", site_id="S-3"),
    NetworkElement(id="D-1", type="radio_unit", model="RU-400", install_year=2023, firmware="2.5", site_id="S-4"),
    NetworkElement(id="E-1", type="transmission_node", model="TX-3000", install_year=2018, firmware="3.8", site_id="S-4"),
]
SITES = [Site(id=f"S-{i}", name=f"Site {i}") for i in range(1, 5)]
LINKS = [("L-1", "A-1", "C-1", "fiber"), ("L-2", "K-1", "C-1", "fiber"), ("L-3", "D-1", "E-1", "microwave")]


def _store() -> ContextStore:
    return ContextStore(Inventory(ELEMENTS, SITES))


def _report(store, element, topic, at, file, action="Reboot the line card.", by="Liisa", trust="stated",
            atype="workaround", thread_times=None, bind=None, conditions=(), summary=None):
    a = ContextAssertion(
        type=atype, topic=topic, summary=summary or topic,
        bound_to=[Binding(entity=e, role="applies_to") for e in (bind or [element])],
        action=action, valid_from=at, trust=Trust(level=trust, stated_by=by), conditions=list(conditions),
        sources=[SourceRef(source="teams", file=file, seq=[1])], confidence=0.8,
    )
    stored, _ = store.add_assertion(a)
    if thread_times is not None:
        thread_times[file] = at
    return stored


def _linked(store, times, at=AT):
    return [p for p in find_patterns(store, LINKS, times, at) if p.kind == "linked"]


# ---------------------------------------------------------------- linked


def test_two_reports_sharing_a_hidden_neighbour_are_a_watch():
    store, times = _store(), {}
    _report(store, "A-1", "sync-loss", T0, "t1", action="Reset the timing port.", by="Niko", thread_times=times)
    _report(store, "K-1", "traffic-drop", T0 + timedelta(minutes=30), "t2", thread_times=times)
    [p] = _linked(store, times)
    assert p.level == "watch" and p.elements == ["A-1", "K-1"]
    dep = next(f for f in p.factors if f.kind == "dependency")
    assert dep.entity == "C-1" and dep.reported is False
    assert "C-1" in p.hypotheses[0].text and "nobody reported it" in p.hypotheses[0].text


def test_seen_twice_becomes_an_insight():
    store, times = _store(), {}
    for day in (0, 14):
        t = T0 + timedelta(days=day)
        _report(store, "A-1", "sync-loss", t, f"a{day}", action="Reset the timing port.", thread_times=times)
        _report(store, "K-1", "traffic-drop", t + timedelta(minutes=40), f"k{day}", thread_times=times)
    [p] = _linked(store, times)
    assert p.level == "insight" and p.count == 2
    assert any("symptom only" in h.text for h in p.hypotheses)  # resets and reboots both came back
    # the two single-element repeats are explained by the linked pattern: not listed again on their own
    assert not [x for x in find_patterns(store, LINKS, times, AT) if x.kind == "recurring" and x.level == "watch"]


def test_coincidence_with_nothing_in_common_is_silent():
    store, times = _store(), {}
    _report(store, "A-1", "sync-loss", T0, "t1", thread_times=times)
    _report(store, "D-1", "radio-dead", T0 + timedelta(minutes=10), "t2", thread_times=times)
    assert find_patterns(store, LINKS, times, AT) == []


def test_far_apart_in_time_is_not_linked():
    store, times = _store(), {}
    _report(store, "A-1", "sync-loss", T0, "t1", thread_times=times)
    _report(store, "K-1", "traffic-drop", T0 + timedelta(hours=10), "t2", thread_times=times)
    assert _linked(store, times) == []


def test_one_conversation_about_both_is_not_a_hidden_link():
    """If one person already linked A and K in the same thread, it is known, not a pattern to surface."""
    store, times = _store(), {}
    _report(store, "A-1", "evening-drop", T0, "t1", bind=["A-1", "K-1"], thread_times=times)
    assert _linked(store, times) == []


def test_a_later_lasting_fix_on_the_suspect_resolves_it_on_its_own():
    store, times = _store(), {}
    for day in (0, 14):
        t = T0 + timedelta(days=day)
        _report(store, "A-1", "sync-loss", t, f"a{day}", thread_times=times)
        _report(store, "K-1", "traffic-drop", t + timedelta(minutes=40), f"k{day}", thread_times=times)
    fix_at = T0 + timedelta(days=20)
    _report(store, "C-1", "clock-drift", fix_at, "fix", action="Replace the clock module on C-1.", by="Erkki",
            trust="verified", thread_times=times)
    [before] = _linked(store, times, at=fix_at - timedelta(days=1))  # the fix is in the future: ignored
    assert before.level == "insight"
    [after] = _linked(store, times, at=fix_at + timedelta(days=1))
    assert after.level == "resolved" and "Erkki" in after.status_note


# ---------------------------------------------------------------- recurring


def _breaker_trips(store, times, n=3):
    a = None
    for i in range(n):
        t = T0 + timedelta(days=10 * i)
        file = f"trip{i}"
        if a is None:
            a = _report(store, "D-1", "breaker-trip", t, file, action="Reset breaker F3 before replacing the radio.",
                        by="Sanna", thread_times=times)
        else:
            a.sources.append(SourceRef(source="slack", file=file, seq=[1]))
            times[file] = t
    return a


def test_the_same_workaround_three_times_is_an_insight():
    store, times = _store(), {}
    _breaker_trips(store, times)
    [p] = find_patterns(store, LINKS, times, AT)
    assert p.kind == "recurring" and p.level == "insight" and p.count == 3
    assert p.fixes[0].kind == "temporary" and p.fixes[0].applied == 3
    assert any("No lasting fix" in h.text for h in p.hypotheses)


def test_twice_is_only_a_watch():
    store, times = _store(), {}
    _breaker_trips(store, times, n=2)
    [p] = find_patterns(store, LINKS, times, AT)
    assert p.level == "watch"


def test_chat_and_email_about_the_same_case_count_once():
    store, times = _store(), {}
    a = _breaker_trips(store, times, n=2)
    a.sources.append(SourceRef(source="email", file="mail", seq=[1]))
    times["mail"] = T0 + timedelta(hours=2)
    [p] = find_patterns(store, LINKS, times, AT)
    assert p.count == 2 and p.occurrences[0].sources == ["trip0", "mail"]


def test_a_proposal_does_not_close_it_but_a_done_fix_does():
    store, times = _store(), {}
    _breaker_trips(store, times)
    last = T0 + timedelta(days=20)
    _report(store, "D-1", "dehumidifier-circuit", last, "idea", action="Rewire the dehumidifier onto its own circuit.",
            by="Liisa", trust="hunch", thread_times=times)
    [p] = [x for x in find_patterns(store, LINKS, times, AT) if x.topics == ["breaker-trip"]]
    assert p.level == "insight" and "proposed a lasting fix" in p.hypotheses[0].text
    _report(store, "D-1", "dehumidifier-circuit-done", last + timedelta(days=3), "done",
            action="Rewire the dehumidifier onto its own circuit.", by="Heikki", trust="verified", thread_times=times)
    [p] = [x for x in find_patterns(store, LINKS, times, AT) if x.topics == ["breaker-trip"]]
    assert p.level == "resolved"


def test_a_firmware_fix_not_rolled_out_keeps_it_open():
    store, times = _store(), {}
    _report(store, "K-1", "sfp-forwarding", T0, "x1", action="Bounce the interface.", thread_times=times)
    _report(store, "E-1", "sfp-forwarding", T0 + timedelta(days=5), "x2", action="Bounce the interface.",
            thread_times=times)
    _report(store, "K-1", "sfp-forwarding", T0 + timedelta(days=9), "fw", action="Upgrade to firmware 4.2.",
            atype="invalidation", by="Aino", bind=["K-1", "E-1"], thread_times=times)
    [p] = find_patterns(store, LINKS, times, AT)
    assert p.level == "insight" and "not rolled out" in p.status_note
    assert "K-1 still runs 3.8" in " ".join(p.hypotheses[0].basis)


# ---------------------------------------------------------------- safety


def test_patterns_never_change_the_store_or_what_the_agent_gets():
    store, times = _store(), {}
    _breaker_trips(store, times)
    _report(store, "A-1", "sync-loss", T0, "t1", thread_times=times)
    _report(store, "K-1", "traffic-drop", T0 + timedelta(minutes=30), "t2", thread_times=times)
    before = {i: a.model_dump() for i, a in store.assertions.items()}
    ctx_before = [h.assertion.id for h in store.get_context("K-1", at=AT)]
    find_patterns(store, LINKS, times, AT)
    assert {i: a.model_dump() for i, a in store.assertions.items()} == before
    assert [h.assertion.id for h in store.get_context("K-1", at=AT)] == ctx_before


@pytest.mark.parametrize("action,kind", [
    ("Reboot the line card.", "temporary"),
    ("Disable the interface, wait a little, then enable it again.", "temporary"),
    ("Reset breaker F3 and check the radio comes back before replacing it.", "temporary"),
    ("Replace the clock module on TRN-117.", "lasting"),
    ("Upgrade to firmware 4.2.", "lasting"),
    ("Don't replace the SFP, bounce the interface.", "temporary"),
    ("Collect the key from the kiosk.", "unknown"),
])
def test_fix_classification(action, kind):
    assert classify_fix(action) == kind


# ---------------------------------------------------------------- the seed story


@pytest.fixture(scope="module")
def history():
    return replay_history("scripted")


def test_seed_story_over_time(history):
    store, links, times = history

    def by_title(at):
        return {p.title: p for p in find_patterns(store, links, times, at)}

    oct7 = by_title(datetime(2026, 10, 7, 8))
    [p] = [p for p in oct7.values() if p.kind == "linked"]
    assert p.level == "watch" and p.elements == ["TRN-131", "TRN-229"]
    assert next(f for f in p.factors if f.kind == "dependency").entity == "TRN-117"

    oct31 = list(by_title(datetime(2026, 10, 31, 12)).values())
    levels = {(p.kind, tuple(p.elements)): p.level for p in oct31}
    assert levels[("linked", ("TRN-131", "TRN-229"))] == "insight"
    assert levels[("recurring", ("RAD-254",))] == "insight"
    # TRN-088's thread names it "sfp-swap-first-step": same problem, counted with the others (as the real LLM does)
    sfp = next(p for p in oct31 if "sfp-swap-forwarding-state" in p.topics)
    assert sfp.elements == ["TRN-042", "TRN-088", "TRN-117"] and "sfp-swap-first-step" in sfp.topics
    assert sfp.level == "insight" and "not rolled out" in sfp.status_note  # firmware 4.2 not on these 3.8 units
    assert not [p for p in oct31 if p.level == "watch"]

    nov7 = {(p.kind, tuple(p.elements)): p for p in find_patterns(store, links, times, datetime(2026, 11, 7, 12))}
    assert nov7[("linked", ("TRN-131", "TRN-229"))].level == "resolved"
    assert "Erkki" in nov7[("linked", ("TRN-131", "TRN-229"))].status_note
    assert "Insights" in render_markdown(list(nov7.values()), datetime(2026, 11, 7, 12))


def test_the_eval_history_alone_has_no_linked_pattern():
    """The 26 labelled scenarios, replayed without the pattern scenarios, must not invent links."""
    from context_layer.eval.kb import build_kb, load_spec
    from context_layer.workbench.seed import load_seed

    kb = build_kb(load_spec(), "scripted")
    links = [(lk.id, lk.a, lk.b, lk.kind) for lk in load_seed().links]
    times = {r.thread.id: r.thread.started_at for r in kb.runs}
    assert not [p for p in find_patterns(kb.store, links, times, AT) if p.kind == "linked"]


# ---------------------------------------------------------------- topic names that differ (real LLM)

# How a real LLM names and phrases the breaker trips, thread by thread (the first one is from out/eval/extractions.json).
LLM_NAMES = {
    "slack-breaker-harbour-hut": ("turku-harbour-hut-breaker-f3-trip",
                                  "Flip F3 back up in the grey breaker cabinet left of the door"),
    "pattern-harbour-breaker-again": ("rad-254-breaker-f3-tripped",
                                      "Reset F3 and empty the dehumidifier tray, don't touch the radio"),
    "pattern-harbour-breaker-third": ("harbour-hut-f3-trip", "Reset F3 and empty the tray"),
    "similar-trn117": ("tx-3000-sfp-swap-zero-counters", "Bounce the interface: disable, wait a bit, then enable"),
}


def test_repeats_survive_llm_topic_names(monkeypatch):
    from context_layer.eval import kb as kbmod

    def renamed(mode):
        def extract(s, t, topics):
            items = list(s.expected.items) if s.expected else []
            if s.id not in LLM_NAMES:
                return items
            topic, action = LLM_NAMES[s.id]
            return [i.model_copy(update={"topic": topic, "action": action}) if i.topic in (
                "harbour-hut-breaker-trip", "sfp-swap-forwarding-state") else i for i in items]
        return extract

    monkeypatch.setattr(kbmod, "_extractor", renamed)
    store, links, times = replay_history("scripted")
    found = find_patterns(store, links, times, datetime(2026, 10, 31, 12))
    breaker = next(p for p in found if p.elements == ["RAD-254"])
    assert breaker.count == 3 and breaker.level == "insight"
    assert set(breaker.topics) == {name for name, _ in list(LLM_NAMES.values())[:3]}
    assert breaker.grouped  # says why the names were counted together
    sfp = next(p for p in found if "tx-3000-sfp-swap-zero-counters" in p.topics)
    assert sfp.elements == ["TRN-042", "TRN-088", "TRN-117"]


def test_one_element_with_two_different_problems_stays_apart(history):
    from context_layer.mvp.patterns import PatternSettings, _Net, group_topics

    store, links, _ = history
    groups, _, _ = group_topics(_Net(store, links, AT), PatternSettings())
    _check_apart(groups)
    # The guards hold whatever the embedding model says, even if it calls every text identical.
    groups, _, _ = group_topics(_Net(store, links, AT), PatternSettings(), embedder=lambda ts: [[1.0] for _ in ts])
    _check_apart(groups)


def _check_apart(groups):
    # TRN-229: vendor tip on sync after a power dip vs the evening sync loss (another cause)
    assert groups["tx5000-sync-after-power-dip"] != groups["evening-sync-loss-timing-port-reset"]
    # RAD-254: the breaker workaround vs the proposed rewiring (a fix for it, not the same problem)
    assert groups["harbour-hut-breaker-trip"] != groups["harbour-hut-dehumidifier-circuit"]
    # TX-3000 after a swap: optics that settle vs counters at zero
    assert groups["optical-levels-settle-after-swap"] != groups["sfp-swap-forwarding-state"]


def test_same_words_on_unrelated_elements_stay_apart():
    """Two radios at other sites, other models: similar topic names are not the same problem."""
    store, times = _store(), {}
    for i, el in enumerate(["A-1", "D-1", "A-1", "D-1"]):  # TX-5000 at S-1 and RU-400 at S-4, never linked
        _report(store, el, f"{el.lower()}-power-reset", T0 + timedelta(days=7 * i), f"x{i}",
                action="Reset the power supply.", thread_times=times)
    rec = [p for p in find_patterns(store, LINKS, times, AT) if p.kind == "recurring"]
    assert sorted(p.elements for p in rec) == [["A-1"], ["D-1"]]


# ---------------------------------------------------------------- same problem, other words (embedding model)


def _concepts(*families):
    """A fake embedding model: texts that name a word of the same family get the same vector (meaning, not words)."""
    def embed(texts):
        out = []
        for t in texts:
            low = t.lower()
            hit = next((i for i, fam in enumerate(families) if any(w in low for w in fam)), None)
            v = [0.0] * (len(families) + 1)
            v[len(families) if hit is None else hit] = 1.0
            out.append(v)
        return out
    embed.label = "fake-model"
    return embed


POWER = ("breaker", "cut-out", "fuse")
DOWN = Condition(text="radio dead", check=Check(field="interface_status", op="==", value="DOWN"))
UP = Condition(text="link up", check=Check(field="interface_status", op="==", value="UP"))


def _three_trips(store, times, third_conditions=(DOWN,), third_action="Push the popped cut-out back in."):
    _report(store, "D-1", "breaker-trip", T0, "w1", action="Reset breaker F3.", conditions=[DOWN], thread_times=times)
    _report(store, "D-1", "breaker-trip", T0 + timedelta(days=10), "w2", action="Reset breaker F3.", conditions=[DOWN],
            thread_times=times)
    # The third time, someone else tells it with none of the same words.
    _report(store, "D-1", "shed-radio-dark-after-fog", T0 + timedelta(days=20), "w3", by="Jaakko",
            summary="the moisture absorber overloads the cut-out", action=third_action,
            conditions=list(third_conditions), thread_times=times)


def test_same_problem_in_other_words_needs_meaning():
    store, times = _store(), {}
    _three_trips(store, times)
    [words_only] = [p for p in find_patterns(store, LINKS, times, AT, embedder=None) if p.kind == "recurring"]
    assert words_only.count == 2 and words_only.level == "watch"  # the third trip is missed by words alone

    from context_layer.mvp.patterns import analyze
    report = analyze(store, LINKS, times, AT, embedder=_concepts(POWER))
    [p] = [p for p in report.patterns if p.kind == "recurring"]
    assert p.count == 3 and p.level == "insight"
    assert set(p.topics) == {"breaker-trip", "shed-radio-dark-after-fog"}
    assert "same meaning" in p.grouped[0] and report.meaning.startswith("on: fake-model")


def test_guards_win_over_meaning():
    """Even with identical vectors: other symptom values, or a workaround vs its cure, are not the same problem."""
    everything_same = _concepts(("",))  # every text gets the same vector
    store, times = _store(), {}
    _three_trips(store, times, third_conditions=(UP,))  # radio UP the third time: another problem
    [p] = [p for p in find_patterns(store, LINKS, times, AT, embedder=everything_same) if p.kind == "recurring"]
    assert p.count == 2

    store, times = _store(), {}
    _three_trips(store, times, third_action="Rewire the absorber onto its own circuit.")  # the cure, not a trip
    [p] = [p for p in find_patterns(store, LINKS, times, AT, embedder=everything_same) if p.kind == "recurring"]
    assert p.count == 2


def test_a_failing_model_falls_back_to_words():
    from context_layer.mvp.patterns import analyze

    def broken(texts):
        raise ConnectionError("no network")

    store, times = _store(), {}
    _three_trips(store, times)
    report = analyze(store, LINKS, times, AT, embedder=broken)
    assert report.meaning.startswith("failed (ConnectionError") and report.patterns[0].count == 2


def test_model_embedder_is_off_without_a_model_and_caches_with_one(tmp_path, monkeypatch):
    from context_layer import config, embed
    from context_layer.mvp.patterns import model_embedder

    assert model_embedder() is None  # tests run with EMBEDDING_MODEL blanked (conftest)
    monkeypatch.setattr(config, "EMBEDDING_MODEL", "fake-model")
    calls = []
    monkeypatch.setattr(embed, "embed", lambda texts: calls.append(list(texts)) or [[3.0, 4.0] for _ in texts])
    run = model_embedder(tmp_path / "cache.json")
    assert run(["a", "b"]) == [[0.6, 0.8], [0.6, 0.8]]
    assert run(["b", "a"]) == [[0.6, 0.8], [0.6, 0.8]] and len(calls) == 1  # second time from the cache
    run(["c"])
    assert calls[-1] == ["c"]


def test_meaning_pairs_are_well_formed_and_scored():
    import json

    from context_layer import config
    from context_layer.embed import hash_embed
    from context_layer.mvp.patterns import check_meaning

    pairs = json.loads((config.DATA_DIR / "eval" / "pattern_pairs.json").read_text(encoding="utf-8"))["pairs"]
    assert {p["same"] for p in pairs} == {True, False}
    assert all(p["a"]["topic"] and p["b"]["topic"] and p["why"] for p in pairs)
    r = check_meaning(lambda texts: [hash_embed(t) for t in texts], 0.85)  # words only: plumbing, not quality
    assert len(r["rows"]) == len(pairs) and {"separable", "suggested", "wrong_merges", "missed"} <= r.keys()


def test_meaning_needs_a_real_shared_place_not_just_a_model():
    """RAD-176 'frost, on RAD-176 only' vs RAD-198 'iced dish': two RU-200s, similar meaning (0.82 on the real model),
    two causes. Units that share only a model are never grouped by meaning; the same element still is."""
    everything_same = _concepts(("",))
    store, times = _store(), {}  # K-1 and E-1 are both TX-3000, at other sites, not linked
    _report(store, "K-1", "frost-margin-dip", T0, "k1", action="Wait for the heater.", thread_times=times)
    _report(store, "E-1", "iced-dish-flap", T0 + timedelta(days=9), "e1", action="Wait for the sun.", thread_times=times)
    _report(store, "E-1", "iced-dish-flap", T0 + timedelta(days=19), "e2", action="Wait for the sun.", thread_times=times)
    rec = [p for p in find_patterns(store, LINKS, times, AT, embedder=everything_same) if p.kind == "recurring"]
    assert [p.elements for p in rec] == [["E-1"]] and rec[0].count == 2
    _report(store, "E-1", "dish-ice-morning", T0 + timedelta(days=29), "e3", action="Let it thaw.", thread_times=times)
    rec = [p for p in find_patterns(store, LINKS, times, AT, embedder=everything_same) if p.kind == "recurring"]
    assert [p.elements for p in rec] == [["E-1"]] and rec[0].count == 3  # same element: meaning groups it


# ---------------------------------------------------------------- the CLI itself (a syntax error there once passed CI)


def test_cli_patterns_report(tmp_path, monkeypatch, capsys):
    from context_layer import cli, config

    monkeypatch.setattr(config, "OUT_DIR", tmp_path)
    cli.main(["patterns", "--at", "2026-10-31T12:00"])
    out = capsys.readouterr().out
    assert "## Insights: worth a look (3)" in out and "meaning check off" in out
    assert (tmp_path / "patterns" / "report.md").exists() and (tmp_path / "patterns" / "patterns.json").exists()


def test_cli_check_meaning(monkeypatch, capsys):
    from context_layer import cli
    from context_layer.embed import hash_embed
    from context_layer.mvp import patterns as P

    with pytest.raises(SystemExit, match="EMBEDDING_MODEL is empty"):
        cli.main(["patterns", "--check-meaning"])
    monkeypatch.setattr(P, "model_embedder", lambda: (lambda texts: [hash_embed(t) for t in texts]))
    cli.main(["patterns", "--check-meaning"])
    out = capsys.readouterr().out
    assert "stop = shares only a model" in out and "highest 'different' pair that reaches meaning" in out
