# The challenge

**Elisa — Silent Knowledge for Autonomous Network Operations** (Since AI Hackathon 2026)

Operational knowledge lives in chats, emails and people's heads ("that site's backup link is flaky in winter"). The challenge: capture it with no extra admin work, link it to the right network element or incident, and expose it as machine-readable context for automated workflows.

This file is the **reference for scope**. Every idea in [ideas.md](ideas.md) is checked against it.

| | |
| --- | --- |
| In scope | Detecting relevant snippets in unstructured messages; entity linking to equipment and incident IDs; a knowledge graph or schema for context; a retrieval API an automation agent queries; confidence and freshness of each fact |
| Out of scope | The fault-detection AI itself; a full network management system |
| Likely inputs | Sample or synthetic tickets, chat logs, an inventory of network elements |
| IP | The team owns the result |
| Core techniques | Text classification, entity linking, knowledge graphs, GraphRAG |

## Scope checklist

Use it to test any idea or feature. A strong proposal answers yes to all four "must" lines.

| Check | Level |
| --- | --- |
| Starts from unstructured human communication (chats, emails, tickets) | Must |
| Needs no extra admin work from the people writing those messages | Must |
| Links knowledge to a network element or incident | Must |
| Output is machine-readable and consumable by an automated workflow | Must |
| Handles confidence and freshness of knowledge | Should |
| Respects the privacy of employee messages | Should |
| Detects faults itself, or rebuilds network management | **Out of scope: drop or reframe** |

## To confirm

The [official challenge page](https://sinceai.app/events/since-ai-hackathon-2026/elisa) only loads in a browser, so everything above comes from our scoping guide. Confirm the open questions in [demo-and-risks.md](demo-and-risks.md#open-questions-for-elisa-mentors) with the Elisa mentors on day one.
