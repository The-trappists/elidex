"""Listen -> Understand -> Link -> Store, end to end."""

from dataclasses import dataclass, field
from pathlib import Path

from . import config
from .link import Inventory, Linker
from .listen import discover_threads
from .mvp.lifecycle import reconcile
from .store import ContextStore
from .understand import make_extractor


@dataclass
class BuildReport:
    threads: list[str] = field(default_factory=list)
    extracted: int = 0
    stored: int = 0
    merged: int = 0
    notes: list[str] = field(default_factory=list)
    events: list[str] = field(default_factory=list)


def build_store(use_llm: bool = False, lifecycle: bool = False, data_dir: Path | None = None) -> tuple[ContextStore, BuildReport]:
    data_dir = data_dir or config.DATA_DIR
    inventory = Inventory.load(data_dir / "synthetic")
    store = ContextStore(inventory)
    linker = Linker(inventory)
    extractor = make_extractor(use_llm)
    report = BuildReport()

    for thread in discover_threads(data_dir):
        report.threads.append(thread.id)
        known_topics = sorted({a.topic for a in store.assertions.values()})
        for item in extractor.extract(thread, known_topics):
            report.extracted += 1
            if item.type == "invalidation" and not lifecycle:
                report.notes.append(f"{thread.id}: skipped invalidation of '{item.topic}' (enable --lifecycle)")
                continue
            result = linker.link(item, thread)
            report.notes += [f"{thread.id}: {n}" for n in result.notes]
            if result.assertion is None:
                continue
            for cls in result.classes:
                store.add_class(cls)
            stored, is_new = store.add_assertion(result.assertion)
            if is_new:
                report.stored += 1
                if lifecycle:
                    report.events += reconcile(store, stored)
            else:
                report.merged += 1
                report.events.append(f"{thread.id}: merged into {stored.id} (same knowledge, another channel)")
    return store, report
