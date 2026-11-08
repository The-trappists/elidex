"""LLM scenario generator. Owner: simulator agent."""

from __future__ import annotations

import json
import random
import re
import secrets

from .. import llm
from ..models import OBSERVABLE_FIELDS
from .contracts import Scenario
from .state import Dashboard

SYSTEM = """You write short, realistic chat scenarios for a test bench. Fake telecom employees chat about a scripted network incident, and a pipeline later extracts the human knowledge from the chat.

Rules:
- Humans state knowledge in passing, as they would in a real chat. Keep noise around it (greetings, jokes, small talk).
- Never diagnose from telemetry: the incident only gives what people observe. Do not invent a fault detector.
- Use only the persona ids, element ids and site ids given below.
- delay_s is in simulated seconds: 8 to 15 between two messages of the same person (a burst), 20 to 180 otherwise.
- `expected` is the ground truth extraction. Every item must bind to real ids (instance_ids, site_ids) and use conservative class criteria: model plus install year range, never a bare type.
- Condition checks may only use these observable fields: {fields}.
- trust_level: "hunch" (hedged), "stated" (someone says it), "verified" (an outcome in the chat confirms it). stated_by is the exact persona name. cited_seq is 1-based message numbers.
- If the chat has no reusable knowledge, set expected to {{"items": []}}.
- Set origin to "generated". Reply with one JSON object that follows the schema, nothing else.

Make it sound human, not like a report:
- Write each persona in their own voice (their `style` below). Do not give everybody the same polite full sentences.
- Messages are chat messages: lower case starts, "ok", "hmm", "tho", "lol", emoji, a single word on its own line ("wait"), sometimes two or three short messages in a row from the same person instead of one long one.
- Nobody announces "note this down" or summarises the lesson for the pipeline. The knowledge comes out as a reaction ("it's the mount, not the radio"), an objection or a side remark.
- Use at least three of these realistic moves: someone hedges or is unsure; someone interrupts or answers a question nobody asked; a side topic (coffee, key, parking, weather) appears and fades; a correction ("no wait, I meant..."); a disagreement that stays polite; a short reaction only (👍, ✅); a long first message from a junior who thanks everyone.
- A few Finnish interjections are welcome and must stay light and understandable: Hei, Moi, joo, kiitos, kahvi, hyvä. Everything else is English.
- Slack channels: set `subject` to a channel like "#field-north" and, to mimic a thread, start each reply of the thread with "↳ ". Teams chats keep a plain subject.
- The knowledge must come from something a person says or sees, with a concrete detail (a breaker label, a time of day, a firmware version), not a generic best practice."""

USER = """Personas (id, name, role, style):
{personas}

Target element: {element}
Its site: {site}
{hint}
Format examples (two scenarios already in the seed, note how loose the wording is):
{example}

JSON schema of a scenario:
{schema}
"""


def _strip_fences(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```[a-zA-Z]*\s*\n?(.*?)\n?```$", text, re.DOTALL)
    return (m.group(1) if m else text).strip()


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "scenario"


def _pick_element(wb: Dashboard, entity_id: str | None):
    if entity_id:
        el = wb.elements.get(entity_id)
        if el is None:
            raise ValueError(f"Unknown element '{entity_id}'")
        return el
    if not wb.elements:
        raise ValueError("There are no elements to build a scenario on")
    pool = sorted(wb.elements.values(), key=lambda e: e.install_year)
    return random.choice(pool[: max(1, len(pool) // 3)])  # one of the older third


def _check(wb: Dashboard, scenario: Scenario) -> None:
    """Personas and entity ids must exist. Raises ValueError with a readable message."""
    problems: list[str] = []
    inv = wb.inventory()
    for pid in [*scenario.participants, *(m.persona for m in scenario.messages)]:
        if wb.persona(pid) is None:
            problems.append(f"unknown persona '{pid}'")
    if not scenario.messages:
        problems.append("no messages")
    if scenario.incident and scenario.incident.entity_id not in wb.elements:
        problems.append(f"incident entity '{scenario.incident.entity_id}' is not an element")
    for item in scenario.expected.items if scenario.expected else []:
        for raw in item.scope.instance_ids:
            if inv.resolve_element(raw) is None:
                problems.append(f"expected '{item.topic}': unknown element '{raw}'")
        for raw in item.scope.site_ids:
            if inv.resolve_site(raw) is None:
                problems.append(f"expected '{item.topic}': unknown site '{raw}'")
        known = {wb.persona(m.persona).name for m in scenario.messages if wb.persona(m.persona)}
        if item.stated_by not in known:
            problems.append(f"expected '{item.topic}': stated_by '{item.stated_by}' is not a persona in the chat")
    if problems:
        raise ValueError("Invalid generated scenario: " + "; ".join(sorted(set(problems))))


def _parse(wb: Dashboard, text: str) -> Scenario:
    try:
        scenario = Scenario.model_validate_json(_strip_fences(text))
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"Invalid generated scenario: the reply is not a valid Scenario ({e})") from e
    scenario.origin = "generated"
    scenario.id = f"gen-{_slug(scenario.title)}-{secrets.token_hex(2)}"
    _check(wb, scenario)
    return scenario


def generate_scenario(wb: Dashboard, entity_id: str | None = None, hint: str | None = None) -> Scenario:
    """Blocking (the route runs it in asyncio.to_thread). Calls llm.complete_traced(purpose="generate_scenario"),
    validates the JSON into a Scenario with origin "generated" and an `expected` extraction,
    checks that personas and entity ids exist. Raises ValueError with a readable message on failure.
    Does not store it: the caller does wb.upsert_scenario()."""
    el = _pick_element(wb, entity_id)
    site = wb.sites.get(el.site_id) if el.site_id else None
    personas = "\n".join(f"- {p.id} | {p.name} | {p.role} | {p.style}" for p in wb.personas.values())
    examples = [wb.scenarios.get(i) for i in ("elisa-trn042-chat", "slack-radio-tilt")]
    system = SYSTEM.format(fields="; ".join(f"{k} ({v})" for k, v in OBSERVABLE_FIELDS.items()))
    user = USER.format(
        personas=personas,
        element=json.dumps(el.model_dump(), ensure_ascii=False),
        site=json.dumps(site.model_dump(), ensure_ascii=False) if site else "none",
        hint=f"Hint from the team: {hint}\n" if hint else "",
        example="\n\n".join(e.model_dump_json(exclude_none=True) for e in examples if e) or "(not available)",
        schema=json.dumps(Scenario.model_json_schema()),
    )
    text, _traces = llm.complete_traced(
        system,
        user,
        json_mode=True,
        schema=Scenario.model_json_schema(),
        purpose="generate_scenario",
        sim_time=wb.now(),
        validate=lambda t: _parse(wb, t),
    )
    return _parse(wb, text)
