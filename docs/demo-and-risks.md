# Demo, risks and open questions

## Demo shape (adapt to the chosen idea)

A strong 3-minute demo follows the same arc whatever the idea:

1. **The problem:** a noisy chat channel; one line holds knowledge nobody would ever file ("the backup link at that site fails in snow").
2. **Capture:** the message is processed live and linked to the right element.
3. **The knowledge:** show it stored with its source, date and confidence.
4. **The payoff:** an automated workflow uses it, and the outcome changes because of it. This step is where the ideas differ:

   | Idea | Payoff moment |
   | --- | --- |
   | A — Context API | The agent's context includes the warning, with the cited message |
   | B — Ask-before-act guard | The reroute action is blocked or adapted before it runs |
   | C — Capture bot | The bot proposes "Save this for SITE-TKU-042?" right in the chat |
   | D — Incident memory | The next similar incident gets the past fix suggested |
   | E — Conditional knowledge | A snow forecast triggers a warning before anything breaks |
   | F — Lifecycle | A stale fact is detected and its owner is asked to confirm |

5. **The numbers:** precision/recall of capture and linking on a labelled set.

## Risks (common to all ideas)

| Risk | Possible mitigations |
| --- | --- |
| Entity linking picks the wrong element | Alias table; confidence threshold; low-confidence links flagged for review |
| Stale or contradicting knowledge | Freshness decay at query time; versioning instead of deleting |
| Privacy of employee messages | Hash authors; keep short spans only; mention it in the pitch |
| No real data from Elisa | Synthetic data ready early; swap in theirs when it comes |
| LLM cost or rate limits | Cache results; small batch for the live demo |
| Scope drift (fault detection, full NMS) | Check every feature against the [scope checklist](challenge.md#scope-checklist) |
| Demo breaks live | Recorded backup video |

## Open questions for Elisa mentors

- [ ] What data will we get: format, size, language (Finnish, English or both)?
- [ ] Is there a real network-element inventory or ID format we should match?
- [ ] How will the challenge be judged, and what does Elisa value most (precision, integration, originality, UX)?
- [ ] Which LLMs and compute may we use? (LUMI AI Factory and Red Hat are listed as technology partners.)
- [ ] Any constraints on sending message data to external LLM APIs?
- [ ] What automation tools would consume the output in Elisa's real setup?
- [ ] Would a proactive angle (idea E) be welcome, or seen as too close to fault detection?
