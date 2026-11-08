"""The operator's whole network: sites (core, regional, aggregation, access, mast), elements and links.

Plain dicts, written as CSV/JSONL. The hand-written Dashboard seed (TRN-042 and friends) is kept as is and
plugged into the generated mesh, so Elisa's example lives inside a company-sized graph.
"""

from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass, field
from random import Random

from .vocab import CATALOGUE, CITY_CODES, CORE_CITIES, REGIONS, SUBURB_ROOTS, SUBURB_SUFFIXES

END_YEAR = 2026

# tier -> (first build year, last build year, mode)
BUILD_YEARS = {"core": (2010, 2018, 2014), "regional": (2010, 2020, 2015), "aggregation": (2012, 2022, 2018), "access": (2012, 2025, 2020), "mast": (2013, 2025, 2021)}
SUFFIX = {"core": "core DC", "regional": "exchange", "aggregation": "hub", "access": "hut", "mast": "mast"}


@dataclass
class Network:
    sites: list[dict] = field(default_factory=list)
    elements: list[dict] = field(default_factory=list)
    links: list[dict] = field(default_factory=list)


def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()


def km(a: dict, b: dict) -> float:
    dy = (a["lat"] - b["lat"]) * 111.0
    dx = (a["lon"] - b["lon"]) * 111.0 * math.cos(math.radians((a["lat"] + b["lat"]) / 2))
    return math.hypot(dx, dy)


def _model_for(rng: Random, etype: str, year: int) -> tuple[str, int, str]:
    """Pick a model that existed in `year` (or the closest one), plus a firmware line."""
    models = CATALOGUE[etype][1]
    fits = [m for m in models if m[1] <= year <= m[2]]
    if fits:
        model = rng.choice(fits)
    else:
        model = min(models, key=lambda m: min(abs(year - m[1]), abs(year - m[2])))
        year = min(max(year, model[1]), model[2])
    name, first, last, fws = model
    index = int((year - first) / (last - first + 1) * len(fws))
    if rng.random() < 0.35:  # upgraded since install
        index += 1
    return name, year, fws[min(index, len(fws) - 1)]


class _Ids:
    def __init__(self, reserved: set[str]):
        self.reserved = reserved
        self.counters: dict[str, int] = {}

    def next(self, prefix: str) -> str:
        while True:
            n = self.counters.get(prefix, 10000) + 1
            self.counters[prefix] = n
            eid = f"{prefix}-{n}"
            if eid not in self.reserved:
                self.reserved.add(eid)
                return eid


def _site_plan(n_sites: int) -> dict[str, int]:
    regional = max(len(REGIONS), round(n_sites * 0.03))
    aggregation = max(len(REGIONS), round(n_sites * 0.09))
    mast = round(n_sites * 0.30)
    access = max(0, n_sites - 3 - regional - aggregation - mast)
    return {"core": 3, "regional": regional, "aggregation": aggregation, "access": access, "mast": mast}


def _site_elements(rng: Random, tier: str, mast_uplink: str) -> list[str]:
    """Element types installed at a site of this tier."""
    if tier == "core":
        return ["router", "router", "transmission_node", "transmission_node", "aggregation_switch", "power_system"]
    if tier == "regional":
        return ["router", "transmission_node", "transmission_node", "aggregation_switch", "power_system"] + (["router"] if rng.random() < 0.4 else [])
    if tier == "aggregation":
        out = ["aggregation_switch", "transmission_node", "power_system"]
        return out + (["transmission_node"] if rng.random() < 0.4 else []) + (["router"] if rng.random() < 0.3 else [])
    if tier == "access":
        return ["transmission_node", "power_system"] + (["aggregation_switch"] if rng.random() < 0.4 else [])
    out = ["baseband_unit", "power_system"] + ["radio_unit"] * rng.randint(2, 6)
    out += ["transmission_node"] if mast_uplink == "fiber" else ["microwave_terminal"]
    return out + (["transmission_node"] if mast_uplink == "microwave" and rng.random() < 0.2 else [])


def build_network(rng: Random, n_sites: int, anchors=None) -> Network:
    """`anchors` is a SeedData (hand-written sites, elements, links) to keep and connect."""
    net = Network()
    reserved = {e.id for e in anchors.elements} if anchors else set()
    site_ids = {s.id for s in anchors.sites} if anchors else set()
    ids = _Ids(reserved)
    counters: dict[str, int] = {}
    plan = _site_plan(n_sites)

    region_names = [r[0] for r in REGIONS]
    region_weights = [r[2] for r in REGIONS]
    cities = {r[0]: r[1] for r in REGIONS}
    used_names: set[str] = set()

    def new_site(tier: str, region: str, city: tuple) -> dict:
        cname, clat, clon, _ = city
        code = CITY_CODES.get(cname) or _fold(cname)[:3]
        while True:
            counters[code] = counters.get(code, 100) + 1
            sid = f"SITE-{code}-{counters[code]:03d}"
            if sid not in site_ids:
                site_ids.add(sid)
                break
        spread = 0.04 if tier in ("core", "regional") else 0.10 if tier in ("aggregation", "access") else 0.30
        suburb = rng.choice(SUBURB_ROOTS) + rng.choice(SUBURB_SUFFIXES)
        name = f"{cname} {suburb} {SUFFIX[tier]}" if tier != "core" else f"{cname} core DC"
        if name in used_names and rng.random() < 0.85:  # a few duplicate names stay: realistic ambiguity
            name = f"{cname} {suburb}{rng.randint(2, 9)} {SUFFIX[tier]}"
        used_names.add(name)
        lo, hi, mode = BUILD_YEARS[tier]
        site = {
            "id": sid, "name": name, "region": region, "city": cname, "tier": tier,
            "lat": round(clat + rng.gauss(0, spread), 5), "lon": round(clon + rng.gauss(0, spread * 1.8), 5),
            "built_year": int(rng.triangular(lo, hi, mode)), "origin": "synthetic",
        }
        net.sites.append(site)
        return site

    # ---- sites
    for city_name in CORE_CITIES:
        region = next(r[0] for r in REGIONS if any(c[0] == city_name for c in r[1]))
        new_site("core", region, next(c for c in cities[region] if c[0] == city_name))
    for tier in ("regional", "aggregation", "access", "mast"):
        for i in range(plan[tier]):
            region = region_names[i % len(region_names)] if tier in ("regional", "aggregation") and i < len(region_names) else rng.choices(region_names, region_weights)[0]
            city = rng.choices(cities[region], [c[3] for c in cities[region]])[0]
            new_site(tier, region, city)

    # ---- elements
    by_site: dict[str, list[dict]] = {}
    mast_kind: dict[str, str] = {}
    for site in net.sites:
        uplink = "fiber" if rng.random() < 0.3 else "microwave"
        mast_kind[site["id"]] = uplink
        kinds: dict[str, int] = {}
        for etype in _site_elements(rng, site["tier"], uplink):
            year = site["built_year"] if rng.random() > 0.3 else rng.randint(site["built_year"], END_YEAR)
            model, year, fw = _model_for(rng, etype, year)
            prefix = CATALOGUE[etype][0]
            kinds[prefix] = kinds.get(prefix, 0) + 1
            code, num = site["id"].split("-")[1:]
            el = {
                "id": ids.next(prefix), "type": etype, "model": model, "install_year": year, "firmware": fw,
                "site_id": site["id"], "aliases": [f"{code}{num}-{prefix}{kinds[prefix]}"], "origin": "synthetic",
            }
            net.elements.append(el)
            by_site.setdefault(site["id"], []).append(el)
    if anchors:
        for e in anchors.elements:
            by_site.setdefault(e.site_id or "", []).append(e.model_dump(mode="json"))

    # ---- links
    link_n = [0]

    def link(a: dict, b: dict, kind: str, sa: str, sb: str, gbps: float) -> None:
        link_n[0] += 1
        net.links.append({"id": f"LNK-{link_n[0] + 1000:06d}", "a": a["id"], "b": b["id"], "kind": kind, "site_a": sa, "site_b": sb, "capacity_gbps": gbps, "origin": "synthetic"})

    def gateway(site: dict) -> dict:
        els = by_site[site["id"]]
        order = ["router", "transmission_node", "aggregation_switch", "microwave_terminal", "baseband_unit"]
        if site["tier"] == "mast" and mast_kind[site["id"]] == "microwave":
            order = ["microwave_terminal", "transmission_node", "baseband_unit"]
        for t in order:
            for e in els:
                if e["type"] == t:
                    return e
        return els[0]

    def nearest(site: dict, pool: list[dict], k: int = 1) -> list[dict]:
        return sorted((s for s in pool if s["id"] != site["id"]), key=lambda s: km(site, s))[:k]

    tiers = {t: [s for s in net.sites if s["tier"] == t] for t in plan}
    cores = tiers["core"]
    for i, a in enumerate(cores):
        for b in cores[i + 1:]:
            link(gateway(a), gateway(b), "fiber", a["id"], b["id"], 400)
    for region in region_names:
        ring = [s for s in tiers["regional"] if s["region"] == region]
        if len(ring) > 1:
            cx, cy = sum(s["lat"] for s in ring) / len(ring), sum(s["lon"] for s in ring) / len(ring)
            ring.sort(key=lambda s: math.atan2(s["lat"] - cx, s["lon"] - cy))
            for i, a in enumerate(ring):
                b = ring[(i + 1) % len(ring)]
                if len(ring) > 2 or i == 0:
                    link(gateway(a), gateway(b), "fiber", a["id"], b["id"], 100)
    for s in tiers["regional"]:
        near = nearest(s, cores, 2)
        for core in near[: 2 if rng.random() < 0.4 else 1]:
            link(gateway(s), gateway(core), "fiber", s["id"], core["id"], 100)
    for s in tiers["aggregation"]:
        pool = [r for r in tiers["regional"] if r["region"] == s["region"]] or tiers["regional"]
        for r in nearest(s, pool, 2)[: 2 if rng.random() < 0.3 else 1]:
            link(gateway(s), gateway(r), "fiber", s["id"], r["id"], 40)
    infra = tiers["aggregation"] + tiers["regional"]
    for s in tiers["access"]:
        pool = [a for a in tiers["aggregation"] if a["region"] == s["region"]] or tiers["aggregation"]
        up = nearest(s, pool)[0]
        far = km(s, up) > 35
        link(gateway(s), gateway(up), "microwave" if far and rng.random() < 0.5 else "fiber", s["id"], up["id"], 10)
    anchored = list(infra)
    for s in sorted(tiers["mast"], key=lambda m: min(km(m, a) for a in infra)):
        best = nearest(s, infra)[0]
        chain = nearest(s, anchored)[0]
        up = chain if km(s, chain) < 0.8 * km(s, best) else best
        kind = mast_kind[s["id"]]
        link(gateway(s), gateway(up), kind, s["id"], up["id"], 1 if kind == "microwave" else 10)
        if kind == "microwave":
            anchored.append(s)
    for site in net.sites:  # inside a site: everything hangs on the gateway (radio units on the baseband)
        gw = gateway(site)
        bbu = next((e for e in by_site[site["id"]] if e["type"] == "baseband_unit"), None)
        for e in by_site[site["id"]]:
            if e is gw or e["type"] == "power_system":
                continue
            target = bbu if e["type"] == "radio_unit" and bbu else gw
            link(e, target, "backhaul", site["id"], site["id"], 10)

    if anchors:  # keep the hand-written seed and join it to the mesh
        for s in anchors.sites:
            net.sites.append({**s.model_dump(mode="json"), "city": s.name.split()[0], "tier": "mast" if "mast" in s.name else "access", "built_year": None})
        for e in anchors.elements:
            net.elements.append(e.model_dump(mode="json"))
        for lk in anchors.links:
            net.links.append({**lk.model_dump(mode="json"), "site_a": None, "site_b": None, "capacity_gbps": None})
        for s in anchors.sites:
            els = by_site.get(s.id, [])
            gw = next((e for e in els if e["type"] in ("transmission_node", "router")), els[0] if els else None)
            if gw is None or s.lat is None:
                continue
            pool = [a for a in infra if a["region"] == s.region] or infra
            up = nearest({"id": s.id, "lat": s.lat, "lon": s.lon}, pool)[0]
            link(gw, gateway(up), "microwave" if "mast" in s.name else "fiber", s.id, up["id"], 10)
    return net
