# Backend review (2026-11-07, `main` at `9b051be`)

> **Status: proposal.** Nothing here is decided until it is logged in [decisions.md](decisions.md). Written from a full read of `src/context_layer/` (core, workbench, eval, patterns, graph, dataset), the docs, a run of the tests and the offline evaluations, and offline probes on the real code. Every "confirmed" item below is reproduced by [`scripts/review_probes.py`](../scripts/review_probes.py), which prints `PRESENT` or `fixed` per item.

## Summary

The pipeline covers every "must" line of the [scope checklist](challenge.md#scope-checklist), the tests pass (247), and the offline numbers are good (100% retrieval accuracy with conditions, labels as extractor). The gaps are where the **real LLM** feeds the deterministic stages, which is what a judge trying a live case will hit:

1. **Linking still over-reaches with LLM output** (backlog item 1 is not fixed). The linker trusts the extracted class, ids and author without checking them against the thread or the inventory: a class that excludes the cited unit, a year-only class that reaches a router, ids the thread never names (probes L1–L4).
2. **Time and trust rely on ids and slugs.** An invalidation closes a rule only when the two class ids are equal (R1, backlog item 2 not fixed). A technician's "it worked" overwrites who stated the rule, which hides later disagreements (O2), and the agent marks *every* retrieved rule as applied, so one "fixed" reply verifies noise too.
3. **Three copies of the pipeline.** The CLI (`pipeline.py`), the eval (`eval/kb.py`) and the workbench (`workbench/processor.py`) each run extract → link → store → reconcile. The critic, judge and outcome loop exist only in the workbench, so **no number measures them**, and the store that MCP and REST serve never gets them.
4. **The external agent interface is behind the UI.** MCP reads the CLI store file (not the live workbench), reloads it on every call, and still takes no `observations` (backlog item 4 not fixed).
5. **Atlas and Tiger hold data but no decision uses it.** Vector search and freshness are only reachable from stand-alone endpoints and CLI commands.

Recommended order at the end. The first three steps are deterministic, testable offline, and need no new tool.

## What was checked

| Check | Result |
| --- | --- |
| `uv run pytest` | 247 passed (8 s) |
| Offline accuracy (labels as extractor) | Plain 73%, with conditions 100%; "fully checked" precision 100%; field feedback 6/6, 0 false alarms. Same as [evaluation.md](evaluation.md) |
| Real-LLM accuracy | Not rerun (no key for agents, no recorded `out/eval/extractions.json` in this checkout). The docs give 35% / 62% in one place and 27% / 55% in another: still two runs that disagree (backlog item 5) |
| Scale bench, `ctx dataset bench` on the `demo` dataset (300 facts, ~4k elements) | Link p95 0.5 ms, add_assertion p95 0.5 ms, get_context p95 0.4 ms, 0 over-bound. The core is fast enough; ground truth is the input, so this says nothing about LLM linking |
| Knowledge-graph rebuild | 1.5 ms on the seed, 10 ms with 10× the threads (linear in messages × element patterns) |
| Backlog in [final-improvements.md](final-improvements.md) | Item 10 (patterns) done. Items 1, 2, 3, 4 and techniques A, B, C not started. The `same_knowledge` facts bug marked "Real. Fix" is still there (S1) |

## What is good (keep it)

- **Deterministic linker that abstains**, sites demoted to `observed_on` when something narrower carries the scope, and the `observed_on` rule enforced the same way in `get_context` and the graph.
- **Check status instead of ranking** (`fully checked`, `not fully checked` + `to_read`, `text only`): measured, honest, and it gives the agent something to do instead of a weight.
- **One outcome ledger** with dedupe by application id, and "never drop a rule on feedback".
- **Agents as hooks that can never block a job**, each behind a `Settings` toggle, with every LLM call traced.
- **Patterns guards** (contradicting symptom checks, workaround vs cure, place before meaning) and the calibrated embedding threshold.

## Findings and proposals

Effort is our estimate for one person. "Probe" refers to `scripts/review_probes.py`.

### 1. Linking: check what the extractor claims (confirmed: L1, L2, L3, L4)

**Evidence.** `link.Linker.link` binds the class, instance ids, sites and `stated_by` exactly as extracted:

| Probe | Input | What happens |
| --- | --- | --- |
| L1 | Thread about TRN-117 (2018); LLM class "transmission nodes from 2020" | Class bound: the rule reaches TRN-154, TRN-176, TRN-208, none of which was discussed, and not the unit it was about |
| L2 | Class "installed 2018" with no type or model | `class:any:installed-2018-2018` bound: a transmission-node SFP rule reaches router RTR-010 |
| L3 | Thread names TRN-117; LLM returns TRN-042, TRN-131 | Both bound: any valid id the model invents is accepted |
| L4 | `stated_by` = a name not in the thread | Kept, with no role: trust is attributed to someone who never spoke |

Also code-evident: `ClassCriteria.matches` compares `type` exactly, so "transmission node" or "Transmission_Node" from the model silently matches nothing; a class with a model but no type gets the id `class:any:tx-3000`, so two items about the same TX-3000s get different class ids, and every id-based comparison downstream (merge, lifecycle) misses them.

**Proposal (deterministic, in `link.py`; no LLM):**

| Guard | Rule | Effect |
| --- | --- | --- |
| Class contains the cited units | Every resolved instance in the item must be a member of the class; otherwise drop the class and keep the instances | Fixes L1 |
| Class needs a type or model | Refuse a class with neither. When only the model is given, fill the type from the inventory (one model maps to one type) | Fixes L2, canonical class ids |
| Normalise the type | snake_case, then check it exists in the inventory; unknown type = note and drop the class | No silent "matches no element" |
| Ids must be in the text | An instance or site id must appear in the thread (id or alias, the same matcher as `graph/kg.py` `_mention_pattern`); otherwise note "not named in the thread" and drop it | Fixes L3 |
| Author must be a speaker | `stated_by` must match a thread author (exact, then first name); otherwise use the author of the message holding `evidence_quote`; otherwise abstain | Fixes L4 |

Option for vague words (already in [plan.md](plan.md), still open): with a qualifier and one named unit, **(a)** bind the unit only (precise, but the advice no longer reaches the other old units) or **(b)** keep the class with the x0.8 note (current). Recommendation: (a) when the class has no year range, (b) when it has one.

**Effort:** ~1.5 h with tests. **Done when:** probes L1–L4 print `fixed`, `pytest` passes, and `ctx eval --extractor cache` (after a human LLM run) shows higher "binding exact" with no lost solution.

### 2. Time: compare what rules reach, not their ids (confirmed: R1)

**Evidence.** `mvp/lifecycle.reconcile` closes an older rule only when `old.applies_to & new.applies_to` share an id, and only on the same topic slug. A rule on `class:…:tx-3000:installed-upto-2018` is not closed by an invalidation on `class:transmission_node:installed-upto-2019`, although the second covers every element of the first. Conflict detection has the same topic-slug dependency. The judge fixes part of this, but only in the workbench.

The codebase computes "which elements does a rule reach" in **four** places (`store.get_context` scope walk, `graph/kg.KnowledgeGraph.reach`, `mvp/patterns._Net.reach`, `workbench/review._over_reach`), and the one place that needs it most, lifecycle, uses none.

**Proposal:** one `ContextStore.reach(assertion) -> set[str]` (members of bound classes ∪ bound elements ∪ elements of bound sites), memoised and cleared on `add_class` / inventory change. Use it in lifecycle, judge candidates, patterns and review.

| Lifecycle rule options | Trade-off |
| --- | --- |
| Close when `reach(old) ⊆ reach(invalidation)` | Safe: never closes a rule for elements the invalidation does not cover. Partial overlaps stay open (flag them) |
| Close when the reaches intersect | Catches more, but closes the rule for elements nobody said anything about |
| Per-element validity (item 3 below) | The correct model, more work |

Recommendation: subset rule now, item 3 if time allows. Also drop the topic equality for invalidations: candidates are rules whose reach overlaps, the type is `workaround`/`access`, and the trigger (if any) is the same.

**Effort:** ~1 h. **Done when:** R1 prints `fixed`, `sfp-after-firmware-trn117` passes with `--extractor cache`, and the same-message replacement still stays open (existing test).

### 3. Firmware validity per element (backlog item 3, not started)

Unchanged from [final-improvements.md](final-improvements.md#3-firmware-validity-per-element-not-per-date): add `firmware` to `OBSERVABLE_FIELDS` with numeric version comparison, fill it from the inventory when the agent does not give it, and turn "fixed in 4.2" into a check `firmware < 4.2` instead of a global `valid_to`. The patterns module already parses versions (`stated_version`, `_version`): reuse them. ~2 h.

### 4. Trust: keep who said it apart from who confirmed it (confirmed: O2, plus one code-evident bug)

**Evidence.**
- `outcome.settle` (worked, from a human) replaces `trust` with `Trust(stated_by=<technician>)`. The judge's `supports` and the store merge also replace `trust` wholesale when the level goes up. After Veikko confirms Erkki's rule, the rule "belongs" to Veikko: if Veikko later proposes something else, `reconcile` sees the same author and **flags no conflict** (probe O2), and `find_experts` credits the wrong person.
- `POST /agent/run` posts a `RuleApplication` for **every** hit (`report.hits`), not only the rules the recommendation cites. With conditions on, hits include `not fully checked` noise; one "traffic is back" then verifies all of them.
- The store keeps one `stated_by`: when two people state the same fact, the second is lost (seen on the demo dataset: `counter-wrap-32bit`, Vilma and Timo).

**Proposal:**
- `Trust` keeps the original `stated_by`. Add `confirmed_by: list[str]` (or a `confirmations` list with author, quote, source) that the outcome loop, the judge and the store merge append to. `level` can still become `verified`.
- `/agent/run` posts applications only for `cited_assertion_ids` (LLM mode) or the rule the template picked (template mode).

**Effort:** ~1 h, contract change in `models.Trust` (optional field, backward compatible). **Done when:** O2 prints `fixed`, and a test shows a noise hit is not verified by a reply.

### 5. Store merge of facts (confirmed: S1)

`store.same_knowledge` treats two empty actions as "the same advice", so two different facts on the same topic and scope from two people merge, and the disagreement disappears. Already marked "Real. Fix" in the backlog. Fix: when both actions are empty, compare `fact` (normalised); different facts from different people are not merged and `reconcile` flags them. ~10 min.

### 6. Outcome heuristic (confirmed: O1)

Without an LLM, `outcome.heuristic` reads "Link is UP but still no traffic" and "I'll get back to you" as **worked** (`\bback\b`, `\bis up\b`). In the Erkki story, "link UP, no traffic" is the symptom itself. Fix: check failure phrases first with "no traffic", "still 0", "same", "nope"; drop `back` unless "is back" / "came back"; drop `is up`. When both or neither match: unclear (no verdict, as the rest of the loop does). ~20 min.

### 7. Extraction robustness and prompt input

**Evidence.**
- `llm.complete_traced` returns the first answer without a transport error, even when `validate` failed; `LLMExtractor.extract` then raises, and the workbench falls back to "scripted" (nothing, for a live thread). No repair attempt, no fallback provider on a parse error (probe U1). The model comparison saw invalid outputs from Mistral Medium.
- `max_retries=0` and no backoff: a single 429 on the free Gemini tier goes straight to the fallback, or fails the job without one. A new `OpenAI` client (new TLS connection) is created for every call.
- The extractor gets **every** topic slug in the store, with no meaning attached. It grows with the store, and a bare slug cannot tell the model whether it is the same knowledge.

**Proposal:**
- In `complete_traced`: on a parse failure, retry the same provider once with the validation error appended ("your JSON failed: …, answer again"), then move to the next provider. One 429 retry honouring `Retry-After` before falling back. Cache one client per (base_url, key).
- Known topics: pass only the assertions whose reach overlaps the elements and sites named in the thread (same matcher as finding 1), each as `topic: one-line summary (stated_by)`, capped at ~20. Better reuse, shorter prompt, and it keeps working on a big store.
- Use `json_schema` mode where `ctx llm-check` shows it passes (Mistral did).

**Effort:** ~1.5 h. **Done when:** U1 prints `fixed`, and an LLM run (by a human) shows fewer "unexpected" items with the scoped topic list.

### 8. One pipeline core

**Evidence.** `pipeline.build_store`, `eval/kb.build_kb` and `workbench/processor.Processor._run` each re-implement extract → link → store → reconcile. Hooks (critic, judge, outcome) only run in the workbench. Consequences: the eval cannot measure the critic or the judge ([model-improvements.md](model-improvements.md) items 2 and 5 depend on it), and `ctx run` (the store MCP and REST serve) has no judge.

**Options:**

| Option | Effort | Trade-off |
| --- | --- | --- |
| Extract one `process_thread(store, thread, extractor, settings, hooks)` used by all three | ~2 h | One behaviour everywhere; touches three callers, so do it after the current branches merge |
| Keep three loops, add the hooks to the eval only | ~45 min | Measures the critic and judge quickly; the duplication stays |

Recommendation: the second option now (so the critic and judge get numbers before the pitch), the first one after the feature freeze if there is time.

### 9. Workbench throughput and hot paths

**Evidence.**
- `Processor.process` holds one global `asyncio.Lock` for the whole job, **including** the LLM calls: extraction (~5 s measured by `ctx llm-check`), the critic (one call), the judge (one call per new assertion, sequential) and the outcome loop. With critic and judge on, a job takes about 15–20 s of LLM time and every other thread waits. A live Slack demo with two active threads queues visibly.
- After every job, `review.collect_flags` rebuilds the whole knowledge graph (regex mentions over all messages) on the event loop thread. Every `/api/graph*` request rebuilds it again. Cheap on the seed (10 ms at 10× the threads), but linear in message count, so it grows with every simulated scenario.
- Re-processing a thread re-runs extraction, critic and judge on the whole thread after each new message (8 s idle debounce). The answer is never cached by input: `WORKBENCH_LLM_CACHE_FILE` is written but never read.

**Proposal:**
- Run extraction and the critic **outside** the lock (they only read the thread), take the lock for link → store → judge → reconcile. Judge all new assertions of a job in **one** call (one prompt with several new assertions and their candidates), or in parallel with `asyncio.gather`.
- Cache the knowledge-graph view by a state version (incremented by `emit_changes`); compute the over-reach flag from `ContextStore.reach` (finding 2) plus the thread's mentions only.
- Cache LLM answers by hash of (model, system, user): re-processing an unchanged thread, a re-run or a replay costs nothing, and the live demo survives a provider outage on threads already seen.

**Effort:** ~2 h in total; the lock change alone is ~30 min.

### 10. The agent interface (confirmed: A1, A2)

**Evidence.** `mcp_server.get_context` takes `(entity_id, at)` only, so an external agent never gets `check_status`, `to_read` or the track record, the best measured features (backlog item 4). Every MCP tool calls `_store()`, which reloads the inventory and `out/context_store.json` from disk; `get_patterns` also re-reads every thread. And that file is the **CLI** store: knowledge captured live in the workbench (Slack, scenarios) is invisible to MCP. `api.py` caches its store with `lru_cache` forever, so it never sees a new `ctx run`.

**Proposal:**
- Serve MCP **from the workbench process** over the live store (MCP Python SDK 2.x streamable HTTP, mounted next to the FastAPI routes), keeping the stdio entry point for the CLI store.
- `get_context(entity_id, at, observations=None)` returns `check_status`, `to_read`, `track_record` per item (the code exists in `routes.agent_run`). Add a `read_observation(entity_id, field)` tool backed by the incident's observations: that is technique A (the corrective read loop) and the brief's "check the counters", done by the agent itself.
- Load the stdio store once and reload on file mtime change.

**Effort:** ~1.5 h. **Done when:** A1 and A2 print `fixed`, and an MCP client test gets `check_status` for Erkki's rule on TRN-117.

### 11. Evaluation honesty

- **Numbers:** regenerate every LLM number from one commit in one run, and report labels as the upper bound (backlog item 5, still open).
- **Labels written by an LLM:** `workbench/generator.py` writes the `expected` items of generated scenarios with an LLM (possibly the same family as the extractor). Scoring an LLM extractor on LLM-written labels inflates it. Keep generated scenarios out of the scored set, or tag them and report them apart.
- **Critic and judge are unmeasured** (see finding 8). The cheapest credible number: run the eval with the critic on and off, on the same cached extractions.

## Tools: are we using the right ones?

| Tool | Verdict | What to change |
| --- | --- | --- |
| OpenAI-compatible SDK for every provider | Right: one client, providers swap by config | One client per provider, parse-error repair and fallback, one 429 retry (finding 7) |
| Pydantic contracts and JSON output | Right | `json_schema` mode where the provider passes `llm-check` |
| Deterministic linker, no LLM linking | Right ("a wrong link is worse than none") | Add the guards of finding 1; it is the main accuracy lever |
| NetworkX in memory as the runtime graph | Right for this size (sub-ms at 4k elements) | Two graphs (`ContextStore.g` and `KnowledgeGraph`) and four reach functions: share one reach (finding 2), cache the view (finding 9) |
| Neo4j as an optional mirror | Right as a mirror; Elisa names Neo4j | Keep it off the runtime path; show the temporal Cypher query in the pitch |
| MCP Python SDK 2.x | Right: it is how agents call us | Live store, observations, read tool (finding 10) |
| FastAPI + SSE for the workbench | Right | None |
| Embeddings (`gemini-embedding-001`, hashed fallback) | Right; calibrated for patterns | Uses the primary provider only (no fallback); fine |
| MongoDB Atlas (documents, vector search) | Data is there, but **no decision uses it**: `/similar` and `ctx dataset similar` only | Use vector search where it fixes a failure: candidates for the judge (technique B), the "seen on other units, scope not confirmed" fallback. Add filter fields to the vector index (`type`, `valid_to`, `bound_to.entity`) so the search can pre-filter instead of post-filtering |
| Tiger Data (hypertable, continuous aggregate) | Same: only `/freshness` and CLI | `daily_mentions` has no refresh policy (`add_continuous_aggregate_policy`), so it goes stale after the load. `/freshness` measures age against wall-clock now, not `at`/sim time. Strongest use: a staleness signal on knowledge (hard point 3), e.g. "rule last confirmed 14 months ago, element discussed 300 times since" shown next to the rule |
| Streamlit (`demo/app.py`) | A third UI and a heavy dependency | Drop it from the main dependencies if the workbench and the product demo are the chosen surfaces (backlog item 9) |
| Not needed now | — | A reranker, GraphRAG community summaries, a multi-agent orchestrator: no measured failure they fix (same conclusion as the backlog) |

## Scope check

Every proposal stays in scope: inputs stay chat and email, no specialist is asked for anything, the guards only refuse to bind or to merge, and the observation tool reads what a human rule says to check (step 3 of the brief's strong demo), not telemetry for diagnosis. The Tiger staleness signal reads message counts, not network data.

## Recommended order

| # | What | Findings | Effort | Why first |
| --- | --- | --- | --- | --- |
| 1 | Linker guards | 1 | 1.5 h | Main accuracy gap with the real LLM; deterministic, offline-testable |
| 2 | Shared `reach` + subset rule in lifecycle | 2 | 1 h | Time hard point; makes the firmware story work with LLM output |
| 3 | Small fixes: facts merge, outcome heuristic, `confirmed_by`, applications for cited rules only | 4, 5, 6 | 1.5 h | Each is a wrong answer a judge can trigger |
| 4 | Parse-error repair, 429 retry, scoped known topics | 7 | 1.5 h | Live demo robustness |
| 5 | MCP on the live store with observations and `read_observation` | 10 | 1.5 h | "Fit for agentic operations": what an external agent actually gets |
| 6 | Hooks in the eval, one LLM run by a human, one set of numbers | 8, 11 | 1 h + run | Credible numbers for the slides, critic and judge measured |
| 7 | Lock scope, judge batching, graph cache, LLM answer cache | 9 | 2 h | Smooth live demo with several threads |
| 8 | Firmware per element; Atlas/Tiger in the decision path | 3, tools | 2–4 h | If time allows |

After steps 1–3, rerun `uv run python scripts/review_probes.py`: every linked probe should print `fixed`.
