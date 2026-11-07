# Demo script: loop v2 (2 min 30)

> **Status: proposal, to rehearse.** Every scenario id and endpoint below exists in the repo (checked on branch `worktree-loop-v2`). What the live model will answer has **not** been tested: the critic and the judge have never run against a real model (see [plan-loop-v2.md](plan-loop-v2.md#known-weaknesses)). Rehearse twice and write down the real numbers in the last step.

The message of the demo: the loop is automated. Nobody types, confirms or rates anything. The console only shows what the loop did and lets a human correct it if they want to.

## Before the demo (not counted in the 2m30)

1. Start the Workbench: `uv run ctx workbench` (UI on `http://127.0.0.1:8010`). Check **Settings**: `extractor_mode` is `auto` (or `llm`), and `use_critic`, `use_judge` and `use_outcome_loop` are **on** (they default to on; the critic and judge stay silent without an LLM key).
2. Smoke-test the providers by hand (a human runs it; agents never use the `.env` keys). `uv run ctx llm-check` covers the primary and fallback providers only, **not the critic role**: test the critic provider (`LLM_CRITIC_*`, see [tech-stack.md](tech-stack.md#model-roles-and-free-access)) with one real call, for example a single `scripts/eval_models.py --run` candidate pointing at it. Without `LLM_CRITIC_*` the critic and judge silently use the primary chain.
3. Set the clock to real time: `POST /api/sim/speed` with `{"speed": 1}`, and make sure it runs (`POST /api/sim/start`). The outcome step needs a window of about 2 minutes between the second and the third message of `agent-outcome-followup`; at the default faster speed that window is only a few seconds. This timing is not tested: rehearse it.
4. Reset to the seed: `POST /api/data/reset` with `{"mode": "seed"}` (or Data page). The seed already processes Elisa's historical chat and email, so the knowledge base is not empty. If you prefer to watch the rule appear from nothing, use `{"mode": "empty"}` instead: it keeps the inventory, personas and scenarios.
5. Open the tabs: Conversations, Knowledge, Needs a look.

## The run (150 s)

| Time | Step | What you do | What you say (Elisa's hard point) |
| --- | --- | --- | --- |
| 0:00 | **1. Capture** | Run `elisa-trn042-chat` (Data page, scenarios tab, or `POST /api/sim/scenarios/elisa-trn042-chat/run`). Open the thread in Conversations, follow it through the pipeline steps. | **Point 1, the real knowledge.** "Twelve messages, one sentence of rule. Nobody wrote documentation; the agent only read the Teams chat." |
| 0:25 | **2. The rule, with its source** | Knowledge page, open the rule bound to TRN-042 and the class of older transmission units. Show the source messages, the class (model, install years), the validity (`valid_from`, `valid_to` empty) and the trust level. | **Points 2 and 4.** "Linking is deterministic: TRN-042 is evidence, the class is the scope. A wrong link is worse than none. Trust is shown on screen (the chat contains 'traffic is back', so read it from the page, do not assume), and every claim points to who said it and where." |
| 0:45 | **3. Time: the judge closes a rule** | Run `firmware-4-2-rollout`. When its job ends, show the old rule now has `valid_to` set and `closed_by` pointing to the new assertion, and the judge's reason (Conversations, the job's verdicts, or a "Closed an older rule" flag in Needs a look). | **Point 3, time.** "An architect said in passing that firmware 4.2 fixes the bug. Nobody clicked 'expire'. The judge compared the new message with the old rule and closed it, and kept the history." |
| 1:05 | **4. Outcome: the agent learns without a click** | Run `agent-outcome-followup`. About 60 s later (after the NOC's first message, before the technician's "Traffic is back") call `POST /api/agent/run` with `{"entity_id": "TRN-117", "observations": {"sfp_replaced": true, "interface_status": "UP", "optical_levels": "normal", "traffic_counters": 0, "alarms": "cleared"}, "description": "No traffic after SFP swap"}`. Show the ops agent message in the thread, then the technician's reply arriving, then the outcome recorded on the rule: a flag "Confirmed in the field", the technician's reply added as a source, and trust set to `verified` with his words as evidence (if the rule was already `verified`, say that the loop adds the field evidence rather than a new level). | **Point 4, trust.** "The agent applied the rule on TRN-117 and said so in the thread, like a colleague. It asked for nothing. The technician wrote 'traffic is back' for his own reasons, and that reply became evidence on the rule. No survey, no thumbs up." |
| 1:35 | **5. No overlinking** | Run `new-unit-trn305`. Show that the knowledge is bound to TRN-305 only and the old class rule does not apply to it (Knowledge page, or `GET /api/context/TRN-305`). | **Point 2 again.** "Same symptoms on a newer TX-5000, different cause. The rule for old units does not reach it. Abstaining beats guessing." |
| 1:50 | **6. The console, optional** | Open **Needs a look**. Pick a flag from a scenario with a disagreement or a vague word (suggestions: `expert-disagreement`, `qualifier-old-tx3000-site`; run it before the demo and check the flag exists). Read the plain-language reason with the quoted message. Open the item in the thread's pipeline view, edit it, press "Re-run from link". Then open the assertion's history in the Knowledge drawer and press Undo. | "This page is not a queue: nothing waits here, the knowledge is already live. It is where a human can see why the loop did something, and fix it if they disagree. An edit is recorded as source `operator` and can be undone." |
| 2:15 | **7. Numbers** | Show the evaluation: in the pipeline view of a job with expected items (the eval block), and the table from `uv run python scripts/eval_models.py --scripted` (offline), or the latest `out/eval/*.md` if a human ran the paid mode. | "We measure the extractor on 21 scenarios with expected items, matching on type, scope and action, not on the name of the topic. The scripted line proves the metric; the real model line is what the critic is for." Read the numbers from the screen; do not quote numbers you have not seen. |
| 2:25 | **People** | Back to the pitch. | See below. |

### The one sentence on people (point 5)

"Nothing is asked of the specialists: no form, no tag, no extra message. The agent only reads channels they already use, and every piece of knowledge shows who said it and where, so it reads like a colleague's note, not a log of what they did."

(The brief asks for one line on how specialists feel about being "captured"; this is our framing. We have no data on how they actually feel, and GDPR is out of scope per the brief.)

## If something fails

| Failure | Fallback |
| --- | --- |
| Live LLM is slow or returns 429 | The fallback providers take over automatically (primary fallback, critic fallback). If both fail, set `extractor_mode` to `scripted` in Settings: the scenarios' `expected` items are used instead of the model. The judge and the critic are skipped or noted, and `lifecycle.reconcile` still closes the rule in step 3. The outcome loop falls back to a keyword heuristic. Say so: "this is the offline mode". |
| The critic is not visible in scripted mode | Expected: the critic only runs when the extractor is an LLM. Show it from a recorded run. |
| The outcome step misses its timing window | Run the follow-up thread first, then call `POST /api/agent/run` and reprocess the thread (`POST /api/threads/{id}/process`). If it still does not show, use the recorded video for this step. |
| The whole Workbench fails | The recorded backup video of this exact script (to be recorded after the second rehearsal; not made yet). |

## Rehearsal checklist

- [ ] Both toggles and the outcome loop are on, and the second provider answers.
- [ ] After the seed reset, `elisa-trn042-chat` shows the rule with a source, a class and an empty `valid_to`.
- [ ] After `firmware-4-2-rollout`, that rule is closed.
- [ ] The agent message and the technician's reply land in the same thread, and the application outcome becomes `worked` (check `GET /api/applications?outcome=worked`).
- [ ] The flag chosen for step 6 exists, and Undo restores the previous value.
- [ ] The numbers of step 7 are written on a card, taken from a real run.
- [ ] Video recorded.
