"""Chat generator for the endless company day (docs/workbench.md, "Company day").

Two modes, chosen per call:
- offline (default, no LLM, deterministic with a seed): take a hand-written scenario and re-target it to another
  element of the same type, replacing the element id, its aliases and its site consistently in the incident, the
  messages and the `expected` ground truth. Mix: ~60% a problem seen before (earlier knowledge gets reused),
  ~25% a new combination, ~15% noise.
- LLM (only when asked and configured): `generator.generate_scenario` with a hint built from knowledge gaps and recent
  incidents. Rate limited; any failure falls back to offline.
Generated scenarios are stored in wb.scenarios with origin "generated" (the last MAX_GENERATED are kept)."""

from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from datetime import datetime, timedelta
from typing import Any, Callable

from .. import config
from . import generator
from .contracts import Scenario
from .state import Workbench

log = logging.getLogger(__name__)

MAX_GENERATED = 50
LLM_MIN_INTERVAL_S = 90  # wall seconds between two LLM-generated chats
RECURRENCE_WINDOW = timedelta(hours=6)  # same scenario base + same element inside this sim window is a duplicate
SKIP_PREFIXES = ("adversarial-", "ambiguous-")  # retargeting these would change what they test


ONCALL_ROLES = ("noc", "field", "network", "radio")  # personas who answer at night and on weekends


def activity_level(dt: datetime) -> float:
    """How busy the company is at this sim time (Finnish business week, local time as the sim clock reads it).

    A multiplier in 0..1.2: it scales how often new chats start. Public holidays are ignored."""
    h = dt.hour + dt.minute / 60
    if dt.weekday() >= 5:
        return 0.1
    if h < 6 or h >= 22:
        return 0.05
    if h < 8:
        return 0.4
    if h < 16.5:
        if 11.5 <= h < 12.5:
            return 0.5
        return 1.2 if 8.5 <= h < 10.5 else 1.0
    return 0.25


def is_night(dt: datetime) -> bool:
    return dt.hour < 6 or dt.hour >= 22


class ChatGenerator:
    def __init__(self, wb: Workbench, seed: int = 2026, wall: Callable[[], float] = time.monotonic):
        self.wb = wb
        self.rng = random.Random(seed)
        self._wall = wall
        self._last_llm: float | None = None
        self._n = 0
        self._used: dict[str, int] = {}  # base scenario id -> times used
        self._avoid: set[str] = set()
        self._recent: list[tuple[str, str, datetime]] = []  # (base id, element id, sim time)

    # ------------------------------------------------------------ public

    async def generate(
        self, use_llm: bool = False, gaps: list[str] | None = None, avoid: set[str] | None = None
    ) -> Scenario | None:
        """One new scenario, already stored in wb.scenarios. None when nothing sensible can be built."""
        if use_llm and config.llm_configured() and self._llm_allowed():
            self._last_llm = self._wall()  # counts even when it fails: never hammer a broken endpoint
            try:
                entity, hint = self.llm_request(gaps or [])
                sc = await asyncio.to_thread(generator.generate_scenario, self.wb, entity, hint)
                return self._store(sc, "llm")
            except Exception as e:  # noqa: BLE001 - no key, rate limit, invalid JSON
                log.warning("chat generator: LLM failed (%s: %s), offline recombination used", type(e).__name__, e)
                self._log("warning", f"chat generator: LLM failed ({type(e).__name__}), offline recombination used")
        return self.offline(avoid=avoid)

    def _llm_allowed(self) -> bool:
        return self._last_llm is None or self._wall() - self._last_llm >= LLM_MIN_INTERVAL_S

    def prune(self, protect: set[str]) -> None:
        """Keep the last MAX_GENERATED generated scenarios; older ones go unless a run or an unprocessed thread needs them."""
        wb = self.wb
        gen = [s for s in wb.scenarios.values() if s.origin == "generated" and s.id.startswith("gen_")]
        needed = set(protect)
        needed |= {r.scenario_id for r in wb.runs.values() if not r.done}
        needed |= {t.scenario_id for t in wb.threads.values() if t.scenario_id and t.status not in ("processed", "error")}
        drop = [s.id for s in gen[:-MAX_GENERATED] if s.id not in needed]
        for sid in drop:
            del wb.scenarios[sid]
        if drop:
            wb._scenarios_event()

    def llm_request(self, gaps: list[str]) -> tuple[str | None, str | None]:
        """Entity and hint for `generator.generate_scenario`. Reads the state: call it on the loop thread."""
        wb = self.wb
        recent = [i for i in list(wb.incidents.values())[-5:]]
        parts = []
        if gaps:
            parts.append("Elements with no reusable knowledge yet: " + ", ".join(gaps[:5]) + ". Make the chat about one of them.")
        if recent:
            parts.append("Recent incidents (do not repeat them): " + "; ".join(f"{i.entity_id} {i.kind}" for i in recent))
        entity = gaps[0] if gaps and gaps[0] in wb.elements else None
        return entity, " ".join(parts) or None

    def store_llm(self, sc: Scenario) -> Scenario:
        """Register an LLM scenario in wb.scenarios (loop thread)."""
        return self._store(sc, "llm")

    # ------------------------------------------------------------ offline recombination

    def offline(self, now: datetime | None = None, avoid: set[str] | None = None) -> Scenario | None:
        wb, rng = self.wb, self.rng
        now = now or wb.now()
        self._recent = [r for r in self._recent if now - r[2] < RECURRENCE_WINDOW]
        bases = [
            s for s in wb.scenarios.values()
            if s.origin != "generated" and not s.id.startswith(SKIP_PREFIXES) and s.messages
        ]
        incident_bases = sorted((s for s in bases if s.incident and s.expected and s.expected.items), key=lambda s: s.id)
        noise_bases = sorted((s for s in bases if not s.incident and not (s.expected and s.expected.items)), key=lambda s: s.id)
        seen_kinds = {i.kind for i in wb.incidents.values()}
        quiet = activity_level(now) < 0.15  # night, weekend: incident chats only
        self._avoid = avoid or set()
        roll = rng.random()
        handover = wb.scenarios.get("slack-noc-handover")
        if now.weekday() == 0 and 7 <= now.hour < 9 and handover and rng.random() < 0.15:
            picks = [handover]  # the rare Monday-morning handover
        elif roll < 0.15 and noise_bases and not quiet:
            picks = [rng.choice(noise_bases)]
        elif roll < 0.75:  # a problem seen before
            seen = [s for s in incident_bases if s.incident.kind in seen_kinds or s.id in self._used]
            picks = [rng.choice(seen)] if seen else []
        else:  # a new combination: the least used base
            least = sorted(incident_bases, key=lambda s: (self._used.get(s.id, 0), s.id))
            picks = least[: max(1, len(least) // 3)]
            picks = [rng.choice(picks)] if picks else []
        if not picks:
            picks = [rng.choice(incident_bases or noise_bases)] if (incident_bases or noise_bases) else []
        for base in picks:
            sc = self._recombine(base, now)
            if sc is not None:
                return sc
        # the preferred pick was a duplicate everywhere: try any other base once
        for base in incident_bases:
            sc = self._recombine(base, now)
            if sc is not None:
                return sc
        return None

    def _targets(self, base: Scenario) -> list[Any]:
        """Elements of the same type as the base's element, best class match first; never the original."""
        wb = self.wb
        old = wb.elements.get(base.incident.entity_id)
        if old is None:
            return []
        crit = [i.scope.element_class for i in (base.expected.items if base.expected else []) if i.scope.element_class]
        pool = [e for e in wb.elements.values() if e.type == old.type and e.id != old.id]

        def rank(e) -> tuple:
            fits = all(c.matches(e) for c in crit)
            return (not fits, e.model != old.model, e.site_id == old.site_id, e.id)

        pool.sort(key=rank)
        fitting = [e for e in pool if rank(e)[0] is False]
        return fitting or pool

    def _recombine(self, base: Scenario, now: datetime) -> Scenario | None:
        wb, rng = self.wb, self.rng
        if base.incident is None:  # noise: same chat, fresh timings
            sc = self._clone(base, {}, now)
            return self._store(sc, base.id) if sc else None
        cands = self._targets(base)
        taken = {(b, e) for b, e, _ in self._recent}
        cands = [e for e in cands if (base.id, e.id) not in taken and e.id not in self._avoid]  # recurrence guard, burst
        if not cands:
            return None
        new = cands[0] if len(cands) == 1 else rng.choice(cands[: max(1, min(3, len(cands)))])
        old = wb.elements[base.incident.entity_id]
        mapping = {old.id: new.id}
        for a in old.aliases:
            mapping[a] = new.id
        old_site, new_site = wb.sites.get(old.site_id or ""), wb.sites.get(new.site_id or "")
        if old_site and new_site and old_site.id != new_site.id:
            mapping[old_site.id] = new_site.id
            mapping[old_site.name] = new_site.name
        elif old_site and not new_site:
            mapping[old_site.name] = "the site"
        sc = self._clone(base, mapping, now)
        if sc is None:
            return None
        self._recent.append((base.id, new.id, now))
        return self._store(sc, base.id)

    def _clone(self, base: Scenario, mapping: dict[str, str], now: datetime) -> Scenario | None:
        data = _replace(base.model_dump(mode="json"), mapping)
        rng = self.rng
        for i, m in enumerate(data["messages"]):
            if i:
                m["delay_s"] = round(max(3.0, m["delay_s"] * rng.uniform(0.7, 1.4)), 1)
        if is_night(now) and data.get("incident"):
            data["incident"]["severity"] = "critical"  # at night only critical incidents reach a chat
        if activity_level(now) < 0.15:
            self._to_oncall(data)
        data["origin"] = "generated"
        data["title"] = _replace(base.title, mapping)
        try:
            sc = Scenario.model_validate(data)
            generator._check(self.wb, sc)
        except Exception as e:  # noqa: BLE001
            log.warning("chat generator: recombined %s is invalid (%s)", base.id, e)
            return None
        return sc

    def _to_oncall(self, data: dict) -> None:
        """Night and weekends: swap people who would not be at work for on-call personas (when there are any)."""
        wb = self.wb
        oncall = sorted(p.id for p in wb.personas.values() if any(k in p.role.lower() for k in ONCALL_ROLES))
        if not oncall:
            return
        swap: dict[str, str] = {}
        for pid in [*data.get("participants", []), *(m["persona"] for m in data["messages"])]:
            p = wb.personas.get(pid)
            if pid not in swap and not (p and pid in oncall):
                swap[pid] = oncall[len(swap) % len(oncall)]
        for m in data["messages"]:
            m["persona"] = swap.get(m["persona"], m["persona"])
        data["participants"] = list(dict.fromkeys(swap.get(x, x) for x in data.get("participants", [])))
        names = {wb.personas[a].name: wb.personas[b].name for a, b in swap.items() if a in wb.personas}
        for item in (data.get("expected") or {}).get("items", []):
            item["stated_by"] = names.get(item["stated_by"], item["stated_by"])

    def _store(self, sc: Scenario, base_id: str) -> Scenario:
        wb = self.wb
        existing = [int(m.group(1)) for k in wb.scenarios if (m := re.match(r"gen_(\d+)-", k))]
        self._n = max(self._n, *existing) if existing else self._n
        self._n += 1
        sc.id = f"gen_{self._n:04d}-{base_id}"
        sc.origin = "generated"
        if "generated" not in sc.tags:
            sc.tags.append("generated")
        self._used[base_id] = self._used.get(base_id, 0) + 1
        wb.upsert_scenario(sc)
        self.prune(set())
        return sc

    def _log(self, level: str, text: str) -> None:
        try:
            self.wb.emit("log", {"level": level, "text": text})
        except Exception:  # noqa: BLE001
            pass


class LlmPrefetcher:
    """Fills a small queue of LLM scenarios in the background, so the company loop never waits for a model.

    At most `MAX_QUEUE` scenarios wait, at most one call per `LLM_MIN_INTERVAL_S` wall seconds; every failure logs one
    warning and doubles the wait (cap `BACKOFF_CAP_S`). The blocking call runs in a worker thread, everything that
    touches the Workbench runs on the loop thread. `pop()` is instant and returns None when nothing is ready."""

    MAX_QUEUE = 3
    BACKOFF_CAP_S = 600

    def __init__(self, chatgen: ChatGenerator, gaps: Callable[[], list[str]], wall: Callable[[], float] = time.monotonic,
                 generate: Callable[..., Scenario] | None = None, poll_s: float = 1.0):
        self.chatgen = chatgen
        self._gaps = gaps
        self._wall = wall
        self._generate = generate or generator.generate_scenario
        self.poll_s = poll_s
        self.enabled = False
        self.queue: list[Scenario] = []
        self._last: float | None = None
        self._failures = 0
        self._epoch = 0  # bumped by clear(): a result that comes back from an older epoch is dropped

    def wait_s(self) -> float:
        return LLM_MIN_INTERVAL_S if not self._failures else min(LLM_MIN_INTERVAL_S * 2**self._failures, self.BACKOFF_CAP_S)

    def enable(self, on: bool) -> None:
        self.enabled = on
        self.clear()

    def clear(self) -> None:
        self._epoch += 1
        self.queue.clear()

    def pop(self) -> Scenario | None:
        """Next ready scenario, stored in wb.scenarios; None when the queue is empty."""
        if not self.queue:
            return None
        sc = self.queue.pop(0)
        try:
            return self.chatgen.store_llm(sc)
        except Exception as e:  # noqa: BLE001
            log.warning("chat prefetch: could not store a scenario (%s)", e)
            return None

    async def run(self) -> None:
        while True:
            await asyncio.sleep(self.poll_s)
            try:
                await self.step()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - never dies
                log.warning("chat prefetch: %s: %s", type(e).__name__, e)

    async def step(self) -> bool:
        """One poll: maybe one LLM call. True when a scenario was queued."""
        if not self.enabled or len(self.queue) >= self.MAX_QUEUE or not config.llm_configured():
            return False
        now = self._wall()
        if self._last is not None and now - self._last < self.wait_s():
            return False
        self._last = now  # counts even when it fails
        epoch = self._epoch
        entity, hint = self.chatgen.llm_request(self._gaps())
        try:
            sc = await asyncio.to_thread(self._generate, self.chatgen.wb, entity, hint)
        except Exception as e:  # noqa: BLE001 - no key, rate limit, invalid JSON
            self._failures += 1
            log.warning("chat prefetch: LLM failed (%s: %s), next try in %.0f s", type(e).__name__, e, self.wait_s())
            self.chatgen._log("warning", f"chat prefetch: LLM failed ({type(e).__name__}), next try in {self.wait_s():.0f} s")
            return False
        self._failures = 0
        if epoch != self._epoch or not self.enabled:
            return False  # stopped or reset while the model was thinking
        self.queue.append(sc)
        return True


def _replace(obj: Any, mapping: dict[str, str]) -> Any:
    """Replace ids and names inside every string of a JSON-like structure. Ids match as whole tokens."""
    if not mapping:
        return obj
    if isinstance(obj, str):
        for old, new in sorted(mapping.items(), key=lambda kv: -len(kv[0])):
            obj = re.sub(rf"(?<![A-Za-z0-9-]){re.escape(old)}(?![A-Za-z0-9])", new, obj)
        return obj
    if isinstance(obj, list):
        return [_replace(x, mapping) for x in obj]
    if isinstance(obj, dict):
        return {k: _replace(v, mapping) for k, v in obj.items()}
    return obj
