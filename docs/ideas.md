# Idea directions

> **Status: exploring.** No idea is chosen yet. These are starting points to discuss, combine or replace. Add your own at the bottom, and record the final choice in [decisions.md](decisions.md).

All ideas share the same core (capture → link → serve). They differ in **where the original angle sits**.

> **After Elisa's slides** (see [challenge.md](challenge.md)): the deliverable is context assertions bound to graph entities with a validity period, captured from Teams and email with no extra work for specialists, and **reused by an agent on a similar case** (Erkki's case). Usability is the primary criterion. So:
> - **A** is the base every idea needs (the context layer + agent access).
> - **D** matches Elisa's "Reuse" step almost word for word: Erkki's fix suggested on the next similar node.
> - **E** fits Erkki's rule naturally (conditions: old unit, after SFP swap, zero counters).
> - **B** must not turn into building Elisa's workflow; at most a minimal agent for the demo.
> - **C** and **F** rely on a human confirming facts, which "no extra work" rules out; keep only their silent parts (auto-capture, automatic `valid_to` and conflict detection).

## Overview

| # | Direction | Original angle | Scope fit | Demo impact | Effort |
| --- | --- | --- | --- | --- | --- |
| A | Context API for agents | Knowledge graph that agents query before acting | Full | Medium | Medium |
| B | Ask-before-act guard | Intercepts automated actions and blocks or adapts them using human knowledge | Full | High | Medium |
| C | Passive capture bot | Detects knowledge as it is typed in chat; one-click confirmation | Full (watch: "no extra admin") | High | Medium |
| D | Incident memory miner | Learns cause → fix patterns from past incident threads | Full | Medium | Medium–high |
| E | Conditional knowledge | Facts with conditions (weather, season, load) that turn active when the condition is met | Full | High | High |
| F | Knowledge lifecycle | Detects stale or conflicting facts and asks the right person to re-confirm | Partial: needs A or C as a base | Low–medium | Medium |

## A — Context API for agents

- **Pitch:** an automated workflow asks "what do humans know about this element?" and gets facts with source, date and confidence.
- **Core:** classify messages → extract facts → link to elements → graph → retrieval API.
- **Strength:** matches the brief almost word for word; easy for judges to map to the challenge.
- **Weakness:** the most expected answer; originality must come from execution quality (linking precision, freshness).

## B — Ask-before-act guard

- **Pitch:** a guard sits between the automation and the network. Before any action ("reroute to backup link"), it checks human knowledge and returns *go*, *adapt* or *ask a human*, with the cited message.
- **Core:** A's pipeline + an action-to-element mapper + a decision layer.
- **Strength:** shows the value in one moment; strong demo story.
- **Weakness:** needs a convincing set of automation actions; risk of drifting into building the automation itself.

## C — Passive capture bot

- **Pitch:** a bot in the team chat notices when someone shares operational knowledge and offers "Save this for SITE-TKU-042?" with one click (or saves silently above a confidence threshold).
- **Core:** real-time classifier + entity linker + lightweight confirmation UX.
- **Strength:** tackles "no extra admin work" head-on; human confirmation raises precision.
- **Weakness:** a confirmation click *is* a little admin work: keep it optional; needs a chat integration (or a mock).

## D — Incident memory miner

- **Pitch:** mine past incident tickets and the chat threads around them to learn "when X happens on this kind of element, people did Y", then suggest it on the next incident.
- **Core:** thread reconstruction around incidents, cause/fix extraction, pattern aggregation per element type.
- **Strength:** generalises knowledge beyond a single element.
- **Weakness:** needs realistic historical data; patterns are hard to evaluate in 48h.

## E — Conditional knowledge

- **Pitch:** "flaky in winter" is not a static fact, it is a rule. Extract the condition, join it with live signals (weather forecast, calendar, traffic load) and warn *before* the problem happens.
- **Core:** A's pipeline + condition extraction + a rule evaluator + one external signal (e.g. a weather API).
- **Strength:** clearly original; turns silent knowledge into proactive knowledge.
- **Weakness:** most complex; watch that proactive warnings don't become fault detection (out of scope).

## F — Knowledge lifecycle

- **Pitch:** knowledge rots. Track freshness, detect contradictions, and route a short "is this still true?" to the person most likely to know.
- **Core:** fact versioning, contradiction detection, routing.
- **Strength:** addresses the "freshness" requirement better than anyone else.
- **Weakness:** weak alone; best as a feature on top of A or C.

## Possible combinations

- **A + B:** the API is the product, the guard is the demo.
- **C + F:** capture and maintain, the full lifecycle of human knowledge.
- **A + E:** the graph stores conditions; one live signal makes the demo memorable.

## Your ideas

| Idea | Original angle | Scope check (see [challenge.md](challenge.md#scope-checklist)) | Proposed by |
| --- | --- | --- | --- |
| | | | |
