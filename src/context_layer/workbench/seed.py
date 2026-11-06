"""Seed data loaders. Owner: simulator agent.

The backend calls load_seed() on first start and on "Reset to seed".
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from pathlib import Path

from .. import config, listen
from .contracts import LiveThread, Persona, Scenario, TopologyLink, WbElement, WbSite


@dataclass
class SeedData:
    elements: list[WbElement] = field(default_factory=list)  # data/synthetic CSV + data/workbench/topology.json
    sites: list[WbSite] = field(default_factory=list)  # with lat/lon from topology.json
    links: list[TopologyLink] = field(default_factory=list)
    personas: list[Persona] = field(default_factory=list)  # data/workbench/personas.json
    scenarios: list[Scenario] = field(default_factory=list)  # data/workbench/scenarios/*.json
    threads: list[LiveThread] = field(default_factory=list)  # historical threads from core discover_threads()


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _load_inventory(synthetic: Path, topology: dict) -> tuple[list[WbElement], list[WbSite]]:
    """CSV rows first, then topology.json entries; the topology wins when an id is in both."""
    elements: dict[str, WbElement] = {}
    with open(synthetic / "network_elements.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            origin = "elisa" if r["id"] == "TRN-042" else "synthetic"
            elements[r["id"]] = WbElement(
                id=r["id"],
                type=r["type"],
                model=r["model"],
                install_year=int(r["install_year"]),
                firmware=r["firmware"] or None,
                site_id=r["site_id"] or None,
                aliases=[a for a in r["aliases"].split("|") if a],
                origin=origin,
            )
    for raw in topology.get("elements", []):
        el = WbElement.model_validate(raw)
        elements[el.id] = el

    sites: dict[str, WbSite] = {}
    with open(synthetic / "sites.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            sites[r["id"]] = WbSite(**r)
    for raw in topology.get("sites", []):
        # topology entries add lat/lon (and new sites); a partial entry only updates the known site
        merged = {**(sites[raw["id"]].model_dump() if raw["id"] in sites else {}), **raw}
        sites[raw["id"]] = WbSite.model_validate(merged)
    return list(elements.values()), list(sites.values())


def _to_live(thread) -> LiveThread:
    authors: list[str] = []
    for m in thread.messages:
        if m.author not in authors:
            authors.append(m.author)
    first = min(m.sent_at for m in thread.messages)
    last = max(m.sent_at for m in thread.messages)
    return LiveThread(
        id=thread.id,
        source=thread.source,
        subject=thread.subject,
        messages=thread.messages,
        participants=authors,
        origin="elisa" if thread.id.startswith("elisa/") else "synthetic",
        status="idle",
        created_at=first,
        last_message_at=last,
    )


def load_seed(data_dir: Path | None = None) -> SeedData:
    """Elements/sites from data/synthetic (origin "synthetic", TRN-042 origin "elisa") merged with
    data/workbench/topology.json; historical threads from listen.discover_threads() converted to
    LiveThread (origin "elisa" for data/elisa/*, else "synthetic"; status "idle", created_at = first message).

    `data_dir` is the data folder (default: config.DATA_DIR)."""
    data_dir = data_dir or config.DATA_DIR
    wb_dir = data_dir / "workbench"
    topology = _read_json(wb_dir / "topology.json")
    elements, sites = _load_inventory(data_dir / "synthetic", topology)
    scenarios = [Scenario.model_validate(_read_json(p)) for p in (wb_dir / "scenarios").glob("*.json")]
    scenarios.sort(key=lambda s: (s.origin != "elisa", s.id))  # Elisa's first
    return SeedData(
        elements=sorted(elements, key=lambda e: e.id),
        sites=sorted(sites, key=lambda s: s.id),
        links=[TopologyLink.model_validate(x) for x in topology.get("links", [])],
        personas=[Persona.model_validate(x) for x in _read_json(wb_dir / "personas.json")],
        scenarios=scenarios,
        threads=[_to_live(t) for t in listen.discover_threads(data_dir)],
    )
