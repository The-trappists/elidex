# Demo, risks and open questions

## Demo shape (adapt to the chosen idea)

Elisa described a strong demo as **1. Capture, 2. Link, 3. Reuse**. A 3-minute demo can follow that arc whatever the idea:

1. **The problem:** a noisy Slack/Discord channel or email thread; one line holds knowledge nobody would ever file.
2. **Capture:** the conversation is processed and the useful knowledge is extracted, with no human input.
3. **Link:** the knowledge is attached to the right network element, with its source, date and confidence.
4. **Reuse:** show the machine-readable context an autonomous workflow would receive, and what it changes. We do not build Elisa's workflow; a minimal stand-in is enough to show the context is exploitable.
5. **The numbers:** precision/recall of filtering and linking on a labelled set.

### Candidate scenario (from Elisa's own example)

A device fails, the AI diagnoses it, an engineer is dispatched, and the visit stops at a locked barrier on a private road. Months earlier, an email said where the key is.

| Step | What the demo shows |
| --- | --- |
| Capture | The email (among noise) is detected as operational knowledge |
| Link | The fact "barrier key at the neighbouring farm" is linked to the site, typed as `access` |
| Reuse | The context for that site, as JSON, includes the access fact with source and confidence; the dispatch plan includes fetching the key |

Other payoff moments, per idea:

| Idea | Payoff moment |
| --- | --- |
| A — Context API | The workflow's context includes the warning, with the cited message |
| B — Ask-before-act guard | The reroute action is blocked or adapted before it runs |
| C — Capture bot | The bot proposes "Save this for SITE-TKU-042?" right in the chat (conflicts with "no human input") |
| D — Incident memory | The next similar incident gets the past fix suggested |
| E — Conditional knowledge | A snow forecast triggers a warning before anything breaks |
| F — Lifecycle | A stale fact is detected and its owner is asked to confirm (conflicts with "no human input") |

## Risks (common to all ideas)

| Risk | Possible mitigations |
| --- | --- |
| Entity linking picks the wrong element | Alias table; confidence threshold; low-confidence links marked in the output |
| Stale or contradicting knowledge | Freshness decay at query time; versioning instead of deleting; conflicts flagged |
| Implicit knowledge missed ("^^", hedges, "we learned it over the years") | Prompt and label examples for implicit statements; map hedges to lower confidence |
| Output too vague to be exploited by a machine | Fixed types and fields (see [data-model.md](data-model.md)); no free-text-only output |
| No real data from Elisa | Synthetic data ready early; swap in theirs when it comes |
| Compute cost (Elisa's stated bottleneck) and LLM rate limits | Cheap filter before the LLM; cache results; small batch for the live demo |
| Scope drift (workflows, tickets, fault detection, full NMS) | Check every feature against the [scope checklist](challenge.md#scope-checklist) |
| Demo breaks live | Recorded backup video |

## Open questions for Elisa mentors

- [ ] What data will we get: format, size, language (Finnish, English or both)? The language also drives the model choice.
- [ ] Is there a real network-element inventory or ID format we should match?
- [ ] Which context types and actions do their workflows consume (access, known issue, workaround, contact…)? This shapes our taxonomy.
- [ ] Which LLMs and compute may we use during the event? (LUMI AI Factory and Red Hat are listed as technology partners.)
- [ ] Would a proactive angle (idea E) be welcome, or seen as too close to fault detection?
- [x] How will the challenge be judged? Relevance, Linking, Feasibility, Agent-ready, with minimal extra work for people.
- [x] Any constraints on sending message data to external LLM APIs? Privacy and GDPR are not to be considered.
- [x] What consumes the output? Elisa's autonomous network workflows; integrating with them is not our job.
