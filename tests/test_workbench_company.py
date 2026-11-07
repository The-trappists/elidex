"""Company day: timeline file, sync cycles, network status and knowledge export, offline (scripted extractor)."""

import asyncio
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from context_layer import config
from context_layer.workbench import company as company_mod
from context_layer.workbench.app import create_app
from context_layer.workbench.company import CompanyDay, export_package, load_timeline, render_markdown
from context_layer.workbench.contracts import CompanyStartBody, IncidentSpec
from context_layer.workbench.seed import load_seed
from context_layer.workbench.simulator import Simulator
from context_layer.workbench.state import Workbench

SEED = load_seed()
SCENARIOS = {s.id: s for s in SEED.scenarios}


# ---------------------------------------------------------------- the timeline file


def test_day_file_is_valid_ordered_and_inside_the_day():
    entries = load_timeline()
    assert 25 <= len(entries) <= 40
    assert len({e.id for e in entries}) == len(entries)
    assert [e.at_min for e in entries] == sorted(e.at_min for e in entries)
    for e in entries:
        assert e.scenario_id in SCENARIOS, e.scenario_id
        s = SCENARIOS[e.scenario_id]
        end = e.at_min + sum(m.delay_s for m in s.messages) / 60
        assert 0 <= e.at_min and end < 480, e.id
    ids = [e.scenario_id for e in entries]
    assert ids.index("elisa-trn042-chat") < ids.index("similar-trn117") < ids.index("agent-outcome-followup")
    assert {"firmware-4-2-rollout", "noise-chitchat"} <= set(ids)
    assert sum(1 for i in ids if i.startswith("pattern-")) >= 6


# ---------------------------------------------------------------- a short deterministic day


async def settle(wb, timeout=15):
    for _ in range(int(timeout / 0.02)):
        busy = wb.processor._tasks or wb.processor._timers
        if not busy and all(t.status != "processing" for t in wb.threads.values()):
            return
        await asyncio.sleep(0.02)
    raise AssertionError("pipeline did not settle")


async def advance(wb, sim, day, minutes):
    wb.clock.advance(minutes * 60)
    sim.tick()
    await day.tick()


def make_day(tmp_path, monkeypatch, entries, **kw):
    monkeypatch.setattr(config, "WORKBENCH_LLM_CALLS_FILE", tmp_path / "llm_calls.jsonl")
    monkeypatch.setattr(config, "WORKBENCH_LLM_CACHE_FILE", tmp_path / "llm_cache.json")
    wb = Workbench(state_file=tmp_path / "state.json", seed=False)
    wb.reset("empty")
    wb.settings.extractor_mode = "scripted"
    path = tmp_path / "day.json"
    path.write_text(json.dumps(entries), encoding="utf-8")
    sim = Simulator(wb)
    return wb, sim, CompanyDay(wb, sim, timeline_path=path, **kw)


def test_a_short_day_end_to_end(tmp_path, monkeypatch):
    entries = [
        {"id": "d1", "at_min": 0, "kind": "incident_chat", "scenario_id": "elisa-trn042-chat", "label": "TRN-042"},
        {"id": "d2", "at_min": 40, "kind": "incident_chat", "scenario_id": "similar-trn117", "label": "TRN-117"},
    ]

    async def scenario():
        wb, sim, day = make_day(tmp_path, monkeypatch, entries)
        wb.bus.loop = asyncio.get_running_loop()
        wb.processor.start()
        day.start(CompanyStartBody(speed=1, day_minutes=120, cycle_minutes=10))
        wb.clock.pause()  # the test drives sim time by hand
        start = day.st.started_at
        assert start.hour == 8 and day.st.next_cycle_at == start + timedelta(minutes=10)
        # an incident that stays open until the test closes it; no knowledge exists yet
        spec = SCENARIOS["similar-trn117"].incident
        inc = wb.open_incident(IncidentSpec(**{**spec.model_dump(), "entity_id": "TRN-117"}), origin="manual")

        await advance(wb, sim, day, 0)  # timeline entry d1 starts
        assert [e.started for e in day.st.timeline] == [True, False]

        await advance(wb, sim, day, 10)  # sync 1 at 08:10
        assert len(day._cycles) == 1 and day._cycles[0].at == start + timedelta(minutes=10)
        h = day._health["TRN-117"]
        assert h.status == "degraded" and "no knowledge yet" in h.reason and not h.applied_assertion_ids
        assert day._health["TRN-042"].status in ("degraded", "recovering")  # its own incident, handled in the window

        await advance(wb, sim, day, 5)  # the chat is over (14 min), 08:15
        await settle(wb)
        assert len(wb.store.assertions) >= 1
        await advance(wb, sim, day, 5)  # sync 2 at 08:20
        assert [c.n for c in day._cycles] == [1, 2]
        h = day._health["TRN-117"]
        assert h.status == "recovering" and h.applied_assertion_ids and h.recommendation
        assert day._cycles[1].package.new_ids and day._cycles[0].package.new_ids == []
        call = [c for c in day._calls if c.cycle == 2 and c.entity_id == "TRN-117"][0]
        assert call.cited_assertion_ids == h.applied_assertion_ids and call.status_before == "degraded"
        assert any(c.element_id == "TRN-117" and c.to_status == "recovering" for c in day._cycles[1].status_changes)
        assert sum(day._cycles[1].health_counts.values()) == len(wb.elements)

        wb.resolve_incident(inc.id)
        await advance(wb, sim, day, 10)  # sync 3 at 08:30
        assert day._health["TRN-117"].status == "healthy"
        assert day._cycles[2].health_counts["healthy"] == len(wb.elements)

        # the second chat (TRN-117 SFP swap) reuses the knowledge from the first one
        await advance(wb, sim, day, 10)  # 08:40 -> d2 starts
        assert day.st.timeline[1].started
        await advance(wb, sim, day, 9)  # 08:49, sync at 08:40 and 08:50 not yet
        assert len(day._cycles) == 4
        await advance(wb, sim, day, 1)  # sync 5 at 08:50
        call = [c for c in day._calls if c.cycle == 5 and c.entity_id == "TRN-117"][0]
        assert call.cited_assertion_ids, "knowledge from the TRN-042 chat should be cited for TRN-117"
        # the knowledge package grows as chats are processed
        await advance(wb, sim, day, 10)
        await settle(wb)
        await advance(wb, sim, day, 10)
        assert day._cycles[-1].package.total >= day._cycles[1].package.total

        # pause / resume / stop keep the data
        assert day.pause().status == "paused" and not wb.clock.running
        assert day.resume().status == "running" and wb.clock.running
        wb.clock.pause()
        assert day.stop().status == "idle" and day.state().cycles

        await advance(wb, sim, day, 0)
        # finish: run the clock to the end of the day
        day.st.status = "running"
        await advance(wb, sim, day, 200)
        assert day.st.status == "finished"
        assert day._cycles[-1].at == day.st.ends_at
        assert day.state().cycles == day._cycles[-60:]
        return wb, day

    wb, day = asyncio.run(scenario())
    # export
    pkg = export_package(wb, at=day.st.ends_at, valid_only=True)
    assert pkg["counts"]["assertions"] == len(pkg["assertions"]) >= 1
    assert pkg["bindings"] and pkg["sources"]
    assert json.dumps(pkg)
    md = render_markdown(pkg)
    assert md.startswith("# Knowledge package") and "ctx_0001" in md
    old = export_package(wb, at=day.st.started_at, valid_only=True)
    assert old["counts"]["assertions"] == 0
    assert export_package(wb, at=day.st.started_at, valid_only=False)["counts"]["assertions"] >= 1
    assert day.package(1)["package"]["cycle"] == 1 and day.package(999) is None
    assert company_mod.CompanyDay.package(day)["package"]["cycle"] == day._cycles[-1].n


# ---------------------------------------------------------------- the routes


def test_company_routes(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKBENCH_LLM_CALLS_FILE", tmp_path / "llm_calls.jsonl")
    monkeypatch.setattr(config, "WORKBENCH_LLM_CACHE_FILE", tmp_path / "llm_cache.json")
    with TestClient(create_app(state_file=tmp_path / "state.json", background=False)) as c:
        c.put("/api/settings", json={"extractor_mode": "scripted"})
        assert c.get("/api/company").json()["status"] == "idle"
        assert c.get("/api/company/package", params={"cycle": 3}).status_code == 404
        s = c.post("/api/company/start", json={"speed": 60, "reset": "empty"}).json()
        assert s["status"] == "running" and len(s["timeline"]) >= 25
        assert c.post("/api/company/start", json={}).status_code == 409
        assert c.post("/api/company/pause").json()["status"] == "paused"
        assert c.post("/api/company/resume").json()["status"] == "running"
        assert c.post("/api/company/stop").json()["status"] == "idle"
        r = c.get("/api/company/export", params={"format": "json"})
        assert r.headers["content-disposition"].startswith("attachment") and "assertions" in r.json()
        r = c.get("/api/company/export", params={"format": "markdown", "valid_only": "false"})
        assert r.text.startswith("# Knowledge package") and r.headers["content-type"].startswith("text/markdown")
        assert c.get("/api/company/export", params={"format": "pdf"}).status_code == 422


# ---------------------------------------------------------------- endless mode and the chat generator

from context_layer.workbench import chatgen as chatgen_mod  # noqa: E402
from context_layer.workbench.chatgen import ChatGenerator  # noqa: E402


def make_endless(tmp_path, monkeypatch, entries=None, use_llm=False):
    wb, sim, day = make_day(tmp_path, monkeypatch, entries or [
        {"id": "d1", "at_min": 0, "kind": "incident_chat", "scenario_id": "elisa-trn042-chat", "label": "TRN-042"},
    ])
    for sc in SEED.scenarios:  # reset("empty") drops scenarios and elements: bring the seed ones back
        wb.scenarios.setdefault(sc.id, sc)
    return wb, sim, day


async def run_minutes(wb, sim, day, total, step=5):
    for _ in range(0, total, step):
        await advance(wb, sim, day, step)


def seeded_wb(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKBENCH_LLM_CALLS_FILE", tmp_path / "llm_calls.jsonl")
    monkeypatch.setattr(config, "WORKBENCH_LLM_CACHE_FILE", tmp_path / "llm_cache.json")
    wb = Workbench(state_file=tmp_path / "state.json", seed=True)
    wb.settings.extractor_mode = "scripted"
    return wb


def test_offline_generator_retargets_consistently(tmp_path, monkeypatch):
    wb = seeded_wb(tmp_path, monkeypatch)
    gen = ChatGenerator(wb, seed=1)
    base = wb.scenarios["similar-trn117"]
    sc = gen._recombine(base, wb.now())
    assert sc is not None and sc.id.startswith("gen_0001-similar-trn117") and sc.origin == "generated"
    assert wb.scenarios[sc.id] is sc
    new = sc.incident.entity_id
    assert new in wb.elements and new != "TRN-117"
    assert wb.elements[new].type == wb.elements["TRN-117"].type
    text = " ".join(m.text for m in sc.messages) + sc.incident.summary + sc.subject + sc.model_dump_json()
    assert new in text and "TRN-117" not in text
    for item in sc.expected.items:
        assert "TRN-117" not in item.scope.instance_ids
        assert set(item.scope.instance_ids) <= set(wb.elements)
    chatgen_mod.generator._check(wb, sc)  # valid persona and entity references
    # the base is untouched, ids are unique
    assert "TRN-117" in base.incident.entity_id
    ids = {gen.offline().id for _ in range(8)}
    assert len(ids) == 8 and sc.id not in ids


def test_mix_and_recurrence_guard(tmp_path, monkeypatch):
    wb = seeded_wb(tmp_path, monkeypatch)
    gen = ChatGenerator(wb, seed=3)
    now = wb.now()
    base = wb.scenarios["similar-trn117"]
    n = len([e for e in wb.elements.values() if e.type == "transmission_node"]) - 1
    got = []
    for _ in range(n + 2):
        s = gen._recombine(base, now)
        got.append(s)
    done = [s for s in got if s]
    assert len({s.incident.entity_id for s in done}) == len(done)  # never the same element twice in 6 h
    assert got[-1] is None  # all candidates used up inside the window
    later = now + timedelta(hours=7)
    gen.offline(later)  # the window expired, a repeat is allowed again
    assert gen._recent and all(later - r[2] < timedelta(hours=6) for r in gen._recent)
    kinds = [bool(wb.scenarios[sid.id].incident) for sid in [gen.offline(later + timedelta(hours=9 * i)) for i in range(40)]]
    assert 0 < kinds.count(False) < 15  # some noise, mostly incidents


def test_generated_scenarios_are_capped(tmp_path, monkeypatch):
    wb = seeded_wb(tmp_path, monkeypatch)
    gen = ChatGenerator(wb, seed=5)
    for i in range(120):
        assert gen.offline(wb.now() + timedelta(hours=7 * i))
    mine = [s for s in wb.scenarios.values() if s.origin == "generated"]
    assert len(mine) == chatgen_mod.MAX_GENERATED
    assert mine[-1].id.startswith("gen_0120")
    assert "similar-trn117" in wb.scenarios


def test_llm_mode_falls_back_and_is_rate_limited(tmp_path, monkeypatch):
    wb = seeded_wb(tmp_path, monkeypatch)
    t = [1000.0]
    gen = ChatGenerator(wb, seed=2, wall=lambda: t[0])
    monkeypatch.setattr(config, "llm_configured", lambda: True)
    calls = []

    def boom(wb_, entity, hint):
        calls.append(hint)
        raise ValueError("no answer")

    monkeypatch.setattr(chatgen_mod.generator, "generate_scenario", boom)

    async def go():
        a = await gen.generate(use_llm=True, gaps=["TRN-063"])
        assert a is not None and a.origin == "generated" and len(calls) == 1  # fell back to offline
        assert "TRN-063" in calls[0]
        await gen.generate(use_llm=True)
        assert len(calls) == 1  # inside 90 s: offline, no LLM call
        t[0] += 91
        await gen.generate(use_llm=True)
        assert len(calls) == 2
        # a working fake generator is used and its scenario is stored
        t[0] += 91
        real = wb.scenarios["noise-chitchat"].model_copy(update={"id": "gen-fake-ab12", "origin": "generated"})
        monkeypatch.setattr(chatgen_mod.generator, "generate_scenario", lambda *a: real.model_copy(deep=True))
        s = await gen.generate(use_llm=True)
        assert s.id.startswith("gen_") and s.id.endswith("-llm") and s.id in wb.scenarios
        # use_llm off: never calls it
        t[0] += 500
        n = len(calls)
        await gen.generate(use_llm=False)
        assert len(calls) == n

    asyncio.run(go())


def test_endless_day_cycles_generates_and_stays_bounded(tmp_path, monkeypatch):
    async def go():
        wb, sim, day = make_endless(tmp_path, monkeypatch)
        wb.bus.loop = asyncio.get_running_loop()
        wb.processor.start()
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
        wb.clock.pause()
        for sc in SEED.scenarios:
            wb.scenarios.setdefault(sc.id, sc)
        for el in SEED.elements:
            wb.elements.setdefault(el.id, el)
        for s in SEED.sites:
            wb.sites.setdefault(s.id, s)
        for p in SEED.personas:
            wb.personas.setdefault(p.id, p)
        wb.rebuild_store()
        st = day.st
        assert st.endless and st.ends_at is None and st.day_minutes == 0
        await run_minutes(wb, sim, day, 600)  # past 480 minutes
        assert day.st.status == "running" and day.st.next_cycle_at is not None
        assert len(day._cycles) >= 40
        assert day.st.generated_count >= 15
        gens = [e for e in day.st.timeline if e.kind == "generated"]
        assert gens and all(e.started and e.run_id for e in gens)
        assert len({e.scenario_id for e in gens}) == len(gens)
        assert sum(1 for r in wb.runs.values() if not r.done) <= 4
        for e in gens:
            sc = wb.scenarios.get(e.scenario_id)
            if sc and sc.incident:
                assert sc.incident.entity_id in wb.elements
        # a three-day run: lists stay bounded and knowledge is never lost
        await settle(wb)
        for _ in range(3):
            await run_minutes(wb, sim, day, 1440, step=10)
            await settle(wb)
            assert day.st.status == "running"
        k_ids = set(wb.store.assertions)
        assert k_ids and len(wb.store.classes) >= 0
        assert len(wb.threads) <= 150 + len([t for t in wb.threads.values() if t.id in {s.file for a in wb.store.assertions.values() for s in a.sources}])
        assert len(wb.runs) <= 100 + 4 and len(wb.jobs) <= 200 and len(wb.llm_calls) <= 500
        assert len(day._cycles) <= 60 and len(day._calls) <= 200
        assert len([e for e in day.st.timeline if e.kind == "generated"]) <= 100
        day._prune(wb.now())  # prune runs each cycle; one more after the last chats were processed
        assert len([s for s in wb.scenarios.values() if s.origin == "generated"]) <= 50 + 4
        now = wb.now()
        assert all(not (i.resolved_at and now - i.resolved_at > timedelta(hours=6, minutes=15)) for i in wb.incidents.values())
        assert all(h.status != "healthy" or now - h.since <= timedelta(hours=2, minutes=15) for h in day._health.values())
        # nothing stays open for ever: auto-resolution
        for i in wb.incidents.values():
            if i.resolved_at is None:
                t = wb.threads.get(i.thread_id)
                assert t is None or now - (t.last_message_at or i.opened_at) <= timedelta(hours=3, minutes=15) or any(
                    not r.done and r.thread_id == i.thread_id for r in wb.runs.values())
        assert not wb.threads or all(a.sources for a in wb.store.assertions.values())
        return wb, day, k_ids

    wb, day, k_ids = asyncio.run(go())
    assert set(wb.store.assertions) >= k_ids


def test_prune_archives_knowledge_threads_and_keeps_the_knowledge(tmp_path, monkeypatch):
    async def go():
        wb, sim, day = make_endless(tmp_path, monkeypatch)
        wb.bus.loop = asyncio.get_running_loop()
        wb.processor.start()
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
        wb.clock.pause()
        await advance(wb, sim, day, 0)
        await advance(wb, sim, day, 30)
        await settle(wb)
        evidence = {s.file for a in wb.store.assertions.values() for s in a.sources}
        assert evidence
        # pile up knowledge-free finished threads
        for i in range(200):
            t = wb.create_thread("teams", f"noise {i}", [], origin="generated")
            t.status = "processed"
        before = set(wb.store.assertions)
        day._prune(wb.now())
        assert len(wb.threads) <= 150
        assert set(wb.store.assertions) == before  # knowledge is never dropped
        assert all(a.sources for a in wb.store.assertions.values())
        gone = evidence - set(wb.threads)
        for tid in gone:  # a cited thread that left memory is in the archive with its messages
            assert day.archive.get_thread(tid)["messages"]

    asyncio.run(go())


def test_normal_day_unchanged_and_route_accepts_endless(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKBENCH_LLM_CALLS_FILE", tmp_path / "llm_calls.jsonl")
    monkeypatch.setattr(config, "WORKBENCH_LLM_CACHE_FILE", tmp_path / "llm_cache.json")
    with TestClient(create_app(state_file=tmp_path / "state.json", background=False)) as c:
        c.put("/api/settings", json={"extractor_mode": "scripted"})
        s = c.post("/api/company/start", json={"speed": 60, "day_minutes": 0}).json()
        assert s["status"] == "running" and s["endless"] and s["ends_at"] is None and len(s["timeline"]) >= 25
        assert c.post("/api/company/stop").json()["status"] == "idle"
        s = c.post("/api/company/start", json={"speed": 60}).json()
        assert not s["endless"] and s["ends_at"] and s["generated_count"] == 0


# ---------------------------------------------------------------- working calendar and bursts

from datetime import datetime  # noqa: E402

from context_layer.workbench.chatgen import activity_level, is_night  # noqa: E402

MONDAY = datetime(2026, 11, 2)


def test_activity_level_follows_the_finnish_week():
    assert MONDAY.weekday() == 0
    assert activity_level(MONDAY.replace(hour=12, minute=0)) == 0.5  # lunch dip
    assert activity_level(MONDAY.replace(hour=9)) == 1.2  # morning peak
    assert activity_level(MONDAY.replace(hour=14)) == 1.0
    assert activity_level(MONDAY.replace(hour=7)) == 0.4
    assert activity_level(MONDAY.replace(hour=18)) == 0.25
    assert activity_level(MONDAY.replace(hour=23)) == activity_level(MONDAY.replace(hour=3)) == 0.05
    assert activity_level(datetime(2026, 11, 7, 11)) == activity_level(datetime(2026, 11, 8, 15)) == 0.1  # weekend
    assert is_night(MONDAY.replace(hour=22)) and not is_night(MONDAY.replace(hour=6))


def _drive_generation(wb, day, sim, start, minutes, step=5, mark_done_every=20):
    """Drive the endless generator directly over sim time; returns [(sim time, scenario)] of generated chats."""
    started = []
    real = sim.start_scenario

    def spy(sid):
        run = real(sid)
        started.append((wb.now(), wb.scenarios[sid]))
        return run

    sim.start_scenario = spy

    async def go():
        wb.clock.set(start)
        for i in range(0, minutes, step):
            wb.clock.advance(step * 60)
            if i % mark_done_every == 0:
                for r in wb.runs.values():
                    r.done = True
            assert sum(1 for r in wb.runs.values() if not r.done) <= 4 + 2
            await day._generate_due(wb.now())

    asyncio.run(go())
    return started


def test_seven_day_run_is_quiet_at_night_and_on_weekends(tmp_path, monkeypatch):
    wb = seeded_wb(tmp_path, monkeypatch)
    wb.reset("seed")
    sim = Simulator(wb)
    empty = tmp_path / "empty.json"
    empty.write_text("[]")
    day = CompanyDay(wb, sim, timeline_path=empty)
    day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
    wb.clock.pause()
    started = _drive_generation(wb, day, sim, MONDAY, 7 * 24 * 60)
    weekday_work = [t for t, _ in started if t.weekday() < 5 and 8 <= t.hour < 16]
    weekday_night = [t for t, s in started if t.weekday() < 5 and is_night(t)]
    weekend = [t for t, _ in started if t.weekday() >= 5]
    per_hour_work = len(weekday_work) / (5 * 8)
    per_hour_night = len(weekday_night) / (5 * 8)  # 22-06 is 8 h
    per_hour_weekend = len(weekend) / 48
    assert per_hour_work > 1.5  # busy office hours
    assert per_hour_night < per_hour_work / 5 and per_hour_weekend < per_hour_work / 4
    assert weekend and weekday_night  # quiet is not dead
    # no chit-chat at night or on the weekend, and night incidents are critical
    for t, s in started:
        if activity_level(t) < 0.15:
            assert s.incident is not None, s.id
        if is_night(t):
            assert s.incident.severity == "critical"
    assert max(b - a for (a, _), (b, _) in zip(started, started[1:])) <= timedelta(hours=6, minutes=10)


def test_on_call_personas_at_night(tmp_path, monkeypatch):
    wb = seeded_wb(tmp_path, monkeypatch)
    gen = ChatGenerator(wb, seed=9)
    night = MONDAY.replace(hour=2)
    oncall = {p.id for p in wb.personas.values() if any(k in p.role.lower() for k in chatgen_mod.ONCALL_ROLES)}
    for i in range(12):
        sc = gen.offline(night + timedelta(days=i))
        assert sc.incident and {m.persona for m in sc.messages} <= oncall
        chatgen_mod.generator._check(wb, sc)  # stated_by still names a persona of the chat


def test_bursts_overlap_on_different_elements(tmp_path, monkeypatch):
    wb = seeded_wb(tmp_path, monkeypatch)
    sim = Simulator(wb)
    empty = tmp_path / "empty.json"
    empty.write_text("[]")
    day = CompanyDay(wb, sim, timeline_path=empty, burst_p=1.0)
    day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
    wb.clock.pause()
    started = _drive_generation(wb, day, sim, MONDAY.replace(hour=8), 6 * 60, step=1, mark_done_every=30)
    groups = []
    for (t, s) in started:
        if groups and t - groups[-1][-1][0] <= timedelta(minutes=6):
            groups[-1].append((t, s))
        else:
            groups.append([(t, s)])
    bursts = [g for g in groups if len(g) >= 2]
    assert bursts, "burst_p=1 must produce overlapping chats"
    for g in bursts:
        els = [s.incident.entity_id for _, s in g if s.incident]
        assert len(els) < 2 or els[0] != els[1]  # a burst chat never repeats the element of the chat that triggered it
    # with no bursts the same run produces none of the tight pairs
    wb2 = seeded_wb(tmp_path / "x" if False else tmp_path, monkeypatch)
    day0 = CompanyDay(wb2, Simulator(wb2), timeline_path=empty, burst_p=0.0)
    day0.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
    wb2.clock.pause()
    calm = _drive_generation(wb2, day0, day0.sim, MONDAY.replace(hour=8), 6 * 60, step=1, mark_done_every=30)
    tight = [1 for (a, _), (b, _) in zip(calm, calm[1:]) if b - a <= timedelta(minutes=5)]
    assert len(tight) < len(bursts)


# ---------------------------------------------------------------- cold archive, prefetch, caps, bug fixes

import types  # noqa: E402

from context_layer.workbench import routes as routes_mod  # noqa: E402
from context_layer.workbench.archive import Archive  # noqa: E402
from context_layer.workbench.chatgen import LlmPrefetcher  # noqa: E402


class FakeColl:
    def __init__(self, fail=False):
        self.docs, self.fail = {}, fail

    def replace_one(self, flt, doc, upsert=False):
        if self.fail:
            raise RuntimeError("atlas down")
        self.docs[flt["_id"]] = doc

    def find_one(self, flt):
        if self.fail:
            raise RuntimeError("atlas down")
        d = self.docs.get(flt["_id"])
        return dict(d) if d else None


class FakeDb(dict):
    def __init__(self, fail=False):
        super().__init__()
        self.fail = fail

    def __missing__(self, name):
        self[name] = FakeColl(self.fail)
        return self[name]


class FakeConn:
    def __init__(self, fail=False):
        self.rows, self.fail, self.sql = [], fail, []

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        if self.fail:
            raise RuntimeError("tiger down")
        self.sql.append(sql)
        if params:
            self.rows.append(params)

    def commit(self):
        pass

    def rollback(self):
        pass


def test_archive_files_default_and_lookup(tmp_path):
    a = Archive(tmp_path / "arch", atlas=False, tiger=False)
    a.put("threads", {"id": "live/aa", "messages": [{"text": "hi"}]})
    a.put("incidents", {"id": "inc_0001"})
    a.put("jobs", {"id": "job_0001"})
    assert a.flush()
    assert (tmp_path / "arch" / "threads.jsonl").read_text().count("\n") == 1
    assert a.get_thread("live/aa")["messages"][0]["text"] == "hi"
    fresh = Archive(tmp_path / "arch", atlas=False, tiger=False)  # a new process finds it in the file
    assert fresh.get_thread("live/aa")["messages"] and fresh.get_thread("live/zz") is None
    st = fresh.stats()
    assert st["backend"] == "files" and st["counts"] == {"threads": 1, "incidents": 1, "jobs": 1, "metrics": 0}
    assert Archive(None, atlas=False, tiger=False).get_thread("x") is None


def test_archive_atlas_and_tiger_sinks_with_fakes_and_fallback(tmp_path, caplog):
    db, conn = FakeDb(), FakeConn()
    a = Archive(tmp_path, atlas=lambda: db, tiger=lambda: conn)
    assert a.backend == "atlas+tiger-sink"
    a.put("threads", {"id": "live/aa", "messages": []})
    a.put_metrics({"sim_time": "2026-10-20T08:00", "cycle": 1, "knowledge_total": 3, "knowledge_valid": 2, "open_incidents": 1, "healthy": 5})
    assert a.flush()
    assert "live/aa" in db["wb_threads"].docs and not (tmp_path / "threads.jsonl").exists()
    assert len(conn.rows) == 1 and conn.rows[0][1] == 1 and a.stats()["counts"]["metrics"] == 1
    # Atlas goes down: one warning, the file takes over
    bad = Archive(tmp_path, atlas=lambda: FakeDb(fail=True), tiger=lambda: FakeConn(fail=True))
    with caplog.at_level("WARNING"):
        bad.put("threads", {"id": "live/bb", "messages": []})
        bad.put("incidents", {"id": "inc_0001"})
        bad.put_metrics({"sim_time": "x", "cycle": 1})
        bad.put_metrics({"sim_time": "x", "cycle": 2})
        assert bad.flush()
    assert (tmp_path / "threads.jsonl").exists() and (tmp_path / "incidents.jsonl").exists()
    assert bad.backend == "files"
    assert len([r for r in caplog.records if "Atlas failed" in r.message]) == 1
    assert len([r for r in caplog.records if "Tiger sink failed" in r.message]) == 1
    assert bad.get_thread("live/bb") is not None


def test_prune_archives_incidents_and_jobs_and_provenance_falls_back(tmp_path, monkeypatch):
    async def go():
        wb, sim, day = make_endless(tmp_path, monkeypatch)
        day.archive = Archive(tmp_path / "arch", atlas=False, tiger=False)
        wb.bus.loop = asyncio.get_running_loop()
        wb.processor.start()
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
        wb.clock.pause()
        await advance(wb, sim, day, 0)
        await advance(wb, sim, day, 30)
        await settle(wb)
        evidence = {s.file for a in wb.store.assertions.values() for s in a.sources}
        assert evidence
        monkeypatch.setattr(company_mod, "MAX_THREADS", 0)
        monkeypatch.setattr(company_mod, "MAX_JOBS", 0)
        for i in wb.incidents.values():
            wb.resolve_incident(i.id)
        wb.clock.advance(7 * 3600)
        day._prune(wb.now())
        assert not (evidence & set(wb.threads)) and not wb.jobs and not wb.incidents
        assert day.archive.flush()
        st = day.archive.stats()["counts"]
        assert st["threads"] >= len(evidence) and st["incidents"] >= 1 and st["jobs"] >= 1
        # provenance reads the archived thread back
        req = types.SimpleNamespace(app=types.SimpleNamespace(state=types.SimpleNamespace(wb=wb, company=day)))
        aid = next(iter(wb.store.assertions))
        rows = await routes_mod.graph_provenance(aid, req)
        assert rows and any(r["text"] for r in rows)
        stats = await routes_mod.company_archive_stats(req)
        assert stats["backend"] == "files"
        # delete_thread of an archived thread removes the knowledge it gave
        victim = next(iter(evidence))
        n = len(wb.store.assertions)
        await routes_mod.delete_thread(victim, req)
        assert len(wb.store.assertions) <= n and all(victim not in {s.file for s in a.sources} for a in wb.store.assertions.values())

    asyncio.run(go())


def test_prefetch_queue_never_blocks_and_backs_off(tmp_path, monkeypatch):
    async def go():
        wb, sim, day = make_endless(tmp_path, monkeypatch)
        t = [1000.0]
        calls = []
        base = wb.scenarios["noise-chitchat"]
        mode = {"fail": False}

        def fake(wb_, entity, hint):
            calls.append(hint)
            if mode["fail"]:
                raise ValueError("boom")
            return base.model_copy(update={"id": f"gen-fake-{len(calls)}", "origin": "generated"}, deep=True)

        monkeypatch.setattr(config, "llm_configured", lambda: True)
        pf = LlmPrefetcher(day.chatgen, lambda: [], wall=lambda: t[0], generate=fake)
        assert pf.pop() is None and not await pf.step()  # disabled
        pf.enable(True)
        assert await pf.step() and len(pf.queue) == 1
        assert not await pf.step() and len(calls) == 1  # inside 90 s
        for _ in range(5):
            t[0] += 91
            await pf.step()
        assert len(pf.queue) == 3 and len(calls) == 3  # capped at 3
        sc = pf.pop()
        assert sc.id.startswith("gen_") and sc.id in wb.scenarios and len(pf.queue) == 2
        pf.clear()
        assert pf.pop() is None
        # failures back off exponentially up to 10 minutes
        mode["fail"] = True
        waits = []
        for _ in range(8):
            t[0] += 1000
            await pf.step()
            waits.append(pf.wait_s())
        assert waits[0] == 180 and waits[1] == 360 and max(waits) == 600
        # a result that returns after stop/reset is dropped
        mode["fail"] = False
        t[0] += 1000
        pf.enabled = True

        def slow(wb_, entity, hint):
            pf.clear()  # reset happens while the model thinks
            return base.model_copy(update={"id": "gen-late", "origin": "generated"}, deep=True)

        pf._generate = slow
        assert not await pf.step() and not pf.queue

    asyncio.run(go())


def test_company_loop_pops_prefetched_chat_without_waiting(tmp_path, monkeypatch):
    async def go():
        wb, sim, day = make_endless(tmp_path, monkeypatch)
        wb.bus.loop = asyncio.get_running_loop()
        wb.processor.start()
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep", use_llm=True))
        wb.clock.pause()
        assert day.prefetch.enabled
        sc = wb.scenarios["noise-chitchat"].model_copy(update={"id": "gen-fake-1", "origin": "generated"}, deep=True)
        day.prefetch.queue.append(sc)
        await run_minutes(wb, sim, day, 120)
        assert any(s.endswith("-llm") for s in wb.scenarios) and not day.prefetch.queue
        assert day.st.generated_count >= 2  # the queue was empty afterwards: offline recombination
        day.stop()
        assert not day.prefetch.enabled and not day.prefetch.queue

    asyncio.run(go())


def test_persona_cap_and_dataset_caps(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKBENCH_LLM_CALLS_FILE", tmp_path / "llm_calls.jsonl")
    monkeypatch.setattr(config, "WORKBENCH_LLM_CACHE_FILE", tmp_path / "llm_cache.json")
    with TestClient(create_app(state_file=tmp_path / "state.json", background=False)) as c:
        n = len(c.get("/api/state").json()["personas"])
        for i in range(100 - n):
            assert c.post("/api/personas", json={"id": f"x{i}", "name": f"X {i}", "role": "r"}).status_code == 200
        r = c.post("/api/personas", json={"id": "one-more", "name": "One more", "role": "r"})
        assert r.status_code == 422 and "100" in r.json()["detail"]
        assert c.post("/api/data/load-dataset", json={"sites": 81}).status_code == 422
        # import above the caps
        data = c.get("/api/data/export").json()
        data["personas"] = data["personas"] * 2
        r = c.post("/api/data/import", json=data)
        assert r.status_code == 422 and "personas" in r.json()["detail"]
        data = c.get("/api/data/export").json()
        data["elements"] = [{**data["elements"][0], "id": f"E{i}"} for i in range(601)]
        assert c.post("/api/data/import", json=data).status_code == 422


def test_sample_export_refuses_too_many_sites(tmp_path):
    from context_layer.dataset.workbench_export import export_workbench

    with pytest.raises(ValueError, match="at most 80"):
        export_workbench(tmp_path, n_sites=81)


def test_stop_restores_auto_sim_and_restart_after_stop_or_finish(tmp_path, monkeypatch):
    async def go():
        wb, sim, day = make_endless(tmp_path, monkeypatch)
        wb.bus.loop = asyncio.get_running_loop()
        wb.settings.auto_sim = True
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
        assert wb.settings.auto_sim is False
        with pytest.raises(RuntimeError):
            day.start(CompanyStartBody())
        day.stop()
        day.stop()  # idempotent
        assert wb.settings.auto_sim is True and day.st.status == "idle"
        day.pause()
        day.resume()
        assert day.st.status == "idle"
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
        wb.clock.pause()
        await run_minutes(wb, sim, day, 60)
        assert day.st.status == "running" and day._cycles and day.st.generated_count >= 1
        day.stop()
        # a finished day restores too, and can be started again
        wb.settings.auto_sim = False
        day.start(CompanyStartBody(speed=1, day_minutes=30, cycle_minutes=10, reset="keep"))
        wb.clock.pause()
        await run_minutes(wb, sim, day, 40)
        assert day.st.status == "finished" and wb.settings.auto_sim is False
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
        assert day.st.status == "running" and day.st.endless and day.st.generated_count == 0

    asyncio.run(go())


def test_stop_during_a_slow_sync_drops_the_stale_result(tmp_path, monkeypatch):
    async def go():
        wb, sim, day = make_endless(tmp_path, monkeypatch)
        wb.bus.loop = asyncio.get_running_loop()
        wb.processor.start()
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
        wb.clock.pause()
        await advance(wb, sim, day, 0)
        await advance(wb, sim, day, 20)
        await settle(wb)
        el = next(iter(wb.elements))
        wb.open_incident(IncidentSpec(entity_id=el, kind="x", summary="s"), "manual")
        real = day._ask

        async def slow(case):
            out = await real(case)
            day.stop()
            day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
            return out

        day._ask = slow
        wb.clock.advance(15 * 60)
        await day._cycle(wb.now())
        assert len(day._cycles) == 0 and not day._calls and not day._health  # the new session was not polluted

    asyncio.run(go())


def test_one_bad_element_does_not_kill_the_sync_and_aware_clock_is_normalised(tmp_path, monkeypatch):
    async def go():
        wb, sim, day = make_endless(tmp_path, monkeypatch)
        wb.bus.loop = asyncio.get_running_loop()
        wb.processor.start()
        from datetime import timezone

        wb.clock.set(wb.now().replace(tzinfo=timezone.utc))
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
        assert day.st.started_at.tzinfo is None
        wb.clock.pause()
        await advance(wb, sim, day, 0)
        await advance(wb, sim, day, 20)
        real = day._handle_element

        async def flaky(n, at, el, incs, gen=None):
            raise ValueError("bad element")

        day._handle_element = flaky
        await advance(wb, sim, day, 20)
        assert day._cycles  # the cycle was still recorded
        day._handle_element = real

    asyncio.run(go())


def test_stale_bursts_are_dropped_when_four_chats_are_running(tmp_path, monkeypatch):
    async def go():
        wb, sim, day = make_endless(tmp_path, monkeypatch, entries=[])
        wb.bus.loop = asyncio.get_running_loop()
        day.start(CompanyStartBody(speed=1, day_minutes=0, cycle_minutes=10, reset="keep"))
        wb.clock.pause()
        for e in day.st.timeline:
            e.started = True
        for _ in range(4):
            sim.start_scenario("noise-chitchat")
        now = wb.now()
        day._next_gen_at = now
        day._bursts = [now - timedelta(minutes=30), now - timedelta(minutes=1)]
        await day._generate_due(now)
        assert day._bursts == [now - timedelta(minutes=1)]
        assert sum(1 for r in wb.runs.values() if not r.done) == 4

    asyncio.run(go())


def test_archive_cloud_off_when_not_configured(tmp_path, monkeypatch):
    """atlas=True / tiger=True with no URI configured must mean "off", not a broken factory."""
    from context_layer import config
    from context_layer.workbench.archive import Archive

    monkeypatch.setattr(config, "MONGODB_URI", "")
    monkeypatch.setattr(config, "TIGER_DATABASE_URL", "")
    a = Archive(tmp_path, atlas=True, tiger=True)
    st = a.stats()
    assert st["atlas"]["configured"] is False and st["tiger"]["configured"] is False
    a.close() if hasattr(a, "close") else None
