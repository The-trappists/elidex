"""Ground-truth knowledge: facts people state in conversations, with the threads that carry them.

Each family writes (a) the fact in the shape of `models.ExtractedItem` plus lifecycle and reach, and (b) the
conversation where a human says it. Nothing here is Elisa's: families are invented, in the spirit of the brief.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from random import Random

from ..models import ClassCriteria
from .textgen import GREET, build_thread, channel_name, ref_strong
from .world import T0, T1, World, office_time

MAX_REACH_IDS = 3000


def cap(text: str) -> str:
    return text[:1].upper() + text[1:]


# ---------------------------------------------------------------- variants (what the knowledge is about)

CLASS_WORKAROUNDS = [
    dict(topic="sfp-swap-port-reinit", trigger="sfp-replacement", symptom="the port stays down after the optical module swap",
         diagnosis="older firmware does not re-initialise the port after a module change", cond="after an optical module swap",
         check=("sfp_replaced", "==", True), action="set the port admin state down for 30 seconds, then up, before touching more hardware",
         avoid=["replacing the whole node"]),
    dict(topic="autoneg-mismatch-after-reboot", trigger=None, symptom="the link comes back at 1G instead of 10G after a reboot",
         diagnosis="auto-negotiation picks the wrong speed on these units", cond="after a reboot", check=None,
         action="force the speed to 10G on both ends and save the config", avoid=["swapping the cable"]),
    dict(topic="fan-alarm-dust", trigger=None, symptom="the fan alarm comes back right after it is cleared",
         diagnosis="dust on the intake filter, not a failed fan", cond="when the fan alarm returns", check=("alarms", "==", "active"),
         action="clean the intake filter with compressed air before ordering a fan tray", avoid=["ordering a new fan tray"]),
    dict(topic="ptp-resync-after-power-cycle", trigger=None, symptom="a clock sync alarm shows up after a power cycle",
         diagnosis="the clock needs about 15 minutes to lock again", cond="after a power cycle", check=None,
         action="wait 15 minutes for the clock to lock and do not reboot a second time", avoid=["rebooting again"]),
    dict(topic="cold-module-flaps", trigger=None, symptom="the link flaps when it is colder than -20 degrees",
         diagnosis="standard optical modules drift in the cold", cond="when it is colder than -20 degrees", check=None,
         action="swap to an industrial-temperature module", avoid=["replacing the fibre"]),
    dict(topic="licence-lost-after-upgrade", trigger=None, symptom="port licences vanish after a firmware upgrade",
         diagnosis="the licence file is not carried over by the upgrade", cond="after a firmware upgrade", check=None,
         action="re-apply the licence file from the vendor portal before the maintenance window closes", avoid=["rolling back the firmware"]),
    dict(topic="slow-commit-do-not-abort", trigger=None, symptom="the config commit hangs for minutes",
         diagnosis="the unit is rebuilding its tables, it is not stuck", cond="when a commit takes long", check=None,
         action="wait for the prompt, up to 10 minutes, and never abort the commit", avoid=["aborting the commit"]),
    dict(topic="second-uplink-drops-traffic", trigger=None, symptom="traffic drops when the second uplink port is used",
         diagnosis="the second port shares a buffer with the first on this hardware", cond="when the second uplink is in use", check=None,
         action="keep the second uplink port unused and use the first", avoid=["plugging anything into the second port"]),
]
INSTANCE_QUIRKS = [
    dict(topic="antenna-tilt-drift", type="radio_unit", symptom="throughput dropped after the storm", diagnosis="the antenna mount drifts in strong wind, the radio unit is fine",
         cond="after a storm", action="check the antenna alignment and re-tilt it before replacing the radio unit", avoid=["replacing the radio unit first"], check=("alarms", "==", "active")),
    dict(topic="wet-snow-throughput-loss", type="radio_unit", symptom="throughput halves when wet snow sticks to the antenna", diagnosis="ice on the antenna feed",
         cond="in wet snow", action="ask for a climb crew to de-ice it, a reset does nothing", avoid=["resetting the radio unit"], check=None),
    dict(topic="lightning-vswr-false-alarm", type="radio_unit", symptom="a VSWR alarm appears after lightning", diagnosis="the connector seal let in water",
         cond="after a thunderstorm", action="check the connector seal and reset the alarm once, replace only if it returns within 24 hours", avoid=["replacing the cable at once"], check=("alarms", "==", "active")),
    dict(topic="heater-breaker-trips-in-cold", type="power_system", symptom="the cabinet heater is dead below -30 degrees", diagnosis="the heater breaker trips on inrush",
         cond="when it is below -30 degrees", action="switch the heater breaker off and on once, then check the cabinet temperature after 20 minutes", avoid=["ordering a new heater"], check=None),
    dict(topic="battery-alarm-clears-itself", type="power_system", symptom="a battery alarm shows after a mains cut", diagnosis="the charger is topping up after the cut",
         cond="after a mains cut", action="leave it for 24 hours before opening a battery ticket", avoid=["replacing the battery string"], check=("alarms", "==", "active")),
]
SITE_ACCESS = [
    dict(topic="gate-key-location", text="the barrier key hangs in the grey box on the left gatepost, the box code is the site number", cond=None),
    dict(topic="call-caretaker-first", text="call the caretaker {care} 30 minutes ahead, they open the gate remotely", cond="outside office hours"),
    dict(topic="winter-road-closed", text="from November to April the road is not ploughed: park at the lake car park and use the snowmobile from the shed", cond="in winter"),
    dict(topic="reindeer-gate", text="close the reindeer gate behind you every time, the herders complain otherwise", cond=None),
    dict(topic="safety-induction", text="you need the safety induction and a hard hat, security at the front desk checks the list", cond=None),
    dict(topic="rooftop-escort", text="the landlord wants an escort on the roof, book it through the facilities desk two days ahead", cond=None),
    dict(topic="parking-tow-zone", text="park at the back, the front lot is a tow zone and they do tow", cond=None),
]
KEY_MOVED = ["the padlock was replaced and the key is now with the caretaker {care}, not in the grey box", "the key moved to the security desk in the main building, the old hiding place is empty"]
FIRMWARE_BUGS = [
    dict(topic="memory-leak-reboot", fact="firmware {fw} leaks memory: the node gets sluggish after about 60 days, reboot it in a maintenance window", fix="{fw2} fixes the memory leak, no more periodic reboots needed"),
    dict(topic="admin-lockout-persists", fact="firmware {fw} locks the local admin after 5 failed logins and the lock survives a reboot, clear it with the console cable", fix="{fw2} makes the lock expire after 15 minutes, the console cable is no longer needed"),
    dict(topic="counter-wrap-32bit", fact="firmware {fw} wraps the traffic counters at 32 bits: the graphs look wrong but traffic is fine", fix="{fw2} uses 64-bit counters, the graphs are right again"),
]
CONFLICTS = [
    dict(topic="stuck-link-after-swap", symptom="the link is stuck after a module swap", a="reseat the module and wait two minutes", b="never reseat it, bounce the port from the CLI instead"),
    dict(topic="battery-alarm-handling", symptom="the battery alarm is on", a="ignore it, it clears itself within a day", b="replace the battery string now, it does not clear by itself"),
    dict(topic="microwave-fade-fix", symptom="the microwave link fades in the evenings", a="re-align the dish", b="switch to a more robust modulation profile and leave the dish alone"),
]
ECHOES = ["As {who} said, {short}. Just so it is written somewhere.", "Reminder for the new people: {short} (that is what {who} told us).", "FYI {short}, courtesy of {who}."]


@dataclass
class Bundle:
    facts: list[dict] = field(default_factory=list)
    threads: list[dict] = field(default_factory=list)


class Writer:
    """Shared state for the families: ids and small builders."""

    def __init__(self, rng: Random, world: World):
        self.rng, self.w, self.n = rng, world, 0
        self.access_sites = [s for s in world.network.sites if s["tier"] in ("access", "mast") and world.by_site.get(s["id"])]

    def models(self, wanted: list[str], min_years: int = 3) -> list[str]:
        """Models of the list that exist in this company with enough install years to define a class."""
        return [m for m in wanted if len({e["install_year"] for e in self.w.by_model.get(m, [])}) >= min_years]

    def new_id(self) -> str:
        self.n += 1
        return f"F{self.n:06d}"

    def channel(self) -> str:
        return self.rng.choices(["slack", "teams", "email"], [55, 25, 20])[0]

    def thread(self, fid: str, k: int, start: datetime, region: str, lines, subject: str) -> dict:
        ch = self.channel()
        subj = channel_name(self.rng, region) if ch == "slack" else subject if ch == "email" else None
        return build_thread(self.rng, f"{ch}/{start:%Y-%m}/k{fid[1:]}-{k}", ch, subj, start, lines)

    def trust(self) -> str:
        return self.rng.choices(["verified", "stated", "hunch"], [60, 30, 10])[0]

    def item(self, **kw) -> dict:
        base = dict(type="fact", scope={"instance_ids": [], "site_ids": [], "element_class": None, "trigger": None}, conditions=[],
                    diagnosis=None, action=None, avoid=[], fact=None, evidence=None, cited_seq=[1], confidence=0.8)
        base.update(kw)
        return base

    def fact(self, fid, family, item, thread, valid_from, reach_ids, kind, stated_by_id, extra_sources=(), **kw) -> dict:
        ids = list(reach_ids)
        rec = {
            "fact_id": fid, "family": family, "item": item,
            "sources": [{"thread_id": thread["id"], "seq": item["cited_seq"]}] + [{"thread_id": t, "seq": s} for t, s in extra_sources],
            "valid_from": valid_from, "valid_to": None, "closed_by": None, "conflicts_with": [], "stated_by_id": stated_by_id,
            "reach": {"kind": kind, "count": len(ids), "entity_ids": ids[:MAX_REACH_IDS], "truncated": len(ids) > MAX_REACH_IDS},
        }
        rec.update(kw)
        return rec

    def evidence(self, thread: dict, seq: int) -> str:
        return f"seq {seq}: '{thread['messages'][seq - 1]['text'][:90]}'"

    def echo(self, fid: str, bundle: Bundle, fact: dict, short: str, expert: dict, region: str, after: datetime) -> None:
        """Someone repeats the knowledge elsewhere, later: a second source for the same fact."""
        rng = self.rng
        when = office_time(rng, min(after + timedelta(days=2), T1 - timedelta(days=1)), T1)
        who = self.w.people.pick(rng, "Field team", region)
        text = rng.choice(ECHOES).format(who=expert["name"], short=short)
        th = self.thread(fid, 9, when, region, [(who, text), (self.w.people.pick(rng, "NOC", region), rng.choice(["thanks", "good to know", "noted", "👍"]))], "Tip: " + short[:50])
        bundle.threads.append(th)
        fact["sources"].append({"thread_id": th["id"], "seq": [1]})

    # ---------------------------------------------------------------- families

    def class_workaround(self) -> Bundle:
        rng, w = self.rng, self.w
        out, fid = Bundle(), self.new_id()
        v = rng.choice(CLASS_WORKAROUNDS)
        models = self.models(["TX-2000", "TX-3000", "TX-3000", "TX-3000", "TX-5000"])
        if not models:
            return Bundle()
        model = rng.choice(models)
        pool = w.by_model[model]
        years = sorted({e["install_year"] for e in pool})
        cutoff = rng.choice(years[1:-1] if len(years) > 2 else years)
        members = w.class_members(model, None, cutoff)
        target = rng.choice(members)
        site = w.site_of(target)
        region = site["region"]
        asker = w.people.pick(rng, rng.choice(["Field team", "NOC"]), region)
        expert = w.expert(rng, "transmission_node", model)
        mode = self.trust()
        start = office_time(rng, T0 + timedelta(days=20), T1 - timedelta(days=30))
        crit = ClassCriteria(type="transmission_node", model=model, install_year_max=cutoff)
        g = rng.choice(GREET)
        lines = [(asker, f"{g}I'm at {site['name']} and {ref_strong(rng, target)} has an issue: {v['symptom']}. Anyone seen this before?")]
        if mode == "hunch":
            lines += [(expert, f"Not sure, but I think {model} units installed up to {cutoff} might do that: {v['diagnosis']}."),
                      (expert, f"You could try this: {v['action']}."), (asker, "ok, will see what happens")]
            key = [2, 3]
        else:
            lines += [(expert, f"{cap(model)} units installed up to {cutoff} do that: {v['diagnosis']}."),
                      (expert, f"{cap(v['action'])}. Please avoid {v['avoid'][0]}.")]
            key = [2, 3]
            if mode == "verified":
                lines += [(asker, rng.choice(["Did it, that fixed it.", "Worked, the link is stable again.", "Tried it. Back to normal."])),
                          (expert, rng.choice(["Good. Same on every unit from that batch, keep it in mind.", "Great. Same story on the older ones."]))]
                key = [2, 3, 4]
            else:
                lines += [(asker, "ok thanks, will try that")]
        observed = [target["id"]]
        if rng.random() < 0.4:
            other = rng.choice(members)
            observed.append(other["id"])
            lines.insert(3, (w.people.pick(rng, "Field team", region), f"Same on {ref_strong(rng, other)} last winter, can confirm."))
            key = key[:2] + [4] + ([5] if mode == "verified" else [])  # the confirmation moved to seq 5
        th = self.thread(fid, 1, start, region, lines, f"{target['id']}: {v['symptom']}")
        crit_item = dict(type="workaround", topic=v["topic"], summary=f"{cap(v['action'])} when {v['symptom']} on {crit.label()}.",
                         scope={"instance_ids": observed, "site_ids": [site["id"]], "element_class": crit.model_dump(exclude_none=True), "trigger": v["trigger"]},
                         conditions=[{"text": v["cond"], "check": dict(zip(("field", "op", "value"), v["check"])) if v["check"] else None}],
                         diagnosis=v["diagnosis"], action=v["action"], avoid=v["avoid"], trust_level=mode, stated_by=expert["name"], cited_seq=key,
                         confidence={"verified": 0.85, "stated": 0.7, "hunch": 0.5}[mode])
        crit_item["evidence"] = self.evidence(th, key[-1])
        fact = self.fact(fid, "class_workaround", self.item(**crit_item), th, th["messages"][key[0] - 1]["sent_at"], [e["id"] for e in members], "class", expert["id"], class_id=crit.class_id())
        out.threads.append(th)
        out.facts.append(fact)
        if rng.random() < 0.25:
            self.echo(fid, out, fact, f"{v['action']} when {v['symptom']}", expert, region, start)
        return out

    def instance_quirk(self, hunch_first: bool = False) -> Bundle:
        rng, w = self.rng, self.w
        out, fid = Bundle(), self.new_id()
        v = rng.choice(INSTANCE_QUIRKS)
        target = rng.choice(w.by_type[v["type"]])
        site = w.site_of(target)
        region = site["region"]
        asker = w.people.pick(rng, "Field team", region)
        team = "Radio" if v["type"] == "radio_unit" else "Field team"
        expert = w.expert(rng, v["type"])
        start = office_time(rng, T0 + timedelta(days=10), T1 - timedelta(days=60))
        mode = "hunch" if hunch_first else self.trust()
        g = rng.choice(GREET)
        lines = [(asker, f"{g}{ref_strong(rng, target)} at {site['name']}: {v['symptom']}. What do I do?")]
        if mode == "hunch":
            lines += [(asker, f"my guess is {v['diagnosis']}, but I'm not sure"), (w.people.pick(rng, team, region), "could be, never checked")]
            key = [2]
        else:
            lines += [(expert, f"Hm. {cap(v['diagnosis'])}."), (expert, f"{cap(v['action'])}.")]
            lines += [(asker, rng.choice(["Back down. Done and throughput is normal.", "Did that, all fine now.", "ok on it"]))]
            key = [2, 3] + ([4] if mode == "verified" else [])
        th = self.thread(fid, 1, start, region, lines, f"{target['id']} at {site['name']}")
        stater = asker if mode == "hunch" else expert
        item = self.item(type="workaround", topic=v["topic"], summary=f"{cap(v['action'])} {v['cond']}.", conditions=[{"text": v["cond"], "check": dict(zip(("field", "op", "value"), v["check"])) if v["check"] else None}],
                         scope={"instance_ids": [target["id"]], "site_ids": [site["id"]], "element_class": None, "trigger": None},
                         diagnosis=v["diagnosis"], action=v["action"], avoid=v["avoid"], trust_level=mode, stated_by=stater["name"], cited_seq=key,
                         confidence={"verified": 0.85, "stated": 0.7, "hunch": 0.5}[mode], evidence=self.evidence(th, key[-1]))
        fact = self.fact(fid, "instance_quirk", item, th, th["messages"][key[0] - 1]["sent_at"], [target["id"]], "instance", stater["id"])
        out.threads.append(th)
        out.facts.append(fact)
        if hunch_first:  # later, someone who knows it confirms the same thing: the trust grows, the fact stays one
            when = office_time(rng, start + timedelta(days=4), min(start + timedelta(days=40), T1))
            boss = expert
            th2 = self.thread(fid, 2, when, region, [(asker, f"Update on {ref_strong(rng, target)}: {v['action']}. Worked."),
                                                      (boss, f"Yes, I know. {cap(v['diagnosis'])}. Confirmed, this is how it is.")], f"Re: {target['id']}")
            out.threads.append(th2)
            fact["item"]["trust_level"] = "verified"
            fact["item"]["stated_by"] = boss["name"]
            fact["item"]["confidence"] = 0.85
            fact["stated_by_id"] = boss["id"]
            fact["trust_history"] = ["hunch", "verified"]
            fact["sources"].append({"thread_id": th2["id"], "seq": [2]})
        return out

    def site_access(self) -> Bundle:
        rng, w = self.rng, self.w
        out, fid = Bundle(), self.new_id()
        site = rng.choice(self.access_sites)
        region = site["region"]
        v = rng.choice(SITE_ACCESS)
        care = w.people.pick(rng, "Facilities", region)["name"]
        text = v["text"].format(care=care)
        asker = w.people.pick(rng, "Field team", region)
        sayer = w.people.pick(rng, rng.choice(["Logistics", "Field team"]), region)
        start = office_time(rng, T0 + timedelta(days=10), T1 - timedelta(days=120))
        g = rng.choice(GREET)
        lines = [(asker, f"{g}going to {site['name']} tomorrow. Any trick for getting in?"), (sayer, f"Yes: {text}."), (asker, rng.choice(["perfect, kiitos", "ok thanks!", "👍"]))]
        th = self.thread(fid, 1, start, region, lines, f"Access to {site['name']}")
        item = self.item(type="access", topic=v["topic"], summary=f"{cap(text)}.", scope={"instance_ids": [], "site_ids": [site["id"]], "element_class": None, "trigger": None},
                         conditions=[{"text": v["cond"], "check": None}] if v["cond"] else [], action=text, trust_level="stated", stated_by=sayer["name"], cited_seq=[2],
                         confidence=0.8, evidence=self.evidence(th, 2))
        fact = self.fact(fid, "site_access", item, th, th["messages"][1]["sent_at"], [site["id"]], "site", sayer["id"])
        out.threads.append(th)
        out.facts.append(fact)
        if v["topic"] == "gate-key-location" and rng.random() < 0.5:  # the key moves later: the old access stops being true
            fid2 = self.new_id()
            when = office_time(rng, start + timedelta(days=30), T1)
            fixer = w.people.pick(rng, "Field team", region)
            new_text = rng.choice(KEY_MOVED).format(care=care)
            th2 = self.thread(fid2, 1, when, region, [(fixer, f"Heads up for {site['name']}: {new_text}."), (asker, "thanks, the grey box was empty last time!")], f"Key change at {site['name']}")
            item2 = self.item(type="invalidation", topic=v["topic"], summary=f"{cap(new_text)}.", scope=item["scope"], fact=new_text, trust_level="stated", stated_by=fixer["name"],
                              cited_seq=[1], confidence=0.8, evidence=self.evidence(th2, 1))
            fact2 = self.fact(fid2, "site_access_change", item2, th2, th2["messages"][0]["sent_at"], [site["id"]], "site", fixer["id"])
            fact["valid_to"], fact["closed_by"] = fact2["valid_from"], fid2
            out.threads.append(th2)
            out.facts.append(fact2)
        elif rng.random() < 0.2:
            self.echo(fid, out, fact, text, sayer, region, start)
        return out

    def firmware_bug(self) -> Bundle:
        rng, w = self.rng, self.w
        out, fid = Bundle(), self.new_id()
        v = rng.choice(FIRMWARE_BUGS)
        models = self.models(["TX-3000", "TX-3000", "TX-5000", "RT-9"], min_years=1)
        if not models:
            return Bundle()
        model = rng.choice(models)
        etype = "router" if model.startswith("RT") else "transmission_node"
        pool = [e for e in w.by_model[model] if e["firmware"]]
        fw = rng.choice(sorted({e["firmware"] for e in pool}))
        sample = [e for e in pool if e["firmware"] == fw]
        lo, hi = min(e["install_year"] for e in sample), max(e["install_year"] for e in sample)
        crit = ClassCriteria(type=etype, model=model, install_year_min=lo, install_year_max=hi)
        members = w.class_members(model, lo, hi)
        target = rng.choice(sample)
        site = w.site_of(target)
        region = site["region"]
        expert = w.expert(rng, etype, model)
        asker = w.people.pick(rng, "NOC", region)
        start = office_time(rng, T0 + timedelta(days=10), T1 - timedelta(days=200))
        fw2 = f"{float(fw) + 0.1:.1f}" if fw.replace(".", "").isdigit() else fw
        text = v["fact"].format(fw=fw)
        lines = [(asker, f"{ref_strong(rng, target)} at {site['name']} is acting up again, any idea?"), (expert, f"Yes, known thing: {text}."), (asker, rng.choice(["ok, I'll plan the reboot", "thanks, noted", "ah that explains it"]))]
        th = self.thread(fid, 1, start, region, lines, f"{target['id']} behaviour")
        item = self.item(type="fact", topic=v["topic"], summary=f"{cap(text)}.", fact=text, trust_level="stated", stated_by=expert["name"], cited_seq=[2], confidence=0.8,
                         scope={"instance_ids": [target["id"]], "site_ids": [site["id"]], "element_class": crit.model_dump(exclude_none=True), "trigger": None}, evidence=self.evidence(th, 2))
        fact = self.fact(fid, "firmware_bug", item, th, th["messages"][1]["sent_at"], [e["id"] for e in members], "class", expert["id"], class_id=crit.class_id())
        out.threads.append(th)
        out.facts.append(fact)
        if rng.random() < 0.7:  # a later release fixes it: the advice goes out of date (idea D)
            fid2 = self.new_id()
            when = office_time(rng, start + timedelta(days=40), T1)
            fix = v["fix"].format(fw2=fw2)
            vendor = w.people.pick(rng, "Vendor management")
            th2 = self.thread(fid2, 1, when, region, [(vendor, f"Release notes for {model}: {fix}."), (expert, "Good news. We can drop the workaround once it is rolled out.")], f"{model} release {fw2}")
            item2 = self.item(type="invalidation", topic=v["topic"], summary=f"{cap(fix)}.", fact=fix, trust_level="verified", stated_by=vendor["name"], cited_seq=[1], confidence=0.85,
                              scope=item["scope"], evidence=self.evidence(th2, 1))
            fact2 = self.fact(fid2, "firmware_fix", item2, th2, th2["messages"][0]["sent_at"], [e["id"] for e in members], "class", vendor["id"], class_id=crit.class_id())
            fact["valid_to"], fact["closed_by"] = fact2["valid_from"], fid2
            out.threads.append(th2)
            out.facts.append(fact2)
        return out

    def expert_conflict(self) -> Bundle:
        rng, w = self.rng, self.w
        out = Bundle()
        f1, f2 = self.new_id(), self.new_id()
        v = rng.choice(CONFLICTS)
        target = rng.choice(w.by_type["transmission_node"])
        site = w.site_of(target)
        region = site["region"]
        e1, e2 = w.expert(rng, "transmission_node"), w.expert(rng, "transmission_node")
        while e2["id"] == e1["id"]:
            e2 = w.expert(rng, None)
        asker = w.people.pick(rng, "Field team", region)
        start = office_time(rng, T0 + timedelta(days=10), T1 - timedelta(days=30))
        lines = [(asker, f"{ref_strong(rng, target)} at {site['name']}: {v['symptom']}. What should I do?"), (e1, f"{cap(v['a'])}."),
                 (e2, f"Hm. I disagree: {v['b']}."), (asker, "ok, now I have two answers... I'll ask the team lead")]
        th = self.thread(f1, 1, start, region, lines, f"{target['id']}: {v['symptom']}")
        scope = {"instance_ids": [target["id"]], "site_ids": [site["id"]], "element_class": None, "trigger": None}
        recs = []
        for fid, who, adv, seq in ((f1, e1, v["a"], 2), (f2, e2, v["b"], 3)):
            item = self.item(type="workaround", topic=v["topic"], summary=f"{cap(adv)} when {v['symptom']}.", scope=scope, action=adv, trust_level="stated", stated_by=who["name"],
                             cited_seq=[seq], confidence=0.7, evidence=self.evidence(th, seq))
            recs.append(self.fact(fid, "expert_conflict", item, th, th["messages"][seq - 1]["sent_at"], [target["id"]], "instance", who["id"]))
        recs[0]["conflicts_with"], recs[1]["conflicts_with"] = [f2], [f1]
        out.threads.append(th)
        out.facts += recs
        return out


FAMILIES = [("class_workaround", 28), ("instance_quirk", 18), ("site_access", 20), ("firmware_bug", 14), ("expert_conflict", 8), ("hunch_to_verified", 12)]


def generate_knowledge(rng: Random, world: World, n_facts: int) -> Bundle:
    """About n_facts facts (families add follow-up facts: key moved, firmware fix, a second expert)."""
    writer = Writer(rng, world)
    out = Bundle()
    names = [f[0] for f in FAMILIES]
    weights = [f[1] for f in FAMILIES]
    for _ in range(n_facts * 20):  # a family may return nothing when the company lacks a model
        if writer.n >= n_facts:
            break
        family = rng.choices(names, weights)[0]
        b = writer.instance_quirk(hunch_first=True) if family == "hunch_to_verified" else getattr(writer, family)()
        out.facts += b.facts
        out.threads += b.threads
    return out
