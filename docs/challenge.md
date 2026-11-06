# The challenge

**Elisa — Hidden knowledge: capturing and linking human-generated context for autonomous network operations** (Since AI Hackathon 2026)

> **Source of truth:** Elisa's pitch slides, [docs/elisa/sinceai-2026-challenge-pitch-elisa.html](elisa/sinceai-2026-challenge-pitch-elisa.html). This file summarises them and adds what was said orally at the presentation.

**Challenge statement (Elisa):** capture human-generated knowledge, bind it to the right network context, and make it available to AI agents, so that autonomous workflows can run end to end.

**Guiding question (Elisa):** how could we collect silent metadata without creating additional work for our specialists?

This file is the **reference for scope**. Every idea in [ideas.md](ideas.md) is checked against it.

| | |
| --- | --- |
| Our job | Listen → parse → filter → understand the real problem → produce machine-readable context assertions that agents can use |
| In scope | Ingesting the channels specialists already use (Teams chats, email); detecting the few sentences of real knowledge in a long conversation; extracting the rule or fact; binding it to the right graph entities with a validity period (`valid_from` / `valid_to`); source, trust and conflicts; reuse by an agent on a similar case |
| Out of scope | Elisa's own workflows and systems (no system access is given); ticketing systems; fault detection or root-cause analysis (Elisa's AI already does it); a full network management system; privacy and GDPR compliance (said orally at the presentation) |
| Material | `use_case.md`, `teams_chat.json` (12-message Teams conversation), `email.txt` (same case as an email from Erkki), `reference_architecture.png`. Deliberately small and illustrative; no production data |
| Synthetic data | Encouraged: other devices, advice that goes out of date, experts who disagree. **Document what we generated and how** |
| IP | The team owns the result |
| Core techniques | Text classification, entity linking, knowledge graphs, GraphRAG |

## The two stories

**Story 1 — the locked barrier (Northern Finland).** A device fails, the AI diagnoses it correctly, an engineer is dispatched, and the cycle stops at a locked barrier on a private road. The key's location was in an email, not in any system the AI could see.

**Story 2 — Erkki and TRN-042 (the main case).** Veikko, field engineer, replaced an SFP on transmission node TRN-042: link UP, optics normal, alarms cleared, but no traffic. He asks Erkki, the expert, on Teams. Erkki: older unit (around 2019)? Don't trust the green link status; check the counters; if they are zero, disable the interface, wait, enable it, don't reboot. Traffic comes back.

The rule hidden in twelve messages: *on older units, after an SFP swap, UP + normal optics + zero counters means a forwarding-state issue: bounce the interface first, don't reboot or swap hardware.*

"Is this documented somewhere?" — "Not that I know of 😄 We've just learned it over the years." Elisa: **that smiley is the problem.** An agent can't call Erkki at 3 a.m.

## Elisa's network model

Elisa describes the network in layers. Decades of data tell **what**; nothing captures **why**.

| Layer | Meaning |
| --- | --- |
| Intent / design | as-designed |
| Physical / passive | as-built |
| Runtime / active | as-running (topology, telemetry) |
| Event stream | as-observed |
| **Context** | **as-experienced: missing.** Workarounds, site access, why a config is odd, what actually fixed it |

Reference architecture: layers are time-aware. **Each context assertion is bound to a graph entity and has `valid_from` / `valid_to`** (`valid_to` defaults to "still believed true"), so all layers can be cross-referenced at any point in time.

## What makes it hard (Elisa's five points)

1. **The real knowledge:** twelve messages of chat, about one sentence of actual rule.
2. **Linking:** "these older units": TRN-042 only, the model, the install year? **A wrong link is worse than none**; an autonomous system acts on it confidently.
3. **Time:** firmware fixes the bug, the barrier gets a new lock. When does it stop being true?
4. **Trust:** hunch or verified fix? Two experts disagree? Who said it, and where?
5. **People:** these are colleague conversations. How does it feel to be on the other side? (Elisa said GDPR compliance is not to be considered; how specialists feel about being "captured" is still worth one line in the pitch.)

## Evaluation

| Level | Criterion |
| --- | --- |
| **Primary** | **Usability:** useful context captured and linked with minimal extra work, ideally from channels specialists already use (Teams, email) |
| Secondary | Relevance of the captured context |
| Secondary | Linking: right entity, right time validity |
| Secondary | Feasibility: technically realistic |
| Secondary | Agent-ready: fits agentic network operations |

"If your solution needs Erkki to fill in a form, Erkki won't fill in the form."

## Deliverables and dates

- **Demo, slides, docs and code repo**, submitted via [sinceai.app](https://sinceai.app) by **Sunday 8 November 2026, 10:00**.
- Elisa reviews on Sunday, 10:00–13:00.
- Questions all weekend: Joni Nuvola (AI Architect) and Matti Penttilä (head of Autonomous Network Operations), at the Elisa stand and on the Since AI Discord.

## Scope checklist

Use it to test any idea or feature. A strong proposal answers yes to all "must" lines.

| Check | Level |
| --- | --- |
| Starts from the channels specialists already use (Teams, email) | Must |
| Needs no extra work from specialists (no form, no wiki, no closure comment) | Must |
| Binds knowledge to the right graph entity, with a validity period | Must |
| Output is machine-readable and usable by an agent without a human reading it | Must |
| Shows reuse: an agent applies the knowledge to a similar case | Must |
| Handles trust (hunch vs. verified, disagreement) and the end of validity | Should |
| Links at the right generality (instance, model, install year) rather than overlinking | Should |
| Builds Elisa's workflows, a ticketing system, or GDPR handling | **Out of scope: drop** |
| Detects or diagnoses faults from network data | **Out of scope: Elisa's AI already does it** |

"Finding the real problem" means extracting the rule **as humans state it** in a conversation, not diagnosing a fault from alarms or telemetry.

## Corrections to earlier notes

Our notes from the talk said compute was Elisa's bottleneck. The slide says the opposite: **"Not the models or the compute."** The blocker is human knowledge. Compute frugality is a nice-to-have, not a requirement.
