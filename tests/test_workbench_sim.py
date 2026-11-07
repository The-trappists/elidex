"""Workbench seed data, simulator and generator, offline (no backend, no LLM)."""

import json
from datetime import datetime, timedelta

import pytest

from context_layer import config, llm
from context_layer.link import Inventory, Linker
from context_layer.models import Message, Thread
from context_layer.workbench import generator
from context_layer.workbench.clock import SimClock
from context_layer.workbench.contracts import Incident, LiveThread, ScenarioRun, Settings
from context_layer.workbench.seed import load_seed
from context_layer.workbench.simulator import Simulator

SEED = load_seed()
SCENARIOS = {s.id: s for s in SEED.scenarios}
PERSONAS = {p.id: p for p in SEED.personas}
INVENTORY = Inventory(SEED.elements, SEED.sites)
T0 = datetime(2026, 11, 6, 9, 0)


def _thread(scenario) -> Thread:
    t, msgs = T0, []
    for i, m in enumerate(scenario.messages, 1):
        t += timedelta(seconds=m.delay_s)
        p = PERSONAS[m.persona]
        msgs.append(Message(thread_id=scenario.id, source=scenario.channel, seq=i, author=p.name, role=p.role, sent_at=t, text=m.text))
    return Thread(id=scenario.id, source=scenario.channel, subject=scenario.subject, messages=msgs)


# ---------------------------------------------------------------- data


def test_every_scenario_file_validates_and_is_sorted():
    files = list((config.WORKBENCH_SEED_DIR / "scenarios").glob("*.json"))
    assert len(SEED.scenarios) == len(files) == 15
    assert [s.origin for s in SEED.scenarios][:2] == ["elisa", "elisa"]
    for s in SEED.scenarios:
        assert s.description and s.tags
        assert all(8 <= m.delay_s <= 180 or i == 0 for i, m in enumerate(s.messages))
        assert set(m.persona for m in s.messages) <= set(PERSONAS)
        if s.incident:
            assert s.incident.entity_id in {e.id for e in SEED.elements}
            assert set(s.incident.observations) <= set(config_observable())
        if s.resolves_incident_at_seq:
            assert s.incident and 1 <= s.resolves_incident_at_seq <= len(s.messages)


def config_observable():
    from context_layer.models import OBSERVABLE_FIELDS

    return OBSERVABLE_FIELDS


def test_elisa_chat_text_is_verbatim():
    raw = json.loads((config.DATA_DIR / "elisa" / "teams_chat.json").read_text(encoding="utf-8"))
    names = {p.id: p.name for p in SEED.personas}
    s = SCENARIOS["elisa-trn042-chat"]
    assert [m.text for m in s.messages] == [m["text"] for m in raw["messages"]]
    assert [names[m.persona] for m in s.messages] == [m["author"] for m in raw["messages"]]
    email = (config.DATA_DIR / "elisa" / "email.txt").read_text(encoding="utf-8").partition("\n\n")[2].strip()
    assert SCENARIOS["elisa-trn042-email"].messages[0].text == email


def test_expected_items_bind_in_the_core_linker():
    linker = Linker(INVENTORY)
    checked = 0
    for s in SEED.scenarios:
        if not s.expected:
            continue
        thread = _thread(s)
        for item in s.expected.items:
            result = linker.link(item, thread)
            assert result.assertion is not None, (s.id, result.notes)
            assert result.assertion.applies_to, s.id
            assert not [n for n in result.notes if "unknown" in n], (s.id, result.notes)
            checked += 1
    assert checked >= 9


def test_noise_expects_nothing():
    assert SCENARIOS["noise-chitchat"].expected.items == []
    assert SCENARIOS["noise-chitchat"].incident is None


def test_trn305_does_not_bind_to_the_old_class():
    s = SCENARIOS["new-unit-trn305"]
    (item,) = s.expected.items
    assert item.scope.element_class is None
    assertion = Linker(INVENTORY).link(item, _thread(s)).assertion
    assert assertion.applies_to == {"TRN-305"}
    assert not any(b.entity.startswith("class:") for b in assertion.bound_to)
    old_class = SCENARIOS["elisa-trn042-chat"].expected.items[0].scope.element_class
    assert not old_class.matches(INVENTORY.elements["TRN-305"])


def test_disagreement_has_two_authors_and_same_class():
    a, b = SCENARIOS["expert-disagreement"].expected.items
    assert a.topic == b.topic and a.stated_by != b.stated_by and a.action != b.action
    assert a.scope.element_class == b.scope.element_class


def test_seed_is_consistent():
    ids = {e.id for e in SEED.elements}
    assert len(ids) == len(SEED.elements) >= 20
    site_ids = {s.id for s in SEED.sites}
    assert all(e.site_id in site_ids for e in SEED.elements)
    assert all(s.lat is not None and s.lon is not None for s in SEED.sites)
    assert {"TRN-042", "TRN-117", "TRN-208", "TRN-305", "RAD-221"} <= ids
    assert all(l.a in ids and l.b in ids for l in SEED.links)
    assert len({l.id for l in SEED.links}) == len(SEED.links)
    assert {e.id: e.origin for e in SEED.elements}["TRN-042"] == "elisa"
    assert {"erkki", "veikko"} <= {p.id for p in SEED.personas if p.origin == "elisa"}
    assert len({p.avatar_color for p in SEED.personas}) == len(SEED.personas)


def test_seed_threads():
    by_id = {t.id: t for t in SEED.threads}
    chat = by_id["elisa/teams_chat.json"]
    assert chat.origin == "elisa" and chat.status == "idle"
    assert chat.participants == ["Veikko Vikkelä", "Erkki Expert"]
    assert chat.created_at == chat.messages[0].sent_at and chat.last_message_at == chat.messages[-1].sent_at
    assert by_id["synthetic/teams_firmware_rollout.json"].origin == "synthetic"


# ---------------------------------------------------------------- simulator


class FakeWorkbench:
    """Only the facade methods the simulator uses."""

    def __init__(self):
        self.clock = SimClock(T0, speed=10, running=False)
        self.settings = Settings()
        self.scenarios = dict(SCENARIOS)
        self.runs: dict[str, ScenarioRun] = {}
        self.threads: dict[str, LiveThread] = {}
        self.incidents: dict[str, Incident] = {}
        self.posted: list[tuple[str, Message]] = []
        self.events: list[tuple[str, object]] = []

    def now(self):
        return self.clock.now()

    def emit(self, type, data):
        self.events.append((type, data))

    def persona(self, pid):
        return PERSONAS.get(pid)

    def create_thread(self, source, subject, participants, origin, scenario_id=None, incident_id=None):
        t = LiveThread(id=f"live/{len(self.threads):08x}", source=source, subject=subject, participants=participants,
                       origin=origin, scenario_id=scenario_id, created_at=self.now())
        self.threads[t.id] = t
        return t

    def open_incident(self, spec, origin, scenario_id=None, thread_id=None):
        inc = Incident(**spec.model_dump(), id=f"inc_{len(self.incidents) + 1:04d}", opened_at=self.now(),
                       thread_id=thread_id, scenario_id=scenario_id, origin=origin)
        self.incidents[inc.id] = inc
        return inc

    def resolve_incident(self, incident_id):
        inc = self.incidents[incident_id]
        inc.status, inc.resolved_at = "resolved", self.now()
        return inc

    def post_message(self, thread_id, author, text, role=None, persona_id=None, at=None, mirror=True):
        thread = self.threads[thread_id]
        m = Message(thread_id=thread_id, source=thread.source, seq=len(thread.messages) + 1, author=author, role=role,
                    sent_at=at or self.now(), text=text)
        thread.messages.append(m)
        self.posted.append((thread_id, m))
        return m

    def upsert_run(self, run):
        # like the real backend: allocates the id, and does not hand it back
        rid = run.id or f"run_{len(self.runs) + 1:04d}"
        self.runs[rid] = run.model_copy(update={"id": rid})


def test_simulator_posts_in_order_and_resolves():
    wb = FakeWorkbench()
    sim = Simulator(wb)
    run = sim.start_scenario("similar-trn117")
    scenario = SCENARIOS["similar-trn117"]
    assert run.id == "run_0001" and wb.runs[run.id].incident_id == "inc_0001"
    thread = wb.threads[run.thread_id]
    assert thread.source == "teams" and thread.participants[0] == "Jaakko Junnila"

    sim.tick()
    assert wb.posted == []  # clock paused, nothing due
    wb.clock.advance(scenario.messages[0].delay_s)
    sim.tick()
    assert [m.seq for _, m in wb.posted] == [1]
    assert wb.posted[0][1].author == "Jaakko Junnila" and wb.posted[0][1].role == "Junior Field Engineer"

    wb.clock.advance(sum(m.delay_s for m in scenario.messages[1:4]))
    sim.tick()
    assert [m.seq for _, m in wb.posted] == [1, 2, 3, 4]
    assert wb.incidents["inc_0001"].status == "open"

    wb.clock.advance(10_000)
    sim.tick()
    stored = wb.runs[run.id]
    assert [m.text for _, m in wb.posted] == [m.text for m in scenario.messages]
    assert wb.incidents["inc_0001"].status == "resolved" and stored.done
    times = [m.sent_at for _, m in wb.posted]
    assert times == sorted(times) and times[0] == run.started_at + timedelta(seconds=scenario.messages[0].delay_s)


def test_stop_run_and_unknown_scenario():
    wb = FakeWorkbench()
    sim = Simulator(wb)
    run = sim.start_scenario("noise-chitchat")
    sim.stop_run(run.id)
    wb.clock.advance(10_000)
    sim.tick()
    assert wb.posted == [] and wb.runs[run.id].done
    with pytest.raises(KeyError):
        sim.start_scenario("nope")


def test_loop_survives_errors():
    wb = FakeWorkbench()
    sim = Simulator(wb)
    sim.start_scenario("noise-chitchat")
    wb.post_message = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
    wb.clock.advance(10_000)
    sim.tick()  # must not raise
    assert any(t == "log" and d["level"] == "error" for t, d in wb.events)


def test_auto_mode_limits_active_runs():
    wb = FakeWorkbench()
    wb.settings.auto_sim, wb.settings.auto_every_s = True, 0
    wb.clock.start()
    sim = Simulator(wb)
    for _ in range(6):
        sim.tick()
    assert sum(1 for r in wb.runs.values() if not r.done) <= 3
    assert len(wb.runs) == 3
    assert len({r.scenario_id for r in wb.runs.values()}) == 3  # prefers scenarios not run recently


# ---------------------------------------------------------------- generator


class GenWorkbench:
    def __init__(self):
        self.elements = {e.id: e for e in SEED.elements}
        self.sites = {s.id: s for s in SEED.sites}
        self.personas = PERSONAS
        self.scenarios = SCENARIOS

    def now(self):
        return T0

    def persona(self, pid):
        return PERSONAS.get(pid)

    def inventory(self):
        return INVENTORY


def _canned(**changes) -> str:
    base = SCENARIOS["new-unit-trn305"].model_dump(mode="json")
    base.update(changes)
    return "```json\n" + json.dumps(base) + "\n```"


def _patch(monkeypatch, text):
    seen = {}

    def fake(system, user, json_mode=False, **kw):
        seen.update(kw, system=system, user=user)
        return text, []

    monkeypatch.setattr(llm, "complete_traced", fake)
    return seen


def test_generator_accepts_valid_reply(monkeypatch):
    seen = _patch(monkeypatch, _canned())
    s = generator.generate_scenario(GenWorkbench(), "TRN-305", "wrong VLAN")
    assert s.origin == "generated" and s.id.startswith("gen-") and len(s.id.rsplit("-", 1)[1]) == 4
    assert seen["purpose"] == "generate_scenario" and "TRN-305" in seen["user"] and "wrong VLAN" in seen["user"]


def test_generator_rejects_unknown_ids(monkeypatch):
    wb = GenWorkbench()
    bad_expected = SCENARIOS["new-unit-trn305"].model_dump(mode="json")["expected"]
    bad_expected["items"][0]["scope"]["instance_ids"] = ["TRN-999"]
    _patch(monkeypatch, _canned(expected=bad_expected))
    with pytest.raises(ValueError, match="TRN-999"):
        generator.generate_scenario(wb, "TRN-305")

    msgs = SCENARIOS["new-unit-trn305"].model_dump(mode="json")["messages"]
    msgs[0]["persona"] = "ghost"
    _patch(monkeypatch, _canned(messages=msgs))
    with pytest.raises(ValueError, match="ghost"):
        generator.generate_scenario(wb, "TRN-305")

    incident = SCENARIOS["new-unit-trn305"].model_dump(mode="json")["incident"]
    incident["entity_id"] = "TRN-777"
    _patch(monkeypatch, _canned(incident=incident))
    with pytest.raises(ValueError, match="TRN-777"):
        generator.generate_scenario(wb, "TRN-305")

    _patch(monkeypatch, "not json")
    with pytest.raises(ValueError):
        generator.generate_scenario(wb, "TRN-305")
    with pytest.raises(ValueError, match="Unknown element"):
        generator.generate_scenario(wb, "TRN-000")


def test_key_moved_closes_the_old_barrier_key():
    from context_layer.mvp.lifecycle import reconcile
    from context_layer.store import ContextStore

    linker, store = Linker(INVENTORY), ContextStore(INVENTORY)
    for sid in ("barrier-key-kemijarvi", "slack-key-moved"):
        s = SCENARIOS[sid]
        for item in s.expected.items:
            a, _ = store.add_assertion(linker.link(item, _thread(s)).assertion)
            reconcile(store, a)
    old = next(a for a in store.assertions.values() if a.topic == "site-access-barrier-key" and a.type == "access")
    assert old.valid_to is not None and old.closed_by
    assert any(a.topic == "site-access-barrier-key-depot" and a.valid_to is None for a in store.assertions.values())


def test_slack_scenarios_cover_the_workflow():
    slack = [s for s in SEED.scenarios if s.channel == "slack"]
    assert len(slack) >= 6
    assert any(s.expected and not s.expected.items for s in slack) or any(len(s.expected.items) == 1 and "noise" in s.tags for s in slack)
    assert any(s.expected and s.expected.items and s.expected.items[0].trust_level == "hunch" for s in slack)
