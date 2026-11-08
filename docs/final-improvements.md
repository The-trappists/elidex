# Final improvements backlog

> **Status: proposal.** Nothing here is decided until it is logged in [decisions.md](decisions.md). Written on 2026-11-07 from a review of the whole repo (branch `accuracy`, commit `f3663c6`, plus `origin/worktree-loop-v2`), the [brief](elisa/challenge-brief.pdf) and [Elisa's slides](elisa/sinceai-2026-challenge-pitch-elisa.html).

## How to use this file

- **When:** towards the end, **after the tasks in progress are finished and merged** (`accuracy`, `worktree-loop-v2` and the rest). It is a final push, not a replacement for current work.
- **How:** it can be handed to an AI assistant in **ultra mode** as one batch. Before changing anything, the assistant re-checks each item's evidence against the code of that moment: some items may already be fixed, and line numbers will have moved.
- Each item gives the evidence, the fix, the effort and a "done when" check. The team picks the items; log the choices in [decisions.md](decisions.md).
- **Scope:** every item passes the [scope checklist](challenge.md#scope-checklist). None detects faults: reading `traffic_counters` because a human rule says to check them is step 3 of the brief's own strong demo.

## Summary

The repo already covers every explicit requirement: capture from chat and email with no extra work, assertions bound to entities with source and validity, and reuse by an agent on a similar case. Three things can still cost the win:

1. **With the real LLM extractor, linking and lifecycle are weak.** Accuracy is 55–62% and only 41% of bindings are exact. A judge trying a similar case live can hit a wrong link or stale advice.
2. **The best features don't reach an external agent**, and the headline numbers come from hand-written labels.
3. **The demo is spread** across 3 UIs and 2 overlapping branches.

More advanced retrieval only helps where it fixes a measured failure and is shown against a baseline (part 2).

## Part 1: hidden expectations and gaps, ranked

### 1. Correct linking with the real LLM

> **Partly done** (see [backend-review.md](backend-review.md#applied-so-far-2026-11-07)): a class with no type and no model is refused, a model alone gets its type, and a class that leaves out the cited unit is dropped. The vague-word rule (bind the instance only) is still open.

- **Why the judges care:** "correctness of linking" is a secondary criterion, and Elisa's slides say "a wrong link is worse than none".
- **Evidence** (`out/eval/report-llm.md`, `out/eval/extractions.json`):
  - Only 41% of bindings are exact.
  - Veikko's TRN-117 message became `class:any:installed-2018-2018`, so the SFP rule applies to every element installed in 2018, of any type.
  - The RAD-176 frost tip reaches RAD-198 and RAD-221.
  - 7 classes have no type (`class:any:ru-200`, `class:any:tx-3000`).
- **Fix:**
  - The linker refuses a class with no `type` (around the `is_specific()` check in [link.py](../src/context_layer/link.py#L106)).
  - A class narrowed only by a vague word ("old", "older units", "legacy") with no year range binds the instance only.
  - Proposals already listed in [plan.md](plan.md) (over-linking section, follow-up 2) cover the variants.
- **Effort:** ~1h.
- **Done when:** `uv run ctx eval --extractor cache` shows higher exact binding and fewer noise items, with no lost solution. `uv run pytest` passes.

### 2. Stale knowledge in live mode: lifecycle compares binding IDs

> **Done for invalidations** (see [backend-review.md](backend-review.md#applied-so-far-2026-11-07)): `ContextStore.reach` and a subset rule; `sfp-after-firmware-trn117` passes with `--extractor cache`. Conflict detection still compares bound ids (instances included).

- **Why the judges care:** this is hard point 3 (Time): "firmware fixes the bug; when does it stop being true?"
- **Evidence:** [lifecycle.py:27](../src/context_layer/mvp/lifecycle.py#L27) closes an older assertion only when the two `applies_to` ID sets intersect.
  - With the LLM, the firmware 4.2 invalidation is bound to `class:transmission_node:installed-upto-2019`, while the TRN-117 copy of the rule is bound to `class:any:installed-2018-2018`.
  - The two sets don't intersect, so that copy is never closed. The eval case `sfp-after-firmware-trn117` fails for this reason.
  - It works offline only because the labels are hand-written.
- **Fix:** compare the **elements each assertion reaches** (class members ∪ instances ∪ site elements; see `KnowledgeGraph.reach` in [graph/kg.py](../src/context_layer/graph/kg.py)), not the binding IDs. Apply the same idea to conflict detection.
- **Effort:** ~45 min.
- **Done when:** `sfp-after-firmware-trn117` passes with `--extractor cache`, there is a unit test with two different class IDs over the same elements, and the replacement given in the same message still stays open.

### 3. Firmware validity per element, not per date

> **Partly done** (branch `feat/scale-retrieval-eval`, see [evaluation.md part 3](evaluation.md#part-3-retrieval-accuracy-at-company-scale)): a release now closes a rule only when it ships a version newer than the one the rule names (`lifecycle.fix_predates`), which removed 41 wrong closures on the `large` dataset. Validity per element (a `firmware` check filled from the inventory) is still open.

- **Why the judges care:** Elisa's reference figure cross-references the layers at any time t. "Firmware 4.2 fixes it" is true for a node only once that node runs 4.2.
- **Evidence:** `data/dashboard/topology.json` already has `firmware` per element. Today the invalidation sets one global `valid_to` on the message date. That is wrong in both directions: units upgraded before the message, and units still not upgraded after it.
- **Fix:** a firmware invalidation becomes a check on the rule (`firmware < 4.2`) instead of closing it for everyone. Steps:
  - add `firmware` to `OBSERVABLE_FIELDS` in [models.py](../src/context_layer/models.py);
  - compare versions numerically ("4.10" > "4.2");
  - fill the observation from the inventory when the agent does not give it.
- **Effort:** ~2h. `worktree-loop-v2` puts "firmware-based expiry" first on its cut list; reconsider that, since this is the most memorable moment for an architect.
- **Done when:** the rule is offered for TRN-042 on old firmware and not for TRN-117 after its upgrade, at the same time t.

### 4. The agent interface carries the best features

- **Why the judges care:** "suitability for agentic network operations" is judged on what an agent actually gets.
- **Evidence:** MCP [`get_context`](../src/context_layer/mcp_server.py#L21) takes no `observations`, so an external agent never sees `check_status`, `to_read` or the contested flag (`track_record`).
- **Fix:** add an optional `observations` parameter and return `check_status`, `to_read` and `track_record` per item, as `POST /api/agent/run` already does. In the demo, call it from a real MCP client: Elisa builds agents on Google ADK / A2A (public sources, see [ideas.md](ideas.md)), so "plugs into your agents" is concrete.
- **Effort:** ~30 min.
- **Done when:** a test calls the MCP function with observations and gets the check status.

### 5. Honest numbers

- **Evidence:**
  - "100% with conditions" in [evaluation.md](evaluation.md) uses the labels as the extractor, so it is 100% by construction.
  - The real LLM gets 35% plain and 62% with conditions in `evaluation.md`, but 27% / 55% in `out/eval/report-llm.md`: the two runs disagree.
- **Fix:**
  - Put the LLM numbers on the slides, with labels shown as the upper bound.
  - Regenerate every number from one commit, in one run.
  - Ask Joni or Matti at the Elisa stand for 2–3 cases written by them, and answer the open questions in [plan.md](plan.md) at the same time. "Tested on cases written by Elisa" beats any self-labelled metric.
- **Effort:** low.

### 6. Finnish

- **Evidence:** field chats at a Finnish operator are likely in Finnish (still an open question in [plan.md](plan.md)). Only the Finglish adversarial scenario exists.
- **Fix:** add 1–2 Finnish scenarios with `expected` items. In the demo, one live Finnish message comes out as a correctly bound English assertion.
- **Effort:** ~30 min, plus an LLM rerun by a human with the key.

### 7. Hard point 5: "People"

- **Evidence:** Joni said "think about them". Nothing covers it yet.
- **Fix:**
  - Experts see what was learned from them and how often it helped ("your tip was used 4 times, worked 3"): recognition, not surveillance.
  - The car-chat and home-router traps prove that personal chats are dropped.
  - The system stores rules and short quotes, not transcripts.
  - The data already exists (`find_experts`, outcomes), so this is mostly a slide, maybe a small view.
  - It must **never** become a confirmation step (that would be extra work).
- **Effort:** a slide, ~1h for a view.

### 8. Teams and Outlook feasibility

- **Evidence:** Slack stands in for Teams; a judge will ask.
- **Fix:** one slide showing Microsoft Graph subscriptions on chat messages and mail feeding the same `listen` step ([listen.py](../src/context_layer/listen.py)). Don't build it.

### 9. Coherence of the submission

- **Evidence:**
  - `accuracy` and `worktree-loop-v2` overlap: two outcome models, two evals, and an expected conflict in a test (follow-up 3 in [plan.md](plan.md)).
  - There are three UIs: the dashboard, the Context Atlas static demo and Streamlit.
  - The [README](../README.md) still says "Status: choosing an idea", with an empty team and license section.
  - There is no pitch deck or backup video in the repo.
- **Fix:**
  - merge the branches;
  - pick one demo surface;
  - set a feature-freeze time;
  - rewrite the README as a solution overview with the numbers (judges open it first);
  - make the slides and record a backup video.
- **Effort:** ~2h.

### 10. Recurring problems: "fix it once" view

> **Done** on `feat/pattern-recognition`, extended to problems on several elements at the same time: see [patterns.md](patterns.md).

- **Why the judges care:** a judge confirmed this idea when the team pitched it (2026-11-07, reported by the team). Some problems keep coming back on the same unit, model or site because of something that could be fixed once: a lock that freezes every winter, an SFP model that keeps dying, a firmware bug. Showing the repeats lets the operator fix the cause once instead of applying the same workaround forever. It turns captured know-how into a business case.
- **Scope:** stays in scope only if it is built from **human knowledge already captured**, not from telemetry. It counts how often people raise the same problem and apply the same workaround, and it shows the cause and the permanent fix that *people* stated. It does not detect faults or find root causes: Elisa's AI already does that, and [challenge.md](challenge.md) lists it as out of scope. Call it "recurring workarounds", not "root-cause analysis".
- **Evidence:** nothing groups or counts repeats today. The building blocks exist:
  - each assertion has a `topic`, `applies_to` and `outcomes` ([models.py](../src/context_layer/models.py));
  - `track_record` in [mvp/feedback.py](../src/context_layer/mvp/feedback.py) already counts worked/failed per assertion;
  - `find_experts` in [mcp_server.py](../src/context_layer/mcp_server.py);
  - `RuleApplication` on `worktree-loop-v2`.
- **Fix:**
  - group assertions and their outcomes by topic and by the elements they reach (element, class, site; reuse the reach from item 2);
  - count over a time window: threads that raised it, times the workaround was applied, on which elements;
  - flag a group as "recurring: candidate for a permanent fix" above a threshold (for example 3 times in 30 days). Show the count, the elements, the cited messages, and the cause or permanent fix someone stated ("replace the brass lock", "upgrade to 4.2"), if anyone did;
  - add a dashboard endpoint and a "Recurring" view in the UI. An MCP tool `recurring_problems` is optional;
  - when a permanent fix is recorded (firmware 4.2, a new lock), lifecycle closes the workaround (items 2–3) and the entry shows "resolved".
- **Data:** add or extend seed scenarios where the same problem repeats over weeks (for example TRN-117 SFP three times, the Sodankylä lock freezing again).
- **Effort:** ~2–3h (grouping and endpoint ~1h, UI view ~1h, seed data ~30 min).
- **Done when:** after replaying the seed, the Recurring view lists at least one problem with its count, elements, cited messages and stated cause; a test covers the grouping; a problem with a recorded permanent fix shows as resolved.
- **Demo line:** "This workaround was applied 7 times on TX-3000 units in two months. Erkki says firmware 4.2 fixes it for good."

### Bugs from `failed-tests-log.md`, checked against the code

| Bug | Verdict |
| --- | --- |
| `same_knowledge` merges two people's different facts when both have no action (`"" == ""`, [store.py:36](../src/context_layer/store.py#L36)) | **Fixed**: when both actions are empty, `fact` is compared ([backend-review.md](backend-review.md#applied-so-far-2026-11-07)) |
| Same-timestamp invalidation ([lifecycle.py:31](../src/context_layer/mvp/lifecycle.py#L31)) | **Do not apply the suggested `>=` → `>` change.** The `>=` is deliberate: it keeps a replacement given in the same message open. The change would close the new key code |
| Guard negation ("Never reboot") | Low priority: a planned action is never a negation, and `avoid` is already matched as "things to avoid" |
| Layperson entities dropped, site substring matching | Low priority for the demo |

## Part 2: advanced retrieval, only where it pays

### Where the failures are

Current retrieval is already better than naive RAG on what matters here: graph scope (element → class → site), time validity and condition checks. With the real LLM, the failures are **wrong scope** (item 1) and **stale closures** (item 2), not ranking.

Constraints to keep in mind:
- The knowledge base holds about 23 assertions, so ranking is not the bottleneck.
- [decisions.md](decisions.md) (2026-11-07) explicitly rejected ranking; a reranker on the main path would reopen that decision.
- The 44% / 63–80% "naive vs SOTA RAG" figures that circulate have no source: keep them off the slides and use our own numbers.

### Recommended: three techniques, each tied to a measured failure and a stat

#### A. Corrective agentic retrieval (CRAG-style)

- **Reference:** Yan et al. 2024, *Corrective Retrieval Augmented Generation*, arXiv:2401.15884.
- **Why it fits:** our condition checks already play the role of CRAG's retrieval evaluator:
  - `fully checked` = correct;
  - `failed` = incorrect;
  - `not fully checked` = ambiguous.

  The corrective action becomes a tool call instead of a web search: the agent reads the `to_read` fields with a `read_observation(entity, field)` tool, re-checks, then acts. That is literally the brief's "check the traffic counters".
- **Build:**
  - in the eval, the tool reads the case's full observations (simulated telemetry);
  - in the dashboard, it reads the incident's observations;
  - add it to [agent.py](../src/context_layer/agent.py) `run_agent` behind a flag.
- **Stat:** rerun the missing-observation sweep in [evaluation.md](evaluation.md) §3 before and after. Today, with labels, accuracy is 100 / 91 / 80 / 67 / 43% with 0 / 1 / 2 / 3 / 5 observations missing. Report the same table after the loop, plus the average number of tool calls per case, for both `--extractor cache` and labels.
- **Effort:** 2–3h.

#### B. Hybrid neighbour retrieval for reconciliation

> **Partly done** (branch `feat/scale-retrieval-eval`): same knowledge is now compared on scope, not on where it was seen, so Veikko applying Erkki's tip on TRN-117 is a confirmation of Erkki's rule, and 285 of 285 confirmed hunches on `large` stay one rule (was 72). BM25 / dense neighbours for the judge are still open.

- **Technique:** candidate neighbours of a new assertion = element-level reach overlap (item 2) ∪ BM25 ∪ multilingual dense search, fused with Reciprocal Rank Fusion (Cormack et al. 2009). The loop-v2 judge then decides supports / contradicts / supersedes / unrelated.
- **Why it fits:** it fixes the live failures that IDs and topic slugs miss:
  - the firmware closure;
  - Veikko applying Erkki's tip, which becomes a separate rule instead of "verified" evidence for Erkki's;
  - Finnish and layperson paraphrase.

  BM25 keeps exact codes (TX-3000, SFP, TRN-042) that dense search blurs.
- **Build:**
  - BM25 with `rank-bm25`;
  - dense search with a multilingual model (multilingual-e5 or bge-m3 locally), or the embedding endpoint of the LLM provider (a human checks the key; AI agents must not touch `.env`);
  - the judge lives on `worktree-loop-v2`, so do this after the merge.
- **Stat:** lifecycle detection rate with the real LLM (expected closures, conflicts and hunch → verified upgrades actually found), plus the number of stale answers in retrieval.
- **Effort:** 3–4h.

#### C. A naive-RAG baseline plus an ablation table (the demo slide)

> **Done at company scale** with the oracle extractor: `ctx dataset eval out/dataset/large`, 9,300 cases, five pipelines, stale and wrong-scope answers counted; it also led to a new problem-relevance step. Table and limits in [evaluation.md part 3](evaluation.md#part-3-retrieval-accuracy-at-company-scale). The real-LLM rows of the slide below still need a human run with the key.

- **Why:** this is what most teams will build. Showing why it fails on Elisa's problem (no time, no scope, no trust) makes our numbers meaningful.
- **Build:**
  - chunk the raw messages of the 26 labelled scenarios, each with a contextual prefix (thread subject, participants, date), as in Anthropic's *Contextual Retrieval* (2024). It reported 49% fewer retrieval failures with contextual embeddings + BM25, which makes it a strong baseline, not a straw man;
  - take the top-k messages and map them to labels through the scenarios' `cited_seq`;
  - score with the same cases and code ([eval/retrieval.py](../src/context_layer/eval/retrieval.py)).
- **New metrics:**
  - **stale answers:** knowledge already closed at the case time came back, e.g. the old barrier key, or the SFP rule after firmware 4.2;
  - **wrong-scope answers:** knowledge reached an element it does not apply to.
- **Slide** (real LLM; the two filled cells are the run in [evaluation.md](evaluation.md); fill the rest from one run, see item 5):

| Pipeline | Accuracy | Stale answers | Wrong-scope answers | Noise items |
| --- | --- | --- | --- | --- |
| Naive RAG over chats (contextual + BM25) | ? | ? | ? | ? |
| Graph scope + time | 35% | | | |
| + condition checks | 62% | | | |
| + linking fix (item 1) | ? | | | |
| + reach-based reconcile (item 2) | ? | | | |
| + corrective read loop (A) | ? | | | |

- **Effort:** 2–3h.

### Optional

| Technique | Value | Risk / note |
| --- | --- | --- |
| Bi-temporal model (Zep / Graphiti: Rasmussen et al. 2025, arXiv:2501.13956): add `recorded_at` next to `valid_from` / `valid_to` | Answers "what did the agent know at 03:00 when it acted?": an audit for autonomous decisions; mirrors the "record time" in Elisa's figure | ~1h; strong in Q&A, little to show on screen |
| Symptom-similarity fallback: when the graph returns nothing, semantic search over assertions, shown as "seen on other units, scope not confirmed" | Recovers knowledge after narrow linking (item 1) | Can break the 7 "correct silence" traps; ship only if the metric holds |
| Neo4j hybrid query: Neo4j 5 has vector indexes, so graph + vector + time could be one Cypher query | Elisa names Neo4j | Keep NetworkX at runtime; show the query on a slide or in [knowledge-graph.md](knowledge-graph.md), don't move the runtime at the end |

### Skip

| Technique | Why not |
| --- | --- |
| Cross-encoder reranking | No ranking problem at ~23 assertions; conflicts with the logged "no ranking" decision |
| Microsoft GraphRAG (community summaries) | Built for broad "what are the themes" questions over large corpora, not entity-anchored lookups; our graph traversal is already local GraphRAG |
| HyDE on the main path | The graph lookup is already exact; only useful inside the optional fallback |
| Self-RAG proper | Needs fine-tuning; we already validate citations (`cited_assertion_ids`) |

## Suggested order

1. Items 1 and 2 (linking fix and reach-based reconcile), then rerun `ctx eval --extractor llm` (a human, with the key).
2. Technique A (corrective read loop) and item 4 (`observations` on MCP).
   - Item 10 (recurring problems, confirmed by a judge) right after, since it reuses the reach from item 2.
3. Technique C (baseline and ablation slide).
4. Item 3 (firmware per element), if time allows.
5. Technique B (hybrid reconcile), once `worktree-loop-v2` is merged.
6. Item 9: freeze, README, slides, backup video. Items 5–8 go into the slides.

## Demo arc this enables

1. **Capture:** Erkki's chat goes in; the assertion appears, and nobody typed anything.
2. **3 a.m.:** an external agent works on TRN-117 through MCP. Erkki's rule comes back "not fully checked, read `traffic_counters`". The agent reads the counters (0), the rule is now fully checked, and it answers "bounce the interface, don't reboot", citing Erkki's messages.
3. **No overlinking:** the same symptoms on TRN-305 (a 2024 unit) get silence.
4. **Time across layers:** firmware 4.2 reaches TRN-117 only. The rule stops for TRN-117 and still applies to TRN-042.
5. **The numbers:** the ablation table, naive RAG vs ours.
