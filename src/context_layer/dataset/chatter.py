"""Everyday conversation with no durable knowledge in it: the haystack, plus hard negatives that look like needles.

Each category is a list of script variants, a script being [(who, template)]. `who` indexes the category's cast
(teams). Templates use the slots built in `Chatter._slots`.
"""

from __future__ import annotations

from random import Random

from .textgen import FILLER, build_thread, channel_name
from .vocab import VENDORS
from .world import World

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
PARAGRAPHS = [
    "This message is intended for the named recipients only. If you received it by mistake, please delete it and tell the sender.",
    "Please note that planned work is performed under the change process and that unplanned impact must be reported to the NOC without delay.",
    "The attached document lists the affected product versions, the recommended upgrade path and the contact details of the vendor support desk.",
    "No action is required for units that already run the current release. Units on older releases will be handled in the next maintenance cycle.",
    "For questions about the schedule, contact the planning team. For access to the sites, contact the logistics desk at least two working days ahead.",
    "Weather permitting, the crews will work in the order of the plan. Delays caused by roads or by snow are normal in this season.",
    "Thank you for your patience. We will update this thread when the status changes and when the work order is closed.",
]
GENERIC_TAIL = ["any update?", "still on it", "ok, thanks", "done, closing the ticket", "will check tomorrow", "👍", "noted", "can you send me the ticket number?", "sure"]

# name: (weight, channel weights [slack, teams, email], cast teams, kind, scripts)
CATEGORIES: dict[str, tuple] = {
    "handover": (14, [60, 40, 0], ["NOC", "NOC"], "noise", [
        [(0, "Handover: {n} open tickets, nothing critical. Planned work on {el} at {hhmm}, {p2} has it."), (1, "Got it. Anything about {site}?"), (0, "Only the planned work, access is booked."), (1, "ok, taking over")],
        [(0, "Quiet night. {tkt} is still open, waiting for the field team in {city}."), (1, "ok, I'll chase it after the stand-up"), (0, "thanks, bye")],
        [(0, "Shift summary: two link flaps on {el2}, both cleared by themselves. {tkt} closed."), (1, "thanks. Is the {model} firmware wave still on for {day}?"), (0, "yes, {hhmm}")],
    ]),
    "truck_roll": (12, [55, 45, 0], ["NOC", "Field team", "Logistics"], "noise", [
        [(0, "Can you take {tkt}? {site}, {el}."), (1, "Yes, I can be there by {hhmm}."), (2, "Access is booked for {day}, the caretaker knows."), (1, "Done, closing {tkt}."), (0, "thanks")],
        [(0, "{tkt}: customer-affecting, {city}. Who is closest?"), (1, "I'm 20 min away, going."), (0, "👍 keep me posted"), (1, "on site, parts in the van")],
        [(1, "Where do I park at {site}? Navigator says it's in the forest."), (2, "Use the road from the north, the pin is in the ticket."), (1, "found it, kiitos")],
    ]),
    "maintenance": (9, [40, 20, 40], ["Planning", "NOC", "Field team"], "noise", [
        [(0, "Planned work {chg}: firmware {fw} upgrade on {el}, {day} {hhmm}-{hhmm2}. Expected impact: none."), (1, "Ack. Added to the calendar."), (2, "Crew confirmed for {site}.")],
        [(0, "{chg} moves from {day} to next week because of the weather forecast in {region}."), (1, "ok, noted"), (1, "customers informed")],
        [(0, "Reminder: window for {chg} opens in an hour at {site}."), (2, "on site already, waiting for the go"), (1, "go ahead at {hhmm}")],
    ]),
    "alarm_chatter": (12, [70, 30, 0], ["NOC", "Field team"], "noise", [
        [(0, "Link flap alarm on {el}, cleared by itself."), (1, "ok keeping an eye on it"), (0, "no repeat in 30 min, closing {tkt}")],
        [(0, "{el} shows a temperature warning in {city}."), (1, "it's 28 degrees in the room, AC is being serviced"), (0, "ok, ticket stays open until the AC is back")],
        [(0, "Alarm storm from {site}, probably the planned work."), (1, "yes, {chg}, ignore until {hhmm2}")],
    ]),
    "parts": (7, [30, 40, 30], ["Field team", "Logistics"], "noise", [
        [(0, "Do we have a spare {model} fan tray in {city}?"), (1, "Warehouse says 2 in {region}."), (0, "Ship one to {city} please, {tkt}."), (1, "ordered, ETA {day}")],
        [(0, "The SFP I got for {site} is the wrong wavelength."), (1, "Sorry! Sending the right one tomorrow."), (0, "thanks")],
    ]),
    "fw_rollout": (6, [20, 30, 50], ["Planning", "NOC", "Field team"], "noise", [
        [(0, "Firmware {fw} rollout wave {n} starts {day}: {model} nodes in {region}, window {hhmm}-{hhmm2}."), (1, "👍"), (2, "crews booked")],
        [(0, "Rollout {fw}: {n} nodes done, no issues reported."), (1, "nice"), (1, "tracking in {chg}")],
    ]),
    "customer": (13, [20, 60, 20], ["Customer service", "NOC", "Customer service"], "noise", [
        [(0, "Customer in {city} reports slow internet since this morning, any outage?"), (1, "No known outage, checking."), (1, "Nothing on our side for {city}."), (0, "ok, I'll ask them to restart the router")],
        [(0, "Business customer in {city} wants a call back about {tkt}."), (1, "Not ours, it's the access network. Try the field desk."), (0, "thanks")],
        [(0, "Lots of calls from {city} about TV channels."), (2, "Same here, probably the content provider."), (1, "Confirmed, not the network.")],
    ]),
    "smalltalk": (8, [50, 50, 0], ["NOC", "Field team"], "noise", [
        [(0, "Anyone up for lunch? Salmon soup today."), (1, "yes! 11:30?"), (0, "joo")],
        [(0, "The coffee machine is broken again 😅"), (1, "kahvi emergency"), (0, "I'll bring some from home")],
        [(0, "Happy Friday!"), (1, "moi! Almost weekend")],
    ]),
    "admin": (6, [10, 30, 60], ["Sales", "Facilities", "Management"], "noise", [
        [(0, "Quote for a business customer in {city} needs sign-off today."), (2, "Looking at it now."), (2, "Approved, send it.")],
        [(0, "Cleaning of the {site} cabinet room is scheduled for {day}."), (1, "ok, I'll unlock at {hhmm}")],
        [(0, "Parking permits for the {city} office are renewed."), (1, "thanks")],
    ]),
    "vendor_mail": (5, [0, 0, 100], ["Vendor management", "Planning"], "noise", [
        [(0, "Product bulletin {pb} from {vendor}: {model} release {fw}. {para} {para2}"), (1, "Thanks, forwarding to the transmission team. {para2}")],
        [(0, "Invoice reminder for the {model} support contract, {chg}. {para} {para2}"), (1, "Passing to procurement.")],
    ]),
    # hard negatives: look like knowledge, are not durable or not scoped
    "one_off": (3, [70, 30, 0], ["NOC", "Field team"], "hard_negative", [
        [(0, "Rebooted {el}, it's fine now."), (1, "ok, good"), (1, "closing {tkt}")],
        [(0, "I power cycled {el} and the alarm went away."), (1, "ok. one-off then")],
    ]),
    "unanswered": (3, [80, 20, 0], ["Field team", "NOC"], "hard_negative", [
        [(0, "Does anyone know why {el} drops a few packets around 3 am?"), (1, "no idea"), (0, "ok I'll look at the graphs tomorrow")],
        [(0, "Has anyone seen {site} behave strangely after rain?"), (1, "not me")],
    ]),
    "rumour": (2, [80, 20, 0], ["Field team", "NOC", "Field team"], "hard_negative", [
        [(0, "Heard that some {model} nodes have a problem with port two. No idea which ones."), (1, "can't tell from the inventory either"), (2, "ask the vendor")],
        [(0, "Somebody said {city} has a flaky hut. Which one?"), (1, "there are like six")],
    ]),
    "id_confusion": (2, [80, 20, 0], ["NOC", "Field team"], "hard_negative", [
        [(0, "Careful: it is {el2}, not {el}. I mixed up the ids in {tkt}."), (1, "ok, updating the ticket")],
    ]),
}


class Chatter:
    def __init__(self, world: World):
        self.w = world
        self.names = list(CATEGORIES)
        self.weights = [CATEGORIES[n][0] for n in self.names]
        self.region_weights = [len(world.by_region[r]) for r in world.regions]
        self._pools: dict[tuple, list[dict]] = {}

    def person(self, rng: Random, team: str, region: str) -> dict:
        key = (team, region)
        if key not in self._pools:
            self._pools[key] = self.w.people.by_team_region.get(key) or self.w.people.by_team.get(team) or self.w.people.users
        return rng.choice(self._pools[key])

    def _ref(self, rng: Random, el: dict, site: dict) -> str:
        r = rng.random()
        if r < 0.72:
            return el["id"]
        if r < 0.88 and el["aliases"]:
            return el["aliases"][0]
        return f"the {el['model']} at {site['name']}"

    def _slots(self, rng: Random, region: str) -> dict:
        w = self.w
        el = w.popular(rng, region)
        site = w.site_of(el)
        el2 = w.popular(rng, region)
        h = rng.randint(0, 22)
        i = rng.randrange(len(PARAGRAPHS))
        return {
            "el": self._ref(rng, el, site), "el2": el2["id"], "site": site["name"], "city": site["city"], "region": region,
            "tkt": f"INC{rng.randint(1_000_000, 9_999_999)}", "chg": f"CHG{rng.randint(100_000, 999_999)}",
            "hhmm": f"{h:02d}:{rng.choice(['00', '15', '30', '45'])}", "hhmm2": f"{(h + 2) % 24:02d}:00", "day": rng.choice(DAYS),
            "fw": el["firmware"] or "1.0", "model": el["model"], "n": rng.randint(2, 140), "pb": f"PB-{rng.randint(1000, 9999)}",
            "vendor": rng.choice(VENDORS), "para": PARAGRAPHS[i], "para2": PARAGRAPHS[(i + rng.randint(1, 6)) % len(PARAGRAPHS)],
        }

    def thread(self, rng: Random, thread_id: str, start) -> tuple[dict, dict | None]:
        name = rng.choices(self.names, self.weights)[0]
        _, channel_w, cast, kind, scripts = CATEGORIES[name]
        region = rng.choices(self.w.regions, self.region_weights)[0]
        people = [self.person(rng, team, region) for team in cast]
        s = self._slots(rng, region)
        s["p2"] = people[-1]["name"].split()[0]
        channel = rng.choices(["slack", "teams", "email"], channel_w)[0]
        lines = []
        for who, tpl in rng.choice(scripts):
            lines.append((people[who], tpl.format_map(s)))
            if rng.random() < 0.12:
                lines.append((people[(who + 1) % len(people)], rng.choice(FILLER)))
        for _ in range(rng.choices([0, 1, 2, 4, 6], [50, 20, 15, 10, 5])[0]):  # long tail of short follow-ups
            lines.append((rng.choice(people), rng.choice(GENERIC_TAIL)))
        subject = channel_name(rng, region) if channel == "slack" else f"{name.replace('_', ' ').capitalize()}: {s['site']}" if channel == "email" else None
        thread = build_thread(rng, thread_id.format(source=channel), channel, subject, start, lines)
        return thread, ({"id": thread["id"], "kind": kind, "family": name} if kind != "noise" else None)
