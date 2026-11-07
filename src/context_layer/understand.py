"""Understand: keep the one sentence of real knowledge in a thread, as a structured item.

Two extractors with the same interface:
- LLMExtractor calls the model and writes its answer to the cache;
- CachedExtractor replays the cache (offline, deterministic: safe for a live demo).
"""

import json
import logging
import re
from pathlib import Path
from typing import Protocol

from . import config, llm
from .models import OBSERVABLE_FIELDS, ExtractedItem, ExtractionResult, Thread

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You extract operational knowledge that network specialists share in chats and emails, so that AI agents can reuse it later without asking them.

Rules:
- Most messages are not knowledge. Keep only reusable rules or facts: workarounds, site access, why a config is odd, what actually fixed a problem. Return {{"items": []}} if there is none.
- Extract the knowledge as the humans state it. Never diagnose faults yourself.
- Scope: copy element and site IDs exactly as written. Fill element_class (type, model, install-year range) only as far as the text supports it; leave fields null rather than overgeneralise. A wrong link is worse than none.
- Topics: reuse a known topic only when it is the same advice for the same problem on the same kind of element. A different problem, or a different advice for the same problem, gets its own topic slug. Never attach knowledge to a known topic just because the words look similar.
- When two people recommend different things for the same problem, extract each person's position as its own item (same topic, different stated_by and action), even if the thread ends with one of them following the other's advice.
- type: "workaround" for what to do or avoid, "access" for how to reach or enter a site, "fact" only for a statement with no action attached.
- Copy site names and IDs as written; do not shorten an ID such as SITE-NF-017.
- trust_level: "hunch" for guesses and hedges, "stated" for an expert's claim, "verified" when a later message reports the outcome (e.g. "traffic is back").
- type "invalidation": a message says earlier knowledge is no longer true (fixed by firmware, new lock...). Reuse the topic of the knowledge it closes.
- conditions: add a machine check {{field, op, value}} only for these observable fields: {fields}. Otherwise check is null.
- cited_seq: the seq numbers of the messages that carry the knowledge.
- Element types use snake_case, e.g. transmission_node, radio_unit.

Reply with JSON only, matching this JSON schema:
{schema}"""


class Extractor(Protocol):
    def extract(self, thread: Thread, known_topics: list[str]) -> list[ExtractedItem]: ...


def _load_cache(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


class CachedExtractor:
    def __init__(self, path: Path = config.CACHE_FILE):
        self.cache = _load_cache(path)

    def extract(self, thread: Thread, known_topics: list[str]) -> list[ExtractedItem]:
        if thread.id not in self.cache:
            log.warning("no cached extraction for %s (run with --llm to create one)", thread.id)
            return []
        return ExtractionResult.model_validate(self.cache[thread.id]).items


class LLMExtractor:
    """One call per thread. `last_traces` holds the LLM trace dicts of the latest extract() call."""

    def __init__(self, cache_path: Path = config.CACHE_FILE):
        self.cache_path = cache_path
        fields = ", ".join(f"{k} ({v})" for k, v in OBSERVABLE_FIELDS.items())
        self.schema = ExtractionResult.model_json_schema()
        self.system = SYSTEM_PROMPT.format(fields=fields, schema=json.dumps(self.schema))
        self.last_traces: list[dict] = []

    @staticmethod
    def parse(raw: str) -> ExtractionResult:
        raw = re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip()
        return ExtractionResult.model_validate_json(raw)

    def extract(self, thread: Thread, known_topics: list[str], sim_time=None) -> list[ExtractedItem]:
        user = f"Known topics (reuse one for the same knowledge): {', '.join(known_topics) or 'none'}\n\n{thread.render()}"
        raw, self.last_traces = llm.complete_traced(
            self.system,
            user,
            json_mode=True,
            schema=self.schema,
            purpose="extract",
            thread_id=thread.id,
            sim_time=sim_time,
            validate=self.parse,
        )
        result = self.parse(raw)
        self._save(thread.id, result)
        return result.items

    def _save(self, thread_id: str, result: ExtractionResult) -> None:
        cache = _load_cache(self.cache_path)
        cache[thread_id] = result.model_dump(mode="json")
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def make_extractor(use_llm: bool = False) -> Extractor:
    if use_llm:
        if not config.llm_configured():
            raise RuntimeError("--llm needs LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in .env")
        return LLMExtractor()
    return CachedExtractor()
