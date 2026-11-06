# The challenge

**Elisa — Silent Knowledge for Autonomous Network Operations** (Since AI Hackathon 2026)

Operational knowledge lives in chats, emails and people's heads ("that site's backup link is flaky in winter"). The challenge: listen to the conversations where it is shared, extract what matters, link it to the right network element or incident, and output it as **machine-readable context that Elisa's autonomous network workflows can use**.

This file is the **reference for scope**. Every idea in [ideas.md](ideas.md) is checked against it.

| | |
| --- | --- |
| Our job | Listen → parse → filter → understand the real problem → produce machine-readable context |
| In scope | Ingesting company conversations (Slack, Discord, email); detecting the snippets that hold operational knowledge; extracting the real problem as people describe it; entity linking to network elements and incidents; confidence, freshness and source of each fact; a machine-readable output (schema, graph, API) |
| Out of scope | Elisa's own workflows (we produce the context, not its use); ticketing systems; fault detection or diagnosis from network data; a full network management system; privacy and GDPR (Elisa said not to consider them) |
| Likely inputs | Slack, Discord and email conversations (real or synthetic); an inventory of network elements |
| IP | The team owns the result |
| Core techniques | Text classification, entity linking, knowledge graphs, GraphRAG |

## What Elisa said at the presentation

From the team's notes; Elisa stayed vague on its internal setup.

- **Goal:** give Elisa's autonomous workflows as much exploitable context as possible. Machine-readable matters because it then works with any system.
- **Motivating story:** a device fails, the AI diagnoses it, an engineer is dispatched, and the cycle stops at a locked barrier on a private road. Where the key was: in a private email. When humans ran the network this was manageable; with autonomous operations it is a hard stop.
- **Tacit knowledge:** "Not that I know of ^^ We've learned it over the years." The knowledge is often implicit, in tone and hedges, not stated as a fact.
- **No human input at all:** specialists must not do any extra work. If the solution requires human input, it won't work. Elisa insisted on this.
- **Compute, not models, is their bottleneck.** A frugal pipeline is an argument.
- **Knowledge has dimensions:** the fact itself, its linking, time (when did it stop being true), trust (who said it, where, with which status), and people (colleagues, conversations).
- **Reference flow:** capture human-generated knowledge → bind it to the right network context → make it available to agents → autonomous workflows can act.
- **Evaluation criteria:** Relevance, Linking, Feasibility, Agent-ready.
- **Strong demo:** 1. Capture, 2. Link, 3. Reuse.
- **Privacy and GDPR:** not to be considered.

## Scope checklist

Use it to test any idea or feature. A strong proposal answers yes to all four "must" lines.

| Check | Level |
| --- | --- |
| Starts from unstructured human communication (Slack, Discord, email) | Must |
| Needs no human input at all from the people writing those messages (not even a confirmation click) | Must |
| Links knowledge to a network element or incident | Must |
| Output is machine-readable and exploitable by an automated workflow without a human reading it | Must |
| Handles confidence and freshness of knowledge | Should |
| Stays frugal in compute | Should |
| Builds Elisa's workflows, a ticketing system, or privacy/GDPR handling | **Out of scope: drop** |
| Detects faults from network data, or rebuilds network management | **Out of scope: drop or reframe** |

"Finding the real problem" means reconstructing the problem **as humans describe it** in a conversation (e.g. "the barrier is locked, the key is at the neighbour's"), not diagnosing a fault from alarms or telemetry.

## To confirm

The [official challenge page](https://sinceai.app/events/since-ai-hackathon-2026/elisa) only loads in a browser. Confirm the remaining open questions in [demo-and-risks.md](demo-and-risks.md#open-questions-for-elisa-mentors) with the Elisa mentors.
