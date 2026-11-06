# The challenge

**Elisa — Capturing and Linking Human-Generated Contextual Metadata for Autonomous Network Operations** (Since AI Hackathon 2026, Turku, 6–8 November 2026)

> **Sources of truth:** the [challenge brief](elisa/challenge-brief.pdf), the [pitch slides](elisa/sinceai-2026-challenge-pitch-elisa.html) and the example material in [`data/elisa/`](../data/elisa/). This file summarises them and adds what was said orally at the presentation (marked *oral*).

**Challenge (Elisa):** capture human-generated knowledge with minimal or no extra work for specialists, bind it to the right network context, and make it available to AI agents, so that autonomous workflows can run end to end.

**Guiding question:** how could we collect silent metadata without creating additional work for our specialists?

This file is the **reference for scope**. Every idea in [ideas.md](ideas.md) is checked against it.

| | |
| --- | --- |
| Our job | Listen → understand → produce machine-readable context assertions bound to graph entities, that an agent reuses |
| In scope | Channels specialists already use (Teams chats, email); finding the one sentence of real knowledge in a conversation; extracting the rule or fact; binding it to the right entities with `valid_from` / `valid_to`; source, trust and conflicts; reuse by an agent on a similar case |
| Out of scope | Elisa's own workflows and systems (no access given); ticketing systems; fault detection or root-cause analysis (Elisa's AI already does it); a full network management system; privacy and GDPR compliance (*oral*) |
| Recommended approaches (brief) | Knowledge graphs, agents, graph databases (Neo4j or Google Spanner) |
| Compute | Not a constraint: "not the models or the compute" is what blocks Elisa (slides) |
| Licence | The team owns the output; Elisa gets a perpetual, non-exclusive, royalty-free licence to use it (brief, section 07) |

## The material

All in [`data/elisa/`](../data/elisa/). Deliberately small; names and node IDs are illustrative.

| File | Content |
| --- | --- |
| `use_case.md` | Erkki's case in plain language + the locked-barrier example |
| `teams_chat.json` | 12 messages (`seq` 1–12), authors with roles, **times only (09:14–09:27), no date** |
| `email.txt` | Erkki's email reply on the same case |
| `reference_architecture.png` | Time-aware layers; context assertion → BINDING → graph entity |

**Synthetic data is encouraged** (other devices, advice that goes out of date, experts who disagree, simple network records). **We must document what we generated and how.**

## The two stories

**Locked barrier (Northern Finland).** AI correctly identifies a faulty device, an engineer is dispatched, and stops at a locked barrier on a private road. The key's location was only in an email. The material does not say where the key was.

**Erkki and TRN-042 (main case).** Veikko, field engineer, replaced an SFP on transmission node TRN-042: link UP, optics normal, alarms cleared, but no traffic. He asks Erkki on Teams. Older unit (around 2019)? Don't trust the green link status; check the counters; if they stay at zero, disable the interface, wait, enable it; don't reboot unless that fails. Traffic comes back (`seq` 9).

The rule: *on older units, after an SFP swap, UP + normal optics + zero counters means a forwarding-state issue: bounce the interface before replacing hardware or rebooting.* Where it sits: chat `seq` 2–4, 6, 8, 10; verified by `seq` 9; the email restates it ("has solved the issue in several cases").

"Is this documented somewhere?" — "Not that I know of 😄". Elisa: **that smiley is the problem.** An agent can't call Erkki at 3 a.m.

## Elisa's network model

| Layer | Meaning |
| --- | --- |
| Intent / design | as-designed |
| Physical / passive | as-built |
| Runtime / active | as-running: temporal graph (topology, CM snapshots) + telemetry |
| **Context** | **as-experienced: missing.** Workarounds, site access, why a config is odd, what actually fixed it. **This is what we build.** |
| Event stream | as-observed |

Each context assertion is **bound to a graph entity** and has **`valid_from` / `valid_to`** (`valid_to` defaults to "still believed true"), so all layers can be cross-referenced at any time `t`.

## What makes it hard (Elisa's five points)

1. **The real knowledge:** twelve messages, about one sentence of rule.
2. **Linking:** "these older units": TRN-042 only, the model, the install year? **A wrong link is worse than none.**
3. **Time:** firmware fixes the bug, the barrier gets a new lock. When does it stop being true?
4. **Trust:** hunch or verified fix? Two experts disagree? Who said it, and where?
5. **People:** these are colleague conversations. GDPR is out of scope (*oral*), but how specialists feel about being "captured" is worth one line in the pitch.

## Evaluation

| Level | Criterion |
| --- | --- |
| **Primary** | **Usability:** useful context captured and linked with minimal extra work, ideally from Teams and email |
| Secondary | Relevance of the captured context |
| Secondary | Linking: right entity, right time validity |
| Secondary | Technical feasibility |
| Secondary | Fit for agentic network operations |

"If your solution needs Erkki to fill in a form, Erkki won't fill in the form."

**Strong demo (brief):** (1) knowledge captured from the chat or email with no documentation task; (2) stored as a context assertion linked to the relevant entities (TRN-042, older transmission units, SFP replacement) with source and validity; (3) on a similar case, an agent retrieves it and proposes checking the counters and bouncing the interface before hardware swap or reboot.

## Deliverables and contacts

- **Working demo, pitch slides, documentation, code repo**, submitted via [sinceai.app](https://sinceai.app) by **Sunday 8 November 2026, 10:00**. Elisa reviews 10:00–13:00.
- Questions: Joni Nuvola (AI Architect, Discord `jnuvola`) and Matti Penttilä (Head of Autonomous Network Operations), at the Elisa stand and on the Since AI Discord.

## Scope checklist

A strong proposal answers yes to all "must" lines.

| Check | Level |
| --- | --- |
| Starts from the channels specialists already use (Teams, email) | Must |
| Needs no extra work from specialists (no form, no wiki, no confirmation click) | Must |
| Binds knowledge to the right graph entity, with a validity period | Must |
| Output is machine-readable and usable by an agent without a human reading it | Must |
| Shows reuse: an agent applies the knowledge to a similar case | Must |
| Handles trust (hunch vs. verified, disagreement) and the end of validity | Should |
| Links at the right generality (instance, model, install year) rather than overlinking | Should |
| Builds Elisa's workflows, a ticketing system, or GDPR handling | **Out of scope: drop** |
| Detects or diagnoses faults from network data | **Out of scope: Elisa's AI already does it** |

"Finding the real problem" means extracting the rule **as humans state it**, not diagnosing a fault from alarms or telemetry.
