# Loop v2 plan: targeted agents + operator console

> **Status: proposal, validated by the team lead on 2026-11-07** (plan approved; log the decisions below in [decisions.md](decisions.md) once the work lands). Branch: `worktree-loop-v2`.

## Ground rules (from the team)

1. **Fully automated.** No human review step is ever part of the loop. Knowledge goes live without anyone confirming it. Nothing here may ask a specialist (or anyone) for a click.
2. **The GUI is a manipulation and debug surface, not a gate.** It must be easy for a human to see what the loop did, understand why, and correct or override it when they choose to. UI/UX quality is a first-class goal, not polish.
3. **Deterministic where trust matters.** Linking stays deterministic ("a wrong link is worse than none"). LLM agents sit where the text is ambiguous.
4. **Every new behaviour sits behind a `Settings` toggle** (like `lifecycle`), so a demo can switch it off.
5. Scope: every item is checked against the scope checklist in [challenge.md](challenge.md). No fault detection, no Elisa workflows, no forms.

## Workstreams

| Lot | What | Owns | Depends on |
| --- | --- | --- | --- |
| **L0 Contract** | `Scope.qualifier`, `ExtractedItem.evidence_quote`, `ReviewFlag`, toggles `use_critic` / `use_judge` / `use_outcome_loop`, source kind `operator`, hook points in `processor._run`, endpoint stubs, TS mirror | `models.py`, `workbench/contracts.py`, `workbench/processor.py` (structure), `web/src/api/types.ts` | none |
| **L1 Critic + qualifier** | A second model checks each extracted item against its cited messages (verbatim quote, no over-generalised scope, "old" qualifier). Rejects or lowers confidence. The linker turns the qualifier into a note and a lower confidence | `critic.py`, `link.py`, `tests/test_critic.py`, one scenario | L0 |
| **L2 Reconcile judge** | For a new assertion, fetch neighbours (same `about`), verdict supports / contradicts / supersedes / unrelated. Applies closing, conflict, hunch → verified, topic canonicalisation. Old lifecycle path stays as fallback | `judge.py`, `mvp/lifecycle.py`, `tests/test_judge.py` | L0 |
| **L3 Passive outcome loop** | The agent's applied action is posted in the thread; the technician's next message is linked to the rule and the judge upgrades trust. No click | `outcome.py`, hooks in `routes.py`, one scenario | L0, L2 |
| **L4 Console backend** | Review flags (abstentions, low confidence, conflicts, over-reach, critic disagreement), edit an item then re-run link + store, replay a step with another model, operator override recorded as source `operator` | `workbench/routes.py`, `state.py`, tests | L0 |
| **L5 Console UI** | "Needs a look" inbox, inline item editing in the pipeline view, re-run, override history. Built against fixtures until L4 lands | `web/src/pages/ReviewPage.tsx`, `web/src/components/pipeline/**`, `web/src/api/client.ts` | L0 |
| **L6 Eval + models** | Eval compares on (type, scope, action) instead of topic slug; script runs the scenarios with 2-3 models and reports matched / missed / unexpected / latency | `scripts/eval_models.py`, `evaluate()` | L0 |
| **L7 Demo + docs** | Demo script, docs updates, decisions, data README | `docs/**` | all |
| **L8 Integration + QA** | Merge order, all scenarios, every toggle both ways | review only | L1-L6 |

Merge order: L0, then L1, L2, L4, L5, L6, then L3.

## UI/UX requirements for L5 (and any web change)

- Follow the existing calm design (tokens in `web/src/index.css`, components in `web/src/components/ui`, English UI, empty states, confirmation modals, no `window.confirm`).
- One job per screen. The inbox answers "what should I look at?" in one glance: grouped by reason, newest first, a plain-language reason per flag, a one-click jump to the thread, the step and the LLM call.
- Every automatic decision (rejected item, closed rule, merged knowledge, trust upgrade) shows **why**, with the source messages quoted.
- Editing is direct and reversible: edit in place, preview what will change (assertions added, closed, reach), apply, undo via history. Nothing blocks the automatic flow.
- Keyboard friendly, readable at a glance, usable on a laptop in a live demo.

## Models (proposal, by role)

| Role | Profile | Candidates to compare with L6 |
| --- | --- | --- |
| Triage (optional) | small and fast | provider-available flash / small model |
| Extraction | mid-size, strict JSON | current primary (Gemini via AI Studio) |
| Critic and judge | **different model** from the extractor, stronger reasoning | a second provider or tier, so errors are not correlated |
| Demo agent | same as extraction, tool calling | current primary |

Provider choice follows free access (see the decision of 2026-11-06). Models are chosen from L6 numbers, not guessed.

## Definition of done per lot

- Tests pass with a **mocked LLM**; existing tests still pass.
- The lot's toggle works both ways; `scripted` mode still works.
- A scenario with `expected` exists for the new behaviour.
- For UI: web build and type check pass.
- A 3-line note for L7: what changed, what is weak, what to say in the demo.

## Cut line

Drop in this order if time runs short: firmware-based expiry and stage breakpoints, then L3, then "replay with another model". Keep L1 and the core of L5.

## Decisions to log

- D1: current pipeline + three targeted agents (critic, judge, outcome loop); no full multi-agent orchestrator.
- D2: linking stays deterministic.
- D3: operator console is optional and never part of a specialist's path; the loop is fully automated.
- D4: models by role, chosen from L6 results.
