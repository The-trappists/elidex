# Idea directions

> **Status: exploring.** No idea is chosen yet. Record the choice in [decisions.md](decisions.md).

Every idea shares the same core, which is the base of the demo Elisa describes: **capture** from chat and email → **link** to graph entities with validity → **reuse** by an agent on a similar case. The ideas differ in where the original angle sits. Each one below passes the [scope checklist](challenge.md#scope-checklist).

| # | Direction | Original angle | Demo impact | Effort |
| --- | --- | --- | --- | --- |
| A | Context layer for agents | The missing "as-experienced" layer, exposed as an agent tool | Medium | Medium |
| B | Ask-before-act guard | Checks an agent's planned action against human knowledge | High | Medium |
| C | Conditional rules | Knowledge stored as conditions → action that an agent can test | High | Medium–high |
| D | Knowledge lifecycle, silently | Validity and conflicts updated from later messages, no human confirmation | Medium | Medium |

## A — Context layer for agents

- **Pitch:** an agent asks "what do humans know about TRN-042?" and gets the assertions valid now for that node **and its class**, with source, trust and validity.
- **Core:** extract → link → store → `get_context(entity, at_time)` tool (MCP or REST).
- **Strength:** matches the brief word for word; it is the base the others build on.
- **Weakness:** the expected answer; originality must come from linking precision and time handling.

## B — Ask-before-act guard

- **Pitch:** before an agent acts ("reboot TRN-117", "dispatch engineer to SITE-X"), the guard looks up human knowledge and returns *go* or *adapt*, citing the message. Erkki's rule turns "reboot" into "bounce the interface first"; the barrier email adds "get the key" to a dispatch.
- **Core:** A + a mapping from action and entity to assertions.
- **Strength:** shows the value in one moment.
- **Weakness:** a mock agent only; don't build Elisa's workflow.

## C — Conditional rules

- **Pitch:** Erkki's knowledge is not a fact, it is a rule: *older unit + after SFP swap + UP + normal optics + zero counters → bounce the interface, avoid reboot*. Store the conditions in a form an agent can check against the node's attributes and counters.
- **Core:** A + condition extraction + a small evaluator in the demo agent.
- **Strength:** the agent fires the rule only when it applies; easy to show on a similar and a non-similar case.
- **Weakness:** harder extraction. Checking conditions is fine; diagnosing faults from telemetry is out of scope.

## D — Knowledge lifecycle, silently

- **Pitch:** knowledge goes out of date. A later message ("firmware 4.2 fixes the forwarding bug", "new lock on the barrier") closes `valid_to`; two experts who disagree are both kept with a conflict flag; "traffic is back" upgrades a hunch to verified.
- **Core:** A + matching new messages against existing assertions.
- **Strength:** answers Elisa's "time" and "trust" points directly; synthetic data for it is explicitly encouraged.
- **Weakness:** weak alone; best as a feature on top of A.
- **Rule:** no "is this still true?" prompt to a human; that is extra work.

## Combinations

- **A + C:** the context layer stores rules; the agent applies them only when conditions hold. Closest to Elisa's demo.
- **A + B:** the layer is the product, the guard is the demo.
- **A + D:** the extra "time" and "trust" scenes that make the demo stand out.

## Framing for the pitch

Elisa already has a digital twin and agents built with Google ADK / A2A (public sources). Elisa Industriq's "Digital Master" exposes what the **machines** know through Graph APIs and MCP. We add what the **humans** know, using the same element IDs and the same kind of interface. Do not claim a real integration: we know nothing about their APIs.

## Your ideas

| Idea | Original angle | Scope check (see [challenge.md](challenge.md#scope-checklist)) | Proposed by |
| --- | --- | --- | --- |
| | | | |
