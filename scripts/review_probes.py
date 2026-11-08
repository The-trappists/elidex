"""Offline probes for the weaknesses listed in docs/backend-review.md.

Each probe runs the real code on a tiny, hand-made input and prints PRESENT (the weakness is still there) or
fixed. No LLM, no network, no .env. Run from the repo root:

    uv run python scripts/review_probes.py

Exit code 0 always: this is a checklist, not a test suite. Turn a probe into a test once its fix lands.
"""

from __future__ import annotations

import inspect
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from context_layer import llm, mcp_server, outcome
from context_layer.link import Inventory, Linker
from context_layer.models import ClassCriteria, ExtractedItem, Message, Outcome, Scope, Thread
from context_layer.mvp.lifecycle import reconcile
from context_layer.store import ContextStore
from context_layer.understand import LLMExtractor
from context_layer.dashboard.seed import load_seed

seed = load_seed()
INV = Inventory(seed.elements, seed.sites)
LINKER = Linker(INV)
T0 = datetime(2026, 10, 15, 9, 0)
results: list[tuple[str, bool, str]] = []


def probe(pid: str, title: str):
    def wrap(fn):
        try:
            present, detail = fn()
        except Exception as e:  # noqa: BLE001 - a probe that crashes is reported, not fatal
            present, detail = True, f"probe crashed: {type(e).__name__}: {e}"
        results.append((f"{pid} {title}", present, detail))
        return fn

    return wrap


def thread(tid: str, texts: list[str], author: str = "Erkki Expert", t0: datetime = T0) -> Thread:
    msgs = [Message(thread_id=tid, source="teams", seq=i + 1, author=author, role="Network Expert",
                    sent_at=t0 + timedelta(minutes=i), text=t) for i, t in enumerate(texts)]
    return Thread(id=tid, source="teams", messages=msgs)


def item(**kw) -> ExtractedItem:
    base = dict(type="workaround", topic="t", summary="s", scope=Scope(), trust_level="stated",
                stated_by="Erkki Expert", cited_seq=[1], confidence=0.9, action="bounce the interface")
    return ExtractedItem(**(base | kw))


TH = thread("probe", ["On TRN-117 bounce the interface after the SFP swap."])


@probe("L1", "class that excludes the cited unit is still bound")
def _():
    it = item(scope=Scope(instance_ids=["TRN-117"],
                          element_class=ClassCriteria(type="transmission_node", install_year_min=2020)))
    r = LINKER.link(it, TH)
    bound = [b.entity for b in r.assertion.bound_to] if r.assertion else []
    return any(e.startswith("class:") for e in bound), f"TRN-117 is from 2018, bound: {bound}"


@probe("L2", "class with no type and no model (year only) is bound")
def _():
    it = item(scope=Scope(instance_ids=["TRN-117"], element_class=ClassCriteria(install_year_min=2018, install_year_max=2018)))
    r = LINKER.link(it, TH)
    members = [e.id for c in r.classes for e in INV.elements.values() if c.criteria.matches(e)]
    return bool(r.classes), f"members: {members}"


@probe("L3", "element id the thread never names is bound")
def _():
    r = LINKER.link(item(scope=Scope(instance_ids=["TRN-042", "TRN-131"])), TH)
    bound = [b.entity for b in r.assertion.bound_to] if r.assertion else []
    return bool(bound), f"thread names TRN-117 only, bound: {bound}"


@probe("L4", "stated_by is not checked against the thread authors")
def _():
    r = LINKER.link(item(scope=Scope(instance_ids=["TRN-117"]), stated_by="Matti Somebody"), TH)
    who = r.assertion.trust.stated_by if r.assertion else None
    return who == "Matti Somebody", f"thread written by Erkki Expert, stored stated_by: {who!r}"


@probe("R1", "invalidation over the same elements but another class id does not close the rule")
def _():
    store = ContextStore(INV)
    rule = LINKER.link(item(topic="sfp", scope=Scope(element_class=ClassCriteria(
        type="transmission_node", model="TX-3000", install_year_max=2018))), thread("a", ["old TX-3000: bounce"]))
    for c in rule.classes:
        store.add_class(c)
    old, _ = store.add_assertion(rule.assertion)
    inv_item = item(type="invalidation", topic="sfp", action=None,
                    scope=Scope(element_class=ClassCriteria(type="transmission_node", install_year_max=2019)))
    r2 = LINKER.link(inv_item, thread("b", ["firmware 4.2 fixes it"], t0=T0 + timedelta(days=10)))
    for c in r2.classes:
        store.add_class(c)
    new, _ = store.add_assertion(r2.assertion)
    reconcile(store, new)
    return old.valid_to is None, f"rule {sorted(old.applies_to)} vs invalidation {sorted(new.applies_to)}"


@probe("S1", "two different facts from two people are merged into one")
def _():
    store = ContextStore(INV)
    said = (("Pirjo", "caused by the floor scrubber"), ("Helmi", "caused by a faulty chassis fan"))
    # Both people write in the thread: the linker keeps a stated_by only when that person wrote there.
    th = Thread(id="probe-s1", source="teams", messages=[
        Message(thread_id="probe-s1", source="teams", seq=i, author=who, sent_at=T0 + timedelta(minutes=i),
                text=f"TRN-117 vibration is {fact}") for i, (who, fact) in enumerate(said, 1)])
    for i, (who, fact) in enumerate(said, 1):
        a = LINKER.link(item(type="fact", topic="vibration", action=None, fact=fact, stated_by=who, cited_seq=[i],
                             scope=Scope(instance_ids=["TRN-117"])), th).assertion
        store.add_assertion(a)
    return len(store.assertions) == 1, f"{len(store.assertions)} assertion(s) stored for 2 different facts"


@probe("O1", "outcome keyword heuristic reads 'UP but still no traffic' as worked")
def _():
    texts = ["Link is UP but still no traffic", "I'll get back to you after lunch"]
    got = []
    for text in texts:
        h = outcome.heuristic([Message(thread_id="x", source="teams", seq=1, author="V", sent_at=T0, text=text)])
        got.append(h[0] if h else "unclear")
    return "worked" in got, dict(zip(texts, got)).__repr__()


@probe("O2", "a technician's confirmation overwrites who stated the rule")
def _():
    class _Wb:
        def add_flag(self, *a, **k):
            pass

    a = LINKER.link(item(topic="sfp", scope=Scope(instance_ids=["TRN-117"])), TH).assertion
    o = Outcome(entity="TRN-117", at=T0, worked=True, evidence="", source="thread", quote="traffic is back")
    a.outcomes.append(o)
    outcome.settle(_Wb(), a, o, thread_id="x", job_id="j", author="Veikko Field")
    return a.trust.stated_by != "Erkki Expert", f"stated_by is now {a.trust.stated_by!r}"


@probe("U1", "an invalid JSON answer is not retried (no repair, no fallback)")
def _():
    calls = []

    def fake_call(p, system, user, **kw):
        calls.append(1)
        text = "{not json" if len(calls) == 1 else '{"items": []}'
        return text, {"id": "x", "error": None, "provider": p.name}, None

    saved = llm.providers, llm.call_provider
    llm.providers = lambda role="primary", model=None: [llm.Provider("primary", "", "k", "m", "json_object")]
    llm.call_provider = fake_call
    try:
        with tempfile.TemporaryDirectory() as tmp:
            LLMExtractor(cache_path=Path(tmp) / "cache.json").extract(TH, [])
        return False, f"recovered after {len(calls)} call(s)"
    except Exception as e:  # noqa: BLE001
        return True, f"raised {type(e).__name__} after {len(calls)} call(s)"
    finally:
        llm.providers, llm.call_provider = saved


@probe("A1", "MCP get_context takes no observations (no check status for external agents)")
def _():
    params = list(inspect.signature(mcp_server.get_context).parameters)
    return "observations" not in params, f"parameters: {params}"


@probe("A2", "MCP tools read the CLI store file, not the live dashboard")
def _():
    src = inspect.getsource(mcp_server._store)
    return "STORE_FILE" in src, "mcp_server._store loads config.STORE_FILE on every call"


if __name__ == "__main__":
    width = max(len(r[0]) for r in results)
    for name, present, detail in results:
        print(f"{'PRESENT' if present else 'fixed  '}  {name:<{width}}  {detail}")
    print(f"\n{sum(p for _, p, _ in results)} of {len(results)} still present")
