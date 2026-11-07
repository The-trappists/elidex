"""Shared text helpers: how people mention things, write, and how a thread is rendered per channel."""

from __future__ import annotations

from datetime import datetime, timedelta
from random import Random

GREET = ["Hei! ", "Hi, ", "Moi, ", "Hello, ", "", "", "", ""]
FILLER = ["ok", "thanks!", "will do", "👍", "kiitos", "one sec", "just parked, checking", "back in 10", "noted", "joo", "ok ok", "on it"]
EMOJI = ["👍", "🙂", "🙏", "👌", "😅"]
SIGN_OFF = ["BR,", "Best regards,", "Terveisin,", "Thanks,", "Cheers,"]
CHANNEL_POOL = ["#noc-general", "#field-ops", "#transmission", "#radio-ops", "#site-access", "#maintenance-windows", "#oncall", "#field-{region}"]


def slug(text: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in text.lower()).strip("-")


def first_name(user: dict) -> str:
    return user["name"].split()[0]


def ref_strong(rng: Random, el: dict) -> str:
    """A mention the linker can resolve: the id (70%) or the site-based alias."""
    return el["id"] if rng.random() < 0.7 or not el["aliases"] else el["aliases"][0]


def ref_weak(rng: Random, el: dict, site: dict | None) -> str:
    r = rng.random()
    if r < 0.4 or site is None:
        return ref_strong(rng, el)
    if r < 0.8:
        return f"the {el['model']} at {site['name']}"
    return rng.choice(["it", "that box", "the unit", "the node"]) if el["type"] == "transmission_node" else "it"


def flavor(rng: Random, text: str, style: str) -> str:
    """Give a line the voice of its author. IDs and numbers are never touched."""
    if style == "terse":
        words = text.split(" ", 1)
        if words[0].isalpha() and not words[0].isupper():
            text = words[0].lower() + (" " + words[1] if len(words) > 1 else "")
        return text.rstrip(".")
    if style == "chatty" and rng.random() < 0.5:
        return text.rstrip(".") + rng.choice([" tho", " btw", " 👍", " haha", ""])
    if style == "emoji" and rng.random() < 0.5:
        return text + " " + rng.choice(EMOJI)
    if style == "finglish" and rng.random() < 0.4:
        return rng.choice(["Joo, ", "No niin, ", "Hei, "]) + text[0].lower() + text[1:]
    return text


def stamp(rng: Random, start: datetime, n: int, channel: str) -> list[datetime]:
    """Send times of n messages: bursts of seconds to minutes, now and then a pause of hours (or a day for email)."""
    times, t = [], start
    for _ in range(n):
        times.append(t)
        if channel == "email":
            t += timedelta(minutes=rng.randint(20, 900))
        elif rng.random() < 0.12:
            t += timedelta(minutes=rng.randint(60, 360))
        else:
            t += timedelta(seconds=rng.randint(8, 420))
    return times


def email_body(rng: Random, user: dict, text: str, prior: str | None) -> str:
    greeting = rng.choice(["Hi,", "Hello,", "Hei,", "Moi,"])
    body = f"{greeting}\n\n{text}\n\n{rng.choice(SIGN_OFF)}\n{user['name']}\n{user['role']} | Demo Operator Oy\n{user['email']}"
    if prior:
        quoted = "\n".join("> " + line for line in prior.splitlines())
        body += f"\n\n-----Original Message-----\n{quoted}"
    return body


def channel_name(rng: Random, region: str) -> str:
    return rng.choice(CHANNEL_POOL).format(region=slug(region))


def build_thread(
    rng: Random, thread_id: str, channel: str, subject: str | None, start: datetime, lines: list[tuple[dict, str]]
) -> dict:
    """Render [(user, text)] as a thread record, in the format of the core `Thread` (one more field: author_id)."""
    times = stamp(rng, start, len(lines), channel)
    messages, prior = [], None
    for seq, ((user, text), sent) in enumerate(zip(lines, times), 1):
        body = email_body(rng, user, text, prior) if channel == "email" else flavor(rng, text, user["style"])
        prior = text
        messages.append({
            "seq": seq, "author": user["name"], "author_id": user["id"], "role": user["role"],
            "sent_at": sent.isoformat(timespec="seconds"), "text": body,
        })
    return {"id": thread_id, "source": channel if channel != "teams" else "teams", "subject": subject, "messages": messages}
