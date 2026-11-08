"""Registers the loop v2 agents (critic, judge, outcome) as processor hooks.

Each agent is a module of the context_layer package with an install() function. Modules that do not exist
yet are skipped, so lots can land in any order without editing this file.
"""

from __future__ import annotations

import importlib
import logging

log = logging.getLogger(__name__)

AGENT_MODULES = ("critic", "judge", "outcome")
_installed: set[str] = set()


def install_all() -> list[str]:
    """Import each agent module and call its install(). Returns the names installed. Idempotent."""
    package = __package__.rpartition(".")[0]  # "context_layer"
    for name in AGENT_MODULES:
        if name in _installed:
            continue
        try:
            mod = importlib.import_module(f"{package}.{name}")
        except ImportError as e:
            if e.name != f"{package}.{name}":  # the module exists but one of its imports is broken
                log.warning("loop agent %s failed to import: %s", name, e)
            continue
        if callable(getattr(mod, "install", None)):
            mod.install()
            _installed.add(name)
    return sorted(_installed)
