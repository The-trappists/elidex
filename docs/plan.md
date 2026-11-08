# Plan, demo and risks

> **Status: proposal.** Hours count from the official start. **Hard deadline:** demo, slides, docs and repo on [sinceai.app](https://sinceai.app) by **Sunday 8 November 2026, 10:00**.

## 48h plan

| Phase | Hours | Goals | Gate |
| --- | --- | --- | --- |
| Explore | H0 → H4 | Ask the mentors the open questions below; pick an [idea](ideas.md) | **Idea logged** in [decisions.md](decisions.md) |
| Foundations | H4 → H8 | Freeze the [schema](design.md); synthetic data v1; stack; repo structure | **Schema frozen** |
| Core v1 | H8 → H22 | Crude capture → link → store → agent, end to end on Erkki's case | **Runs end to end** |
| Differentiate | H22 → H36 | The idea's original angle; eval set and metrics | **Feature freeze** |
| Ship | H36 → H48 | Demo polish, slides, backup video, two rehearsals, docs on synthetic data | **Submitted** |

**Pick fast, then commit. End to end before polish.** A 10-minute stand-up at every gate.

| Workstream | Owns | Owner |
| --- | --- | --- |
| Data & eval | Synthetic chats, emails, network records; labelled set; metrics; doc of how data was generated | _TBD_ |
| Capture & link | Extraction prompts, entity and class linking | _TBD_ |
| Store & serve | Context store, `get_context` tool, validity logic | _TBD_ |
| Demo & pitch | Demo agent, UI, slides, script | _TBD_ |

## Demo

Elisa's strong demo is **Erkki's case, end to end** (see [challenge.md](challenge.md#evaluation)):

| Step | What we show |
| --- | --- |
| **Capture** | `teams_chat.json` and `email.txt` go in, nobody types anything; one rule comes out |
| **Link** | Bound to TRN-042 **and** the class (older transmission units, ~2019) and the SFP-replacement trigger, with sources, validity and trust |
| **Reuse** | Synthetic case on **another** old node: the agent proposes "check the counters, bounce the interface" before swapping the SFP or rebooting |

Then **the numbers**: extraction relevance and linking precision on our labelled synthetic set.

Extras if time allows, one per hard point:

| Extra | Hard point |
| --- | --- |
| A synthetic barrier-key email bound to a site; a dispatch gets "get the key first" | Real knowledge outside technical topics |
| A later firmware message closes the rule's `valid_to` | Time |
| Two experts disagree; both kept, trust shown | Trust |
| A similar case on a **new** unit: the agent does not apply the rule | Linking: no overlinking |

## Risks

| Risk | Mitigation |
| --- | --- |
| Wrong link (worse than none) | Bind to the narrowest entity the text supports; abstain below a threshold |
| Wrong generality (TRN-042 only vs. all ~2019 units) | Extract the scope the speaker states; bind to a class, keep the instance as evidence |
| Stale knowledge | `valid_from` / `valid_to`, closed by a later contradicting message |
| Hunch looks like a fact, experts disagree | Trust levels; keep both, flag the conflict |
| Implicit knowledge missed (😄, hedges) | Few-shot examples of implicit statements in the prompt |
| Tiny material | Generate synthetic data early and **document how** |
| Scope drift (workflows, tickets, fault detection) | Check every feature against the [scope checklist](challenge.md#scope-checklist) |
| Demo breaks live | Recorded backup video; cached LLM results |

### Over-linking: a case from the deployed dashboard (2026-11-07)

On the deployed dashboard (Gemini), the thread "TRN-088 first step after SFP swap" gave `ctx_0001` (Erkki: bounce first). It reached 9 elements, 4 of them wrongly:

- **TRN-240, a TX-5000** at the same site. The thread names the site ("Kangas"), and the linker bound every site as scope (`applies_to`), so the advice reached everything there. **Fixed:** when a class or an element already carries the scope, the site is bound as `observed_on` (where it was seen), and `get_context` counts `observed_on` only for the entity itself (`link.py`, `store.py`, tests in `tests/test_link.py`). Site-only knowledge (site access) is unchanged.
- **TRN-154, TRN-176, TRN-208, TX-3000s from 2020–2022.** Erkki said "the old TX-3000s"; the extractor kept the model and dropped "old", so the class covers every TX-3000. **Not fixed**, options below.

Possible improvements (proposals, not decided):

| Proposal | Effort | Trade-off |
| --- | --- | --- |
| Prompt rule: a class narrowed only by a vague word ("old", "legacy", "older units") with no year range is not filled; bind the instance only | ~10 min | More precise, but the advice no longer reaches the other old units until someone states years. Changes LLM behaviour: re-check the eval scenarios |
| Let the extractor return the qualifier (`scope.qualifier: "old"`) and have the linker turn it into a note "class wider than stated" plus a lower confidence | ~45 min | Keeps reach but makes the doubt visible; contract change in `models.Scope` |
| Linker note when a rule reaches an element of another model or type than the one cited in the thread | ~20 min | Detection only, no fix; cheap guard for the demo |
| Show the reach ("reaches 9 elements") on each knowledge card and in the pipeline Store step, with the elements the thread did not name highlighted | ~30 min | UI only; makes over-linking visible to a human reviewer at once |
| Eval scenario for this case (vague "old" + site name in text) with the expected reach | ~20 min | Prevents regressions; needs an agreed expected answer |
| Topic naming: the scenario expects `sfp-swap-first-step`, the LLM gave `tx-3000-post-sfp-swap-zero-counters`, so the eval counts one miss and one unexpected for the same knowledge. Compare on (type, scope, action) or give known topics to the prompt | ~30 min | Fairer eval; touches `processor.py` eval or the prompt |

### Follow-ups from the `accuracy` branch (2026-11-07, open)

Checked against every remote branch on 2026-11-07: none of these is fixed yet.

1. **Failing test `test_every_scenario_file_validates_and_is_sorted`.** The 5 `adversarial-*` scenarios on main (commit `eaca715`) have empty `tags`, no `expected`, and personas missing from `personas.json` (`bot-relay`, `pirjo`, `matias`, `niko`). Fix: add tags and the personas, or move the files out of `data/dashboard/scenarios/`. `worktree-loop-v2` sets the count to `== 25`, and `accuracy` counts the files instead: expect a merge conflict in that test.
2. **Over-wide binding, measured with the real LLM** (`ctx eval --extractor llm`, see [evaluation.md](evaluation.md)): 62% retrieval accuracy with conditions vs 100% on labels; binding exact 41%. 15 of 24 items get an element class, 14 of them on top of the single unit the chat was about, and 7 of those classes have no type (`class:any:ru-200`). Example: the RAD-176 frost tip reaches RAD-198 and RAD-221. `worktree-loop-v2` covers part of it (`scope.qualifier` for vague words like "old", confidence x0.8, a critic), but the class is still bound. Remaining options: the linker refuses a class with no type (~30 min, measurable offline with `--extractor cache`); the prompt defaults to the cited unit unless the speaker generalises explicitly (~30 min, needs an LLM rerun).
3. **Reconcile before merging `accuracy` and `worktree-loop-v2`**, which overlap:
   - Field outcomes: `accuracy` judges from the agent's observations (`mvp/feedback.py`: track record, "contested", trust untouched). `loop-v2` judges from the technician's reply (`outcome.py`: LLM or keywords; trust becomes "verified", or confidence x0.7). The two inputs complement each other, but pick one way to store and show the result (`ContextAssertion.outcomes` vs `RuleApplication`), and decide whether a field result may change trust or confidence.
   - Eval: `docs/evaluation.md` exists on both branches with different content; the code is in `src/context_layer/eval/` vs `src/context_layer/evaluation.py`. Both stopped matching on the topic slug: `accuracy` matches on type and scope, then cited messages; `loop-v2` on type, scope and action.
4. **Rerun `ctx eval --extractor llm`** (a human, with the `.env` key): the 3 new scenarios (car chat, home router, vendor tip report-back) are not in the LLM cache yet.

## Open questions for the Elisa mentors

Joni or Matti, at the Elisa stand or on Discord.

- [ ] Real conversations at Elisa: Finnish, English or both?
- [ ] What do element IDs and attributes look like beyond TRN-042 (types, models, install year), so synthetic records look right?
- [ ] Is there a preferred interface for the agent (MCP, REST, Spanner Graph), or is ours free?
- [ ] Which date should the TRN-042 chat carry (`valid_from`), or do we pick one?

Answered: judging (usability first), material (`data/elisa/`), compute and GDPR (not constraints).
