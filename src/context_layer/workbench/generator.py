"""LLM scenario generator. PHASE 0 STUB. Owner: simulator agent."""

from __future__ import annotations

from .contracts import Scenario
from .state import Workbench


def generate_scenario(wb: Workbench, entity_id: str | None = None, hint: str | None = None) -> Scenario:
    """Blocking (the route runs it in asyncio.to_thread). Calls llm.complete_traced(purpose="generate_scenario"),
    validates the JSON into a Scenario with origin "generated" and an `expected` extraction,
    checks that personas and entity ids exist. Raises ValueError with a readable message on failure.
    Does not store it: the caller does wb.upsert_scenario()."""
    raise NotImplementedError
