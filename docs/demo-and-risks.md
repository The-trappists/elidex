# Demo, risks and open questions

## Demo shape

Elisa's slides describe the strong demo: **Erkki's case, end to end** (see [challenge.md](challenge.md#the-two-stories)).

| Step | Elisa's definition | What we show |
| --- | --- | --- |
| **Capture** | Knowledge is taken from the chat or email, with no separate documentation step | `teams_chat.json` (12 messages) and `email.txt` go in; one rule comes out |
| **Link** | Stored as a context assertion bound to the right entities, with its source and validity period | The rule is bound to TRN-042 **and** to the right class (older units, ~2019 model), with source, `valid_from` / `valid_to` and trust |
| **Reuse** | On a similar case, an agent proposes: check the counters, bounce the interface, before hardware swaps or reboots | A new synthetic case on **another** old node: the agent's context includes the rule, and it proposes the bounce first |

Then **the numbers:** relevance and linking precision on our labelled synthetic set.

Possible extras, if time allows, each tied to one of Elisa's "hard" points:

| Extra | Hard point |
| --- | --- |
| The barrier-key email bound to a site, typed as access knowledge | Real knowledge outside technical topics |
| A firmware update that ends the rule's validity (`valid_to` set) | Time |
| Two experts who disagree; both kept, trust shown | Trust |
| An ambiguous "these units" that the system refuses to overlink | Linking: a wrong link is worse than none |

Payoff moments per idea:

| Idea | Payoff moment |
| --- | --- |
| A — Context API | The agent's context for the new node includes Erkki's rule, with the cited message |
| B — Ask-before-act guard | A "reboot" or "swap SFP" action is adapted to "bounce the interface first" |
| C — Capture bot | Silent capture only; a confirmation prompt conflicts with "no extra work" |
| D — Incident memory | The next similar incident gets Erkki's fix suggested: this is exactly Elisa's "Reuse" step |
| E — Conditional knowledge | The rule fires only when its conditions (old unit, after SFP swap, zero counters) hold |
| F — Lifecycle | A firmware fix ends the rule's validity automatically |

## Risks (common to all ideas)

| Risk | Possible mitigations |
| --- | --- |
| Wrong link (Elisa: worse than no link) | Alias table and model/install-year attributes in the inventory; abstain below a confidence threshold; prefer the narrowest entity the text supports |
| Linking at the wrong generality (TRN-042 only vs. all ~2019 units) | Extract the scope the speaker states ("older units"), bind to a class entity, keep the instance as evidence |
| Stale knowledge (firmware fix, new lock) | `valid_from` / `valid_to`; close validity when a later message or change contradicts it |
| Experts disagree, or a hunch looks like a fact | Trust fields (verified outcome such as "traffic is back" vs. hunch); keep both assertions, flag the conflict |
| Implicit knowledge missed (😄, hedges, "learned it over the years") | Prompt and label examples for implicit statements |
| Output too vague for an agent | Fixed fields (see [data-model.md](data-model.md)); never free text only |
| Tiny material (one case) | Generate more synthetic data early (other devices, outdated advice, disagreement) and **document how** |
| LLM cost or rate limits | Cache results; small batch for the live demo |
| Scope drift (workflows, tickets, fault detection, full NMS) | Check every feature against the [scope checklist](challenge.md#scope-checklist) |
| Demo breaks live | Recorded backup video |

## Open questions for Elisa mentors

Ask Joni or Matti at the Elisa stand or on the Since AI Discord.

- [ ] Language of real conversations at Elisa: Finnish, English or both? The material looks English; real Teams chats may not be.
- [ ] Is there an inventory or ID scheme beyond TRN-042 (node types, models, install year) we should mimic in synthetic data?
- [ ] Should the agent consume context through a specific interface or format, or is ours free?
- [ ] Would a proactive angle (idea E) be welcome, or seen as too close to fault detection?
- [ ] Are Polystar's Kalix agents the intended consumer of our output? (See [ideas.md](ideas.md#context-polystar-elisas-assurance-platform).)
- [ ] What goes into Kalix's "integrated knowledge base" today, and does it include any human-written content?
- [ ] In what format does Polystar expose alarms, anomalies and network-element IDs, so our mock consumer looks realistic?
- [x] How will the challenge be judged? Usability first; then relevance, linking, feasibility, agent-ready.
- [x] What data will we get? `use_case.md`, `teams_chat.json`, `email.txt`, `reference_architecture.png`; generate more and document it.
- [x] Any constraints on sending message data to external LLM APIs? No production data is involved, and GDPR is not to be considered.
- [x] Which compute? Not a constraint per Elisa ("not the models or the compute"; "models can be rented").
