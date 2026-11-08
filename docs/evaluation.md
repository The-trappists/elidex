> This file holds three evaluations that do different jobs. **Part 1** (below) compares extractor models on the workbench scenarios (`src/context_layer/evaluation.py`, `scripts/eval_models.py`). **Part 2** (further down, from the `accuracy` work) measures retrieval, exchange and field feedback (`src/context_layer/eval/`, `ctx eval`). **Part 3** (at the end) measures linking, lifecycle and retrieval at company scale on the 3-million-thread dataset (`src/context_layer/eval/scale.py`, `ctx dataset eval`). They have separate code and separate metrics; do not mix their numbers.

# Part 1: Evaluation and model comparison

How we measure the extractor and the linker against the `expected` items of the workbench scenarios.
Code: `src/context_layer/evaluation.py` (pure helpers), `evaluate()` in `src/context_layer/workbench/processor.py`
(used by the workbench UI), `scripts/eval_models.py` (model comparison).

## The metric

An extracted item is compared with an expected item on **(type, scope, action)**, not on the topic slug.
Two models name the same knowledge differently (`sfp-swap-first-step` vs `tx-3000-post-sfp-swap-zero-counters`),
but they should bind to the same things and advise the same action.

- **scope** is the normalised scope of the existing `_scope_key` (resolved element ids, site ids, element class, trigger).
- **action similarity** is the token Jaccard of the two `action` strings (lowercase alphanumerics). Both actions
  empty (typical for facts) counts as identical.

Matching is greedy, deterministic and one-to-one, in three passes (expected items in order, best candidate wins):

1. same type, same scope, similarity >= 0.5 (or both empty): **matched**.
2. same type and scope, different action: **binding_diffs** ("same scope, different action").
3. same type, same action, different scope: **binding_diffs** ("same action, different scope"): the over/under-linking signal.

What is left over is **missed** (expected, not found) or **unexpected** (extracted, not expected). Names in
`matched` and `missed` use the expected topic, names in `unexpected` the extracted topic. Items paired in
pass 2 or 3 are reported only in `binding_diffs`, not in missed/unexpected.

**Link precision and recall** (script only, not in `EvalResult`) compare sets of `(type, entity, role)` bindings
produced by the real `Linker` for the extracted items against those it produces for the expected items.
Precision drops when the model over-links (extra entities), recall when it under-links.

## Running it

All commands from the repo root.

```bash
uv run python scripts/eval_models.py --scripted     # default, offline, free
uv run python scripts/eval_models.py --dry-run      # what --run would call
uv run python scripts/eval_models.py --run --yes-spend-credits   # real calls, a human runs this
```

- `--scripted` scores the scenarios' own expected items (must be perfect: it proves the metric and the
  linking are consistent) and, for the few scenarios with a hand-written cached extraction in
  `data/cache/extractions.json`, that cache against expected. The cache is keyed by thread path, so a small
  alias map in the script ties scenario ids to cache keys.
- `--dry-run` lists the candidates, whether their key variable is set (never the value) and the estimated number of calls
  (one per scenario with expected items, per candidate).
- `--run` calls each candidate once per scenario through `llm.call_provider` with the production extraction
  prompt and parser, then prints a markdown table and writes `out/eval/<timestamp>.md` and `.json`
  (the JSON has per-scenario details). It refuses to run without `--yes-spend-credits`.

Candidates are in a JSON file (`--candidates`, default `scripts/eval_candidates.example.json`): `name`,
`base_url`, `model`, `json_mode` (`json_object`, `json_schema` or `prompt`) and `api_key_env`, the **name** of the
environment variable that holds the key. Never put a key in the file. Export the variables in your shell (or
have `.env` loaded for you) before `--run`. A candidate whose variable is unset is skipped.

## Reading the table

| Column | Meaning |
| --- | --- |
| matched | expected items found (right type, scope and action) |
| missed | expected items not found: lost knowledge |
| unexpected | extracted items nobody expected: noise, or valid knowledge the ground truth lacks |
| binding_diffs | found, but with the wrong action or the wrong scope: read the JSON for the detail |
| link precision / recall | share of produced bindings that are right / share of expected bindings produced |
| avg latency, calls | per call; a call that fails counts, its scenario counts as all missed |

Prefer a model with few missed and high link precision: a wrong link is worse than none.

## Known limits

- Synthetic and small: 21 scenarios with expected items, about one item each. A difference of one or two items is noise.
- Ground truth is the scenario author's reading; a good extraction that the author did not list shows as unexpected.
- Action Jaccard is a token overlap: it misses paraphrases with few shared words and can pass loosely similar actions.
- Facts have no action, so any two facts with the same scope match. Scope and type carry the signal there.
- One run per model: LLM output varies between runs, and latency depends on the provider's load.
- The script scores single-thread extraction only, with no known topics and no lifecycle or review agents.

See [model-improvements.md](model-improvements.md) for the first real comparison run (Gemini, Mistral Large and Medium) and the suggested improvements.

---

# Part 2: Evaluation: how accurate is it?

> **Status: proposal** (branch `accuracy`). The labels are ours: see [data/eval/README.md](../data/eval/README.md).

`ctx eval` answers two questions and writes `out/eval/report-<extractor>.md` and `.json`.

```bash
uv run ctx eval                      # offline: labels used as a perfect extractor
uv run ctx eval --extractor llm      # the real LLM extractor (needs LLM_* in .env); answers cached
uv run ctx eval --extractor cache    # re-score the last LLM run offline
```

The knowledge base is rebuilt from the 26 labelled workbench scenarios in time order, through the real pipeline (extract → link → store → lifecycle). Retrieval uses the demo agent's own code (`agent.run_agent`).

## 1. Retrieval: when a problem happens, do we get the right solution?

26 labelled cases (`data/eval/retrieval_cases.json`): a problem on an element at a time, with observations. 19 have a right answer, 7 are traps where the right answer is nothing. Two traps test chats that *look* technical but are personal (a car that will not start at the Sodankylä mast, a home router "of the same make as our RT-9s").

| Metric | Meaning |
| --- | --- |
| **Accuracy** | % of cases answered exactly right: every expected solution and no noise. **The headline number** |
| Solution found | % of cases with a right answer where it came back |
| Clean answers | % of cases with no useless knowledge in the answer |
| Correct silence | % of trap cases where nothing came back |
| Precision | Of the knowledge returned, % that was useful (1 − precision = useless share) |
| Recall | Of the knowledge that should come back, % that did |

Two modes: **plain** (`get_context`: element, its class, its site, valid at time t) and **with conditions** (the agent drops rules whose checks fail on the observations, e.g. counters moving).

## 2. Exchange: did we keep the right information from each conversation?

| Metric | Meaning |
| --- | --- |
| Item recall / precision | Knowledge found vs. labels; invented items lower precision |
| **Message precision** | Of the messages the extractor cited as knowledge, % that really carry it (signal vs. chatter) |
| Message recall | Of the messages that carry knowledge, % it cited |
| Binding exact | Found items bound to the same element, site and class as the label |
| Trust right | Same `hunch` / `stated` / `verified` as the label |
| Noise threads left empty | Small talk produced no knowledge |
| Avg confidence right vs invented | Whether the LLM's confidence means anything (see below) |

An LLM's topic slugs rarely match the labels, so items are matched by type and scope, then by overlap of cited messages.

## Results (2026-11-07, labels as extractor)

| Mode | Accuracy | Solution found | Precision | Noise items |
| --- | --- | --- | --- | --- |
| plain | 73% | 100% | 70% | 9 |
| with conditions | 100% | 100% | 100% | 0 |

Plain retrieval always finds the solution but adds useless knowledge in 7 of 26 cases. For example, it returns the old-unit SFP rule when counters are moving, or the TX-5000 power-dip advice for an SFP problem. Condition checks remove all of it. With labels as the extractor, extraction scores are 100% by construction.

### With the real LLM extractor (run 2026-11-07 14:51, re-scored with `--extractor cache`)

| Mode | Accuracy | Solution found | Precision | Noise items |
| --- | --- | --- | --- | --- |
| plain | 35% | 95% | 43% | 27 |
| with conditions | **62%** | 95% | 59% | 14 |

The LLM finds the knowledge (item recall 96%), but binds it too widely: binding exact is only 41%. 15 of its 24 items get an element class, 14 of them on top of the one unit the chat was about, and 7 of those classes have no type (`class:any:ru-200`). Unit-specific advice then reaches every unit of that model. Example: the frost tip stated for RAD-176 comes back for RAD-198 and RAD-221. This, not ranking, is the main accuracy gap. "Fully checked" drops to 83% precision. Field feedback still scores 6/6 with 0 false alarms. The 3 new scenarios are not in the cache yet: rerun `--extractor llm`.

## 3. Edge cases: what if the agent knows less? (check status)

### Words used here

| Term | Meaning | Example |
| --- | --- | --- |
| **Observation** | A fact the agent has about the case | `traffic_counters: 0` on TRN-117 |
| **Condition** / **check** | When a rule applies; a *check* is a condition the code can test on an observation | Erkki's SFP rule: "interface UP, optics normal, counters 0". "After a storm" has no check: it is in words only |
| **Noise** | Knowledge returned that does not help | The SFP rule when counters are moving (1250 pkt/s) |
| **Solution lost** | The right knowledge did not come back | Worse than noise: the agent never sees it |
| **Precision** | Of what came back, % that was useful | 3 useful + 1 noise = 75% |

### The problem

With **every** observation, condition checks give 100%. A real agent often has only some. Example: on TRN-117 it knows "SFP swapped, interface UP" but not the counters. The SFP rule's counter check cannot run, so the rule stays in, and it may be noise (if counters are moving, it is). `ctx eval` reruns every case with **every subset** of its observations (349 runs, all combinations, no random sampling):

| Observations missing | 0 | 1 | 2 | 3 | 5 |
| --- | --- | --- | --- | --- | --- |
| Accuracy | 100% | 91% | 80% | 67% | 43% |
| Solution lost | 0 | 0 | 0 | 0 | 0 |

The right answer never goes missing, but noise comes back.

### What we tried and rejected

- **Weights** (rank by trust, by specificity, by LLM confidence): all the ranking signal sits in 3 cases, and fixed priorities are biased. On TRN-305 after a power dip, "verified" and "unit-specific" both put the VLAN rule above the right answer (a class-wide hunch). LLM confidence ranked worst of all (not calibrated).
- **Strict drop** (remove any rule that could not be fully checked): it lost the right answer in 31–48% of runs. Dropping is worse than showing noise.

### The solution: tell the agent how far each rule was checked

Each kept rule gets a **check status**, a fact about the case, not a weight. Nothing is dropped or reordered:

| Check status | Meaning | Example | What the agent does | Precision |
| --- | --- | --- | --- | --- |
| `fully checked` | every check ran and passed | TRN-131: swapped, UP, normal optics, counters 0 → SFP rule 4/4 | act on it | **100%** (58 items) |
| `not fully checked` | some checks could not run; `to_read` lists the fields | same case without counters → "read first: traffic_counters" | read those fields, then act | 72% (all 148 noise items) |
| `text only` | no machine check (none, or in words only) | barrier key at Kemijärvi; "after a storm" | use it, judging the words | 100% (81 items) |
| `failed` | a check is false | counters 1250 → SFP rule removed | (not shown, listed as "not applied") | |

All the noise lands in `not fully checked`, and the agent can clear it itself by reading the missing field. No human step. Shown in `ctx agent --conditions`, sent to the LLM agent, and returned by the workbench agent API (`check_status`, `to_read`).

Caveat: "fully checked = 100%" is partly true by design (a rule whose checks all pass applies). The real risk is the LLM extractor writing a wrong check, so rerun with `--extractor llm`.

## 4. Knowledge that does not work in reality (field feedback)

### Words used here

| Term | Meaning | Example |
| --- | --- | --- |
| **Outcome** | What the agent observes after applying a rule | Waited 25 min as the vendor tip said: TRN-229 still `DOWN` |
| **Symptom check** | A rule's check that describes the problem, so it should change when the fix works | `interface_status == DOWN`. Not `sfp_replaced`: that is an event, it stays true |
| **Track record** | Outcomes of a rule up to the case time | "worked 0/2 (failed on TRN-229, TRN-240)" |
| **Contested** | Failed at least twice, and more often than it worked | The vendor hunch after two failures |

### The problem

Before, nothing came back from the field: a tip that failed every time stayed "stated" or "verified" forever. Only a later chat could close it.

### The solution: two ways to learn it, no human step

1. **From the agent's own observations** (`mvp/feedback.py`). After acting, the agent compares what it sees with the rule's symptom checks:
   - symptoms all still there → *did not work* (TRN-229 still `DOWN` after waiting);
   - a symptom gone → *worked* (TRN-131: counters at 980 after the bounce);
   - nothing observed, or the rule has no machine check → *no verdict*, nothing recorded. We do not guess.
2. **From a later chat** (lifecycle). Veikko reports "waited, still down, a reboot fixed it" (`vendor-tip-failed-report-back`): his advice is stored for TRN-229 only and flagged in conflict with the vendor hunch.

The rule is **never dropped on feedback**: one failure can have another cause, and one node is not proof for a whole class. It is shown with its track record, and with "CONTESTED: check before acting" after 2+ failures that outnumber its successes. A record counts only outcomes before the case time.

| Measure | Result (labels as extractor) |
| --- | --- |
| Outcome judged right (worked / did not / no verdict) | 100% of 6, including 2 "no verdict" edge cases |
| Contested flag right per case | 100% of 26, 0 false alarms |

Where: `ctx agent` and `ctx context` print the track record; the LLM agent and `POST /api/agent/run` get it; the guard warns when it adapts an action because of a contested tip. Record an outcome with `ctx outcome ctx_0004 TRN-229 --after '{"interface_status": "DOWN"}'` or `POST /api/agent/outcome`. Since the outcome unification, technicians' replies read by the outcome loop land in the same ledger (`Outcome.source = "thread"`) and count in the track record; the measures above replay observation outcomes only and are unchanged. See [outcome-unification.md](outcome-unification.md).

Limit: "a symptom changed" is not always "fixed" (optics could go from normal to low while counters stay at 0, which counts as "worked"). The agent can pass `worked` explicitly when it knows better (e.g. the ticket was closed).

## Confidence: what the percentage is

The `confidence` shown in the workbench (e.g. "conf 85%") is **the LLM's own estimate** (0 to 1), written in each extracted item. Nothing computes it, and the prompt does not define it. In scripted and cached runs it is a number written by hand in the labels or the cache.

What the code does with it:
- the linker drops items below `MIN_CONFIDENCE` (0.5, `.env`);
- when the same knowledge arrives from chat and email, the stored assertion keeps the higher value;
- retrieval and the agent do **not** use it to rank or filter.

It is not calibrated: 85% does not mean "right 85% of the time". `ctx eval --extractor llm` reports the average confidence of right vs. invented items, which shows whether it carries any signal.

## Limits

- Labels written by people who know the system; small set (26 cases, 26 conversations, 6 outcomes).
- Conditions only help when the agent has the observations; with none, plain retrieval applies.
- No ranking, on purpose (see section 3): the agent gets a set plus a check status per rule.

---

# Part 3: Retrieval accuracy at company scale

> **Status: proposal** (branch `feat/scale-retrieval-eval`, 2026-11-08). Code: `src/context_layer/eval/scale.py`, `src/context_layer/mvp/relevance.py`. Run: `uv run ctx dataset eval out/dataset/large` (about 13 minutes, single process). Report: `out/eval/scale-large-test.md` and `.json`; the 2026-11-08 run is saved in [docs/results/scale-large/](results/scale-large/README.md), with the results dashboard.

## What "retrieval accuracy" means here

We retrieve at three moments. Each has its own accuracy, and the last one is what an agent (and a judge) sees:

| Moment | What is retrieved | Accuracy question | Where it is measured |
| --- | --- | --- | --- |
| 1. Capture | the knowledge hidden in the chats | Did we find the one sentence of real knowledge, and nothing else? | Part 2 "Exchange" (real LLM, 26 hand-written chats) |
| 2. Link | the graph entities the knowledge is about | Does it reach exactly the right elements (no over-linking)? | Part 3 "Linking" (3,000 facts, real thread text) |
| 3. Serve | the knowledge for an agent's case (element, time, problem) | Right knowledge, valid now, about this problem, and nothing else? | Part 2 "Retrieval" (26 cases) and Part 3 "Retrieval" (9,300 cases) |

Time cuts across all three: knowledge that was closed (firmware fix, key moved) must stop coming back. Part 3 measures it as "Lifecycle" and as "stale" answers.

## Why a second retrieval evaluation

Part 2 has 26 cases over 23 assertions. At that size, the knowledge about one element fits on a screen. In the company dataset (`ctx dataset generate --scale large`: 3,000,000 threads, 13.8 M messages, 20,086 elements, 3,000 ground-truth facts), **a TX-3000 node is covered by a median of 316 valid facts**, 21 of them about the same problem. Retrieval by element and time alone then hands the agent everything known about the element, whatever its problem. Part 2 cannot show this.

## Method

1. **Knowledge base.** Every knowledge thread of the dataset (3,347, i.e. 0.11% of the threads), in time order, through the real `Linker`, `ContextStore` and `reconcile`. The extractor is the ground truth (an oracle). This isolates linking, time and retrieval from the LLM, which Part 2 measures. An echo ("as Erkki said…") names no element, so a perfect extractor cannot scope it either: it is skipped. A hunch later confirmed gives the asker's guess in the first thread and the expert's confirmation in the second.
2. **Cases.** 9,300 cases built from the ground truth, one family of probes per fact: a similar case on another element of the class (the brief's step 3), a near miss (same model, outside the install years), another unit at the same site, after the knowledge was closed, before it was said, a dispatch to the site, and 1,500 random elements. The expected answer is computed from the ground truth (reach, validity), never assumed.
3. **Problem in words.** Each case describes its problem as an incident would (`data/eval/scale_problems.json`), written by hand before any matcher, deliberately not in the generator's words. Two wordings per problem: `dev` to tune, `test` to report. The thesaurus and the threshold were tuned on `dev` only.
4. **Five pipelines**, same cases, same scoring:
   - naive RAG over the raw chats: BM25 over whole threads with a contextual prefix (channel, subject), the same thesaurus, element ids as tokens, top 5. Index: all knowledge threads plus a systematic 10% sample of the other threads (300,000). A larger haystack can only make it worse;
   - RAG over the extracted knowledge, no graph: top 5 assertions by problem match, valid at the case time. What "extract, then vector store" gives with a perfect extractor;
   - graph scope + time: `get_context` (today's plain mode);
   - + condition checks: `run_agent(use_conditions=True)` (today's mode);
   - + problem relevance (new, `mvp/relevance.py`), in two variants: *default* (when no rule on the element matches, act on all of them, as today) and *strict* (act only on matching rules).
5. **Scoring.** Each returned item is relevant (the knowledge for this problem, valid here and now), acceptable (same problem family, or site access), other problem (valid here, another symptom), stale (about this element, but closed or not yet said at the case time), wrong scope (does not apply to this element) or haystack (a chat with no knowledge). **Accuracy** = the right knowledge came back (or nothing, when nothing applies) and no noise.

## Problem relevance (new)

`get_context` stays the first stage: it gives recall with the right scope and time. `mvp/relevance.py` adds a second stage that tags each rule with whether it is about the case's problem, as the check status does for observations. Nothing is dropped and the order is "matching first"; `AgentReport.matching()` is what the agent acts on.

- Score = IDF weight of the problem's concepts that the rule mentions, over the IDF weight of the problem's concepts the knowledge base knows at all. Concepts come from a small field thesaurus (SFP = transceiver = optic, reboot = restart, "goes up and down" = flap, dispatch = access…).
- Scope words are the graph's job and are removed: element and site ids, the case's site name, "installed up to 2018".
- An invalidation inherits the problem of the rules it closed ("3.9 fixes the leak" answers "node sluggish").
- The LLM agent receives `problem_match` and `problem_match_score` next to `check_status`.
- Threshold 0.4, chosen on the `dev` wording as the most accurate one that keeps at least 97% of the solutions.
- Where it runs: `run_agent(..., use_relevance=True)` (off by default in the function). The workbench turns it on with the `use_relevance` setting (default on). MCP `get_context(entity_id, at, problem=..., observations=...)` and REST `/context/{entity_id}?problem=...` tag each rule with `problem_match` and list matching rules first. `ctx agent --relevance` prints one match line per rule.

## Fixes found by the scale run

| Finding (large dataset) | Fix | Where |
| --- | --- | --- |
| A hunch confirmed later by an expert, in a thread that does not name the site again, stayed as two assertions (hunch and verified) | Same knowledge is compared on scope (`applies_to`, trigger), not on where it was seen; `observed_on` bindings are added on merge | `store.py` `_binding_key`, `_add_bindings` |
| A release note closed bug reports about firmware that is not older than the release ("3.9 fixes the leak" closed "firmware 3.9 leaks memory") | A firmware invalidation closes a rule only when the version it ships is newer than the one the rule names; with no version on either side, nothing changes | `mvp/lifecycle.py` `fix_predates` |
| An alias like `HEL101-TRN2` was cut in two by the id pattern | Longest id forms first | `mvp/relevance.py` |

The merge fix also solves the live failure listed in [final-improvements.md](final-improvements.md) (technique B): in the labelled set, Veikko applying Erkki's tip on TRN-117 is now a confirmation of Erkki's rule (observed on TRN-042 and TRN-117, `confirmed_by` Veikko) instead of a second rule. Part 2 numbers are unchanged (scripted 100% with conditions, recorded LLM run 65%).

## Results (2026-11-08, `large`, test wording, threshold 0.4)

| Pipeline | Cases | Accuracy | Solution found | Correct silence | Precision | Rules per case p50 / p95 | Stale | Wrong scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Naive RAG over raw chats (BM25, top 5) | 2,000 | **0.3%** | 66.6% | 0.1% | 11.1% | 5 / 5 | 119 | 6,548 |
| RAG over extracted knowledge, no graph (top 5) | 9,300 | **1.7%** | 49.6% | 3.5% | 8.1% | 5 / 5 | 0 | 41,345 |
| Graph scope + time (today, plain) | 9,300 | **48.3%** | 100% | 74.2% | 10.0% | 2 / 46 | 0 | 0 |
| + condition checks (today) | 9,300 | **48.3%** | 100% | 74.2% | 10.8% | 2 / 42 | 0 | 0 |
| + problem relevance, default (all rules when none matches) | 9,300 | **80.3%** | 100% | 74.5% | 44.8% | 1 / 10 | 0 | 0 |
| + problem relevance, strict | 9,300 | **89.0%** | 100% | 92.9% | 73.0% | 1 / 6 | 0 | 0 |

On the naive-RAG sample alone (2,000 cases, like with like) the other rows move by less than one point. Latency: p50 under 0.5 ms and p95 about 12 ms for the graph pipelines (`get_context` + checks + relevance), 4 ms for BM25.

| Kind of case | Cases | Today (graph + time + conditions) | Relevance, default | Relevance, strict |
| --- | --- | --- | --- | --- |
| Similar case, same class (the brief's step 3) | 1,039 | 0.0% | 84.8% | 84.8% |
| Near miss, same model outside the class | 986 | 7.6% | 68.6% | 90.6% |
| After the knowledge was closed | 302 | 11.9% | 80.1% | 80.1% |
| Same unit | 1,116 | 65.8% | 80.3% | 80.3% |
| Dispatch to the site | 543 | 69.6% | 100% | 100% |
| Other unit, same site | 1,116 | 79.8% | 79.9% | 93.1% |
| Before it was said | 2,698 | 45.7% | 74.7% | 87.5% |
| Random element | 1,500 | 76.6% | 88.2% | 94.8% |

Solution found is 100% for every kind in both variants.

**Linking**: 3,000 of 3,000 facts linked, reach exact 100%, 0 over-linked (class, instance and site facts alike), with the real thread text.

**Lifecycle**, rebuilt from the same threads before and after the two fixes:

| Measure | Before | After | Of |
| --- | --- | --- | --- |
| Hunch confirmed later by an expert, kept as one rule | 72 | 285 | 285 |
| Hunch confirmed later, ends with trust "verified" | 76 | 285 | 285 |
| Expert disagreements flagged as conflicts | 188 | 188 | 188 |
| Rules closed by a release not newer than their firmware | 3 | 0 | |
| Rules that should stay open but were closed | 41 | 0 | |
| Distinct rules stored from the 3,000 facts | 2,950 | 1,879 | |

Site access (key moved): 46 of 46 closed at the right time. Firmware: the 346 bug reports merge into 30 rules, each closed by the first newer release that fixes it. The ground truth gives each repeated report its own fix date, so 69 of 76 rules close at the ground-truth time; the other 7 close earlier, by an even newer release that fixes the same bug (for example "5.2 uses 64-bit counters" closes "firmware 5.0 wraps the counters").

**Hand-written chats (Part 2 set, 26 cases).** The descriptions there are the labellers' notes, not incident texts. With relevance (default): labels as extractor 100% → 100%; **recorded real-LLM run 65.4% → 80.8%**, noise items 13 → 5, solution lost 1 → 1 (the extraction miss of `new-unit-trn305`). In strict mode, or with only the observations as the description, answers get lost: relevance needs the problem in words.

## What this says

1. **The graph and the clock are right; the problem was relevance.** Graph scope + time never returns stale or wrong-scope knowledge and always finds the solution, but at company scale it hands the agent everything known about the element (p95 42 rules). Only 1 in 10 is about the agent's problem.
2. **Text retrieval cannot replace the graph.** With perfect extraction, top-5 retrieval over the knowledge has 41,345 wrong-scope answers and finds the solution half the time: advice for a TX-5000 looks the same as advice for a TX-3000. Over the raw chats it also returns closed knowledge and chatter.
3. **Two stages give both:** graph + time for scope and validity (recall), problem relevance for the problem (precision). Strict is more accurate (89%). Default (80%) did no worse than today in any kind of case, nor on the hand-written chats, where descriptions are vague.

## Limits

- **Synthetic, template language.** The generator writes a few dozen sentence patterns, so the absolute numbers are optimistic; the gaps between pipelines are the finding. Nothing here is Elisa data.
- **Oracle extraction.** The LLM is not in this loop (no calls were made). With the real extractor, linking is the weak spot (Part 2: binding exact 41%), and every number here is an upper bound for that stage.
- **Word-based matcher.** A paraphrase that shares no concept with the rule is missed, and generic words ("alarm", "slow") still let some look-alike rules through. A dense embedding model (the team's `gemini-embedding-001`) could replace `concepts()` behind the same interface; that needs a human run with the key.
- **Our own incident wordings.** Written before the matcher, split into tune and report wordings, but by the same people.
- **Naive RAG on a 10% haystack sample** (300,000 threads plus all knowledge threads), which favours it.
- **Default variant only.** The workbench, MCP and REST use the default (fallback) variant. Strict is measured, not wired.

## Not done yet (open for anyone)

- Web UI: a `use_relevance` toggle on the Settings page (`web/src/pages/SettingsPage.tsx`, `types.ts`, fixtures), and a problem-match badge per rule in the Agent tester (`AgentTester.tsx`). The backend already sends `problem_match`, `problem_match_score` and `problem_matched`.
- A `docs/decisions.md` entry if the team adopts relevance as the default for the demo.
- The dense-embedding variant of `concepts()` (see Limits).
- Re-run: `ctx dataset generate --scale large` then `ctx dataset eval out/dataset/large --split test`; results go to `out/eval/`.
