"""Save and load the whole Workbench state as one JSON file (also used by export and import)."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..models import ContextAssertion, ElementClass
from .contracts import (
    AssertionEdit,
    DedupeMerge,
    Incident,
    LiveThread,
    LlmCall,
    Persona,
    PipelineJob,
    ReviewFlag,
    RuleApplication,
    Scenario,
    ScenarioRun,
    Settings,
    TopologyLink,
    WbElement,
    WbSite,
)

if TYPE_CHECKING:
    from .state import Workbench

READONLY_SETTINGS = {"llm_configured", "llm_model", "llm_fallback_model", "slack_connected"}
MAX_JOBS = 200


def state_to_dict(wb: Workbench) -> dict[str, Any]:
    def dump(items) -> list[dict]:
        return [i.model_dump(mode="json") for i in items]

    return {
        "version": 1,
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "clock": {"sim_now": wb.clock.now().isoformat(), "speed": wb.clock.speed},
        "settings": wb.settings.model_dump(mode="json", exclude=READONLY_SETTINGS),
        "elements": dump(wb.elements.values()),
        "sites": dump(wb.sites.values()),
        "links": dump(wb.links.values()),
        "personas": dump(wb.personas.values()),
        "threads": dump(wb.threads.values()),
        "incidents": dump(wb.incidents.values()),
        "scenarios": dump(wb.scenarios.values()),
        "runs": dump(wb.runs.values()),
        "assertions": dump(wb.store.assertions.values()),
        "classes": dump(wb.store.classes.values()),
        "jobs": dump(list(wb.jobs.values())[-MAX_JOBS:]),
        "flags": dump(wb.flags.values()),
        "edits": dump(wb.edits.values()),
        "applications": dump(wb.applications.values()),
        "dedupe": {"total": getattr(wb, "dedupe_total", 0), "merges": dump(getattr(wb, "dedupe_merges", []))},
    }


def validate_refs(elements, sites, links) -> list[str]:
    """Dangling references, with the same rules as the REST API (422): an element's site, a link's two ends."""
    site_ids, element_ids = {s.id for s in sites}, {e.id for e in elements}
    problems = [f"element {e.id}: unknown site {e.site_id}" for e in elements if e.site_id is not None and e.site_id not in site_ids]
    for link in links:
        problems += [f"link {link.id}: unknown element {end}" for end in (link.a, link.b) if end not in element_ids]
    return problems


def apply_state(wb: Workbench, data: dict[str, Any]) -> None:
    """Replace the whole state of `wb` with `data` (validates everything first)."""

    def parse(key: str, model) -> list:
        return [model.model_validate(x) for x in data.get(key, [])]

    elements, sites = parse("elements", WbElement), parse("sites", WbSite)
    links, personas = parse("links", TopologyLink), parse("personas", Persona)
    threads, incidents = parse("threads", LiveThread), parse("incidents", Incident)
    scenarios, runs = parse("scenarios", Scenario), parse("runs", ScenarioRun)
    assertions, classes = parse("assertions", ContextAssertion), parse("classes", ElementClass)
    jobs = parse("jobs", PipelineJob)
    flags, edits = parse("flags", ReviewFlag), parse("edits", AssertionEdit)
    applications = parse("applications", RuleApplication)
    settings = Settings.model_validate({**Settings().model_dump(), **data.get("settings", {})})
    clock = data.get("clock") or {}

    wb.elements = {x.id: x for x in elements}
    wb.sites = {x.id: x for x in sites}
    wb.links = {x.id: x for x in links}
    wb.personas = {x.id: x for x in personas}
    for t in threads:
        if t.status == "processing":  # the app stopped in the middle of a job
            t.status = "idle"
    wb.threads = {x.id: x for x in threads}
    wb.incidents = {x.id: x for x in incidents}
    wb.scenarios = {x.id: x for x in scenarios}
    wb.runs = {x.id: x for x in runs}
    wb.jobs = {x.id: x for x in jobs}
    wb.flags = {x.id: x for x in flags}
    wb.edits = {x.id: x for x in edits}
    wb.applications = {x.id: x for x in applications}
    ded = data.get("dedupe") or {}
    wb.dedupe_merges = [DedupeMerge.model_validate(x) for x in ded.get("merges", [])][:200]
    wb.dedupe_total = int(ded.get("total", len(wb.dedupe_merges)))
    wb.settings = settings
    wb.refresh_readonly_settings()
    wb.rebuild_store(classes=classes, assertions=assertions)
    if clock.get("sim_now"):
        wb.clock.set(datetime.fromisoformat(clock["sim_now"]))
    if clock.get("speed"):
        wb.clock.speed = float(clock["speed"])


def save_state(wb: Workbench, path: Path) -> None:
    """Atomic write: temp file in the same folder, then rename."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(state_to_dict(wb), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def load_state(path: Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_llm_calls(path: Path) -> list[LlmCall]:
    """Every call in the JSONL file, oldest first. Bad lines are skipped."""
    path = Path(path)
    if not path.exists():
        return []
    calls = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            calls.append(LlmCall.model_validate_json(line))
        except Exception:  # noqa: BLE001
            continue
    return calls
