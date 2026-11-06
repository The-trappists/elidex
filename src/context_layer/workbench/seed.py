"""Seed data loaders. PHASE 0 STUB. Owner: simulator agent.

The backend calls load_seed() on first start and on "Reset to seed".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .contracts import LiveThread, Persona, Scenario, TopologyLink, WbElement, WbSite


@dataclass
class SeedData:
    elements: list[WbElement] = field(default_factory=list)  # data/synthetic CSV + data/workbench/topology.json
    sites: list[WbSite] = field(default_factory=list)  # with lat/lon from topology.json
    links: list[TopologyLink] = field(default_factory=list)
    personas: list[Persona] = field(default_factory=list)  # data/workbench/personas.json
    scenarios: list[Scenario] = field(default_factory=list)  # data/workbench/scenarios/*.json
    threads: list[LiveThread] = field(default_factory=list)  # historical threads from core discover_threads()


def load_seed(data_dir: Path | None = None) -> SeedData:
    """Elements/sites from data/synthetic (origin "synthetic", TRN-042 origin "elisa") merged with
    data/workbench/topology.json; historical threads from listen.discover_threads() converted to
    LiveThread (origin "elisa" for data/elisa/*, else "synthetic"; status "idle", created_at = started_at)."""
    raise NotImplementedError
