"""Read-only views over the generated company, shared by the knowledge and chatter generators."""

from __future__ import annotations

import bisect
import zlib
from datetime import datetime, timedelta
from random import Random

from .network import Network
from .people import People

T0 = datetime(2025, 1, 6, 0, 0)  # start of the conversation history (a Monday)
T1 = datetime(2026, 11, 6, 23, 59)  # the day before the hackathon
HOUR_WEIGHTS = [1, 1, 1, 1, 1, 2, 4, 8, 12, 14, 14, 12, 10, 12, 14, 14, 12, 9, 6, 4, 3, 2, 2, 1]


def office_time(rng: Random, lo: datetime = T0, hi: datetime = T1) -> datetime:
    """A random moment in [lo, hi), mostly in office hours and on weekdays."""
    days = max(1, (hi - lo).days)
    while True:
        day = lo + timedelta(days=rng.randrange(days))
        if day.weekday() < 5 or rng.random() < 0.15:
            break
    hour = rng.choices(range(24), HOUR_WEIGHTS)[0]
    t = day.replace(hour=hour, minute=rng.randrange(60), second=rng.randrange(60))
    return min(max(t, lo), hi)


class World:
    def __init__(self, network: Network, people: People):
        self.network, self.people = network, people
        self.sites = {s["id"]: s for s in network.sites}
        self.elements = network.elements
        self.by_model: dict[str, list[dict]] = {}
        self.by_type: dict[str, list[dict]] = {}
        self.by_region: dict[str, list[dict]] = {}
        self.by_site: dict[str, list[dict]] = {}
        for e in self.elements:
            self.by_model.setdefault(e["model"], []).append(e)
            self.by_type.setdefault(e["type"], []).append(e)
            site = self.sites.get(e["site_id"])
            if site:
                self.by_site.setdefault(site["id"], []).append(e)
                if e["type"] != "power_system":
                    self.by_region.setdefault(site["region"], []).append(e)
        for lst in self.by_model.values():
            lst.sort(key=lambda e: e["install_year"])
        self._years = {m: [e["install_year"] for e in lst] for m, lst in self.by_model.items()}
        self._experts: dict[tuple, list[dict]] = {}
        self.regions = sorted(self.by_region)
        self.skew_order = {r: list(lst) for r, lst in self.by_region.items()}
        Random(7).shuffle(self.regions)
        for lst in self.skew_order.values():
            Random(11).shuffle(lst)

    def site_of(self, el: dict) -> dict | None:
        return self.sites.get(el["site_id"])

    def class_members(self, model: str, year_min: int | None, year_max: int | None) -> list[dict]:
        """Elements of a model installed in [year_min, year_max] (the reach of a class)."""
        lst, years = self.by_model.get(model, []), self._years.get(model, [])
        lo = bisect.bisect_left(years, year_min) if year_min is not None else 0
        hi = bisect.bisect_right(years, year_max) if year_max is not None else len(lst)
        return lst[lo:hi]

    def expert(self, rng: Random, etype: str | None, model: str | None = None) -> dict:
        key = (etype, model)
        if key not in self._experts:
            self._experts[key] = self.people.experts(Random(zlib.crc32(repr(key).encode())), etype, model)  # not hash(): stays reproducible
        pool = self._experts[key]
        return rng.choice(pool[: max(8, len(pool) // 3)])

    def popular(self, rng: Random, region: str) -> dict:
        """Elements are not equally chatty: a few get most of the attention (skewed pick)."""
        lst = self.skew_order[region]
        return lst[int(len(lst) * rng.random() ** 2.5)]
