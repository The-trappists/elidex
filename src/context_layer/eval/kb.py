"""Build the knowledge base the evaluation runs on: replay the labelled workbench scenarios, in time order,
through the real pipeline (extract -> link -> store -> lifecycle).

Extractors:
- "scripted": the scenario labels themselves (an oracle). Isolates linking and retrieval from extraction.
- "llm": the real LLM extractor; answers are cached in out/eval/extractions.json.
- "cache": replays that cache offline, so an LLM run can be re-scored without new calls.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from .. import config
from ..link import Inventory, Linker
from ..models import ExtractedItem, Message, Thread
from ..mvp.lifecycle import reconcile
from ..store import ContextStore
from ..workbench.contracts import Scenario
from ..workbench.seed import load_seed

ExtractorMode = Literal["scripted", "llm", "cache"]

EVAL_FILE = config.DATA_DIR / "eval" / "retrieval_cases.json"
EVAL_OUT = config.OUT_DIR / "eval"
EXTRACTION_CACHE = EVAL_OUT / "extractions.json"


class TimelineEntry(BaseModel):
    scenario: str
    start: datetime


class RetrievalCase(BaseModel):
    id: str
    why: str
    entity_id: str
    at: datetime
    observations: dict = Field(default_factory=dict)
    expect: list[str]  # "type:topic" keys that must come back
    acceptable: list[str] = Field(default_factory=list)  # related: neither required nor counted as noise


class EvalSpec(BaseModel):
    timeline: list[TimelineEntry]
    cases: list[RetrievalCase]


def load_spec(path: Path = EVAL_FILE) -> EvalSpec:
    return EvalSpec.model_validate(json.loads(path.read_text(encoding="utf-8")))


def key(item_type: str, topic: str) -> str:
    return f"{item_type}:{topic}"


def scenario_thread(scenario: Scenario, start: datetime, personas: dict) -> Thread:
    t, msgs = start, []
    for i, m in enumerate(scenario.messages, 1):
        if i > 1:
            t += timedelta(seconds=m.delay_s)
        p = personas[m.persona]
        msgs.append(Message(thread_id=scenario.id, source=scenario.channel, seq=i, author=p.name, role=p.role,
                            sent_at=t, text=m.text))
    return Thread(id=scenario.id, source=scenario.channel, subject=scenario.subject, messages=msgs)


@dataclass
class ThreadRun:
    scenario: Scenario
    thread: Thread
    extracted: list[ExtractedItem]
    stored: list[str] = field(default_factory=list)  # assertion ids
    notes: list[str] = field(default_factory=list)


@dataclass
class KnowledgeBase:
    store: ContextStore
    inventory: Inventory
    runs: list[ThreadRun]
    extractor: str


def _extractor(mode: ExtractorMode):
    if mode == "scripted":
        return lambda s, t, topics: list(s.expected.items) if s.expected else []
    from ..understand import CachedExtractor, LLMExtractor

    if mode == "cache":
        if not EXTRACTION_CACHE.exists():
            raise FileNotFoundError(f"No {EXTRACTION_CACHE}: run `ctx eval --extractor llm` once first.")
        cached = CachedExtractor(EXTRACTION_CACHE)
        return lambda s, t, topics: cached.extract(t, topics)
    EVAL_OUT.mkdir(parents=True, exist_ok=True)
    live = LLMExtractor(cache_path=EXTRACTION_CACHE)
    return lambda s, t, topics: live.extract(t, topics)


def build_kb(spec: EvalSpec, mode: ExtractorMode = "scripted") -> KnowledgeBase:
    seed = load_seed()
    scenarios = {s.id: s for s in seed.scenarios}
    personas = {p.id: p for p in seed.personas}
    inventory = Inventory(seed.elements, seed.sites)
    store, linker, extract = ContextStore(inventory), Linker(inventory), _extractor(mode)
    runs = []
    for entry in sorted(spec.timeline, key=lambda e: e.start):
        scenario = scenarios[entry.scenario]
        thread = scenario_thread(scenario, entry.start, personas)
        known_topics = sorted({a.topic for a in store.assertions.values()})
        run = ThreadRun(scenario, thread, extract(scenario, thread, known_topics))
        for item in run.extracted:
            result = linker.link(item, thread)
            run.notes += result.notes
            if result.assertion is None:
                continue
            for cls in result.classes:
                store.add_class(cls)
            stored, is_new = store.add_assertion(result.assertion)
            run.stored.append(stored.id)
            if is_new:
                reconcile(store, stored)
        runs.append(run)
    return KnowledgeBase(store, inventory, runs, mode)
