"""Staff of the demo operator: org chart, skills, seniority, writing style."""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from random import Random

from .vocab import CATALOGUE, FIRST_NAMES, LAST_NAMES, REGIONS, SENIORITY, STYLES, TEAMS

DOMAIN = "demo-operator.example"
MODELS = {t: [m[0] for m in v[1]] for t, v in CATALOGUE.items()}
# team -> element types the team knows well
TEAM_TYPES = {
    "NOC": ["transmission_node", "router", "radio_unit"], "Transmission": ["transmission_node", "microwave_terminal"],
    "Radio": ["radio_unit", "baseband_unit", "microwave_terminal"], "Core & IP": ["router", "aggregation_switch"],
    "Field team": ["transmission_node", "radio_unit", "power_system", "aggregation_switch"], "Planning": list(CATALOGUE),
}
SHIFTS = {"NOC": ["day", "evening", "night"], "Field team": ["day", "day", "on-call"]}
ANCHOR_REGION = {"liisa": "Lapland", "raimo": "Lapland", "erkki": "Southwest Finland", "veikko": "Southwest Finland"}


def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


@dataclass
class People:
    users: list[dict] = field(default_factory=list)
    by_id: dict[str, dict] = field(default_factory=dict)
    by_team: dict[str, list[dict]] = field(default_factory=dict)
    by_team_region: dict[tuple[str, str], list[dict]] = field(default_factory=dict)

    def add(self, user: dict) -> None:
        self.users.append(user)
        self.by_id[user["id"]] = user
        self.by_team.setdefault(user["team"], []).append(user)
        self.by_team_region.setdefault((user["team"], user["region"]), []).append(user)

    def pick(self, rng: Random, team: str, region: str | None = None) -> dict:
        pool = (self.by_team_region.get((team, region)) if region else None) or self.by_team.get(team) or self.users
        return rng.choice(pool)

    def experts(self, rng: Random, etype: str | None, model: str | None = None) -> list[dict]:
        """Senior people who know this type/model, best first."""
        rank = {"expert": 3, "senior": 2, "mid": 1, "junior": 0}
        pool = [u for u in self.users if u["team"] in ("Transmission", "Radio", "Core & IP", "Field team", "NOC") and u["seniority"] in ("senior", "expert")]
        if model:
            hit = [u for u in pool if model in u["skills"]]
            pool = hit or pool
        elif etype:
            pool = [u for u in pool if etype in u["skill_types"]] or pool
        pool = pool or [u for u in self.users if u["seniority"] in ("senior", "expert")] or list(self.users)
        rng.shuffle(pool)
        return sorted(pool, key=lambda u: -rank[u["seniority"]])


def build_people(rng: Random, n: int, anchors=None) -> People:
    people = People()
    taken: set[str] = set()
    emails: set[str] = set()
    regions = [r[0] for r in REGIONS]
    weights = [r[2] for r in REGIONS]

    def unique_name() -> tuple[str, str, str]:
        for attempt in range(60):
            first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
            name = f"{first} {last}" if attempt < 40 else f"{first} {rng.choice('ABCDEFGHJKLMNPRSTV')}. {last}"
            if name not in taken:
                taken.add(name)
                return name, first, last
        raise RuntimeError("name pool exhausted")

    def email(first: str, last: str) -> str:
        base = f"{_ascii(first)}.{_ascii(last)}"
        address, i = f"{base}@{DOMAIN}", 1
        while address in emails:
            i += 1
            address = f"{base}{i}@{DOMAIN}"
        emails.add(address)
        return address

    if anchors:
        for p in anchors.personas:
            first, last = p.name.split(" ", 1)
            taken.add(p.name)
            senior = p.id in ("erkki", "raimo")
            people.add({
                "id": p.id, "name": p.name, "email": email(first, last), "role": p.role, "team": p.team or "Management",
                "region": ANCHOR_REGION.get(p.id, "Uusimaa"), "seniority": "expert" if senior else "senior" if p.id in ("aino", "liisa") else "mid",
                "years_experience": 20 if senior else 9, "skills": MODELS["transmission_node"][:2] if p.id == "erkki" else [],
                "skill_types": [], "style": "anchor", "style_note": p.style, "expertise": p.expertise, "shift": "day",
                "employment": "employee", "manager_id": None, "origin": p.origin,
            })

    teams = list(TEAMS.items())
    total_share = sum(t[1][0] for t in teams)
    counter = 0
    for team, (share, roles, per_region, technical) in teams:
        count = max(2, round(n * share / total_share))
        for _ in range(count):
            counter += 1
            region = rng.choices(regions, weights)[0]
            role = rng.choices([r[0] for r in roles], [r[1] for r in roles])[0]
            level, _, (lo, hi) = rng.choices(SENIORITY, [s[1] for s in SENIORITY])[0]
            if role in ("Network Expert", "Radio Specialist", "Network Architect", "NOC Shift Lead", "Field Team Lead"):
                level = rng.choice(["senior", "expert"])
            if role.startswith("Junior"):
                level = "junior"
            level_range = next(s[2] for s in SENIORITY if s[0] == level)
            name, first, last = unique_name()
            skill_types = TEAM_TYPES.get(team, [])
            skills: list[str] = []
            if technical and skill_types:
                pool = [m for t in skill_types for m in MODELS[t]]
                k = {"junior": 1, "mid": 2, "senior": 4, "expert": 6}[level]
                skills = sorted(rng.sample(pool, min(k, len(pool))))
            people.add({
                "id": f"u{counter:05d}", "name": name, "email": email(first, last), "role": role, "team": team, "region": region,
                "seniority": level, "years_experience": rng.randint(*level_range), "skills": skills, "skill_types": skill_types,
                "style": rng.choice(STYLES), "style_note": "", "expertise": ", ".join(skills), "shift": rng.choice(SHIFTS.get(team, ["day"])),
                "employment": "contractor" if team == "Field team" and rng.random() < 0.12 else "employee", "manager_id": None, "origin": "synthetic",
            })
    for group in people.by_team_region.values():  # the most senior of each group leads it
        lead = max(group, key=lambda u: (u["seniority"] in ("senior", "expert"), u["years_experience"]))
        for u in group:
            if u is not lead:
                u["manager_id"] = lead["id"]
    return people
