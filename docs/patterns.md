# Patterns: recurring and linked problems

> **Status:** built on branch `feat/pattern-recognition` (2026-11-07). It covers backlog item 10 in [final-improvements.md](final-improvements.md) and extends it to problems on several elements at the same time. Logged in [decisions.md](decisions.md).

## What it does

The pattern finder reads the knowledge that is already captured and looks for two things:

| Kind | Question | Example from the seed |
| --- | --- | --- |
| **Recurring** | Does the same workaround keep being needed? | Breaker F3 at the harbour hut tripped 3 times this autumn; each time someone reset it |
| **Linked** | Did elements in separate conversations have trouble at the same time, and do they share something in the network? | TRN-229 (Oulu, Slack, night NOC) and TRN-131 (Rovaniemi, Teams, field team) dropped the same evenings twice. Both are linked to TRN-117, which nobody mentioned |

For each pattern it writes a short report:
- **What the elements have in common:** a topology neighbour (a *hidden suspect* if nobody reported it), a direct link, a site or a firmware.
- **The fixes applied so far,** each marked as *clears the symptom* (reboot, bounce, reset...) or *lasting* (replace, upgrade, rewire...).
- **Lasting fixes people already stated:** the firmware 4.2 fix while the inventory says TRN-042, TRN-088 and TRN-117 still run 3.8, or Liisa's "rewire the dehumidifier" proposal that nobody has applied yet.
- **Up to 3 hypotheses,** strongest first. Each cites what it rests on.
- **Who to ask.**

## What it does not do (scope)

- It reads **no alarms and no telemetry**, and it does not diagnose faults (out of scope, see [challenge.md](challenge.md)). Its input is what people said (assertions and their source threads), field outcomes, and the inventory and topology.
- **A hypothesis is never a rule.** Nothing here is returned by `get_context`, the guard or the agent's retrieval. The agent's main path, and the eval numbers, do not change (tested). An agent can read patterns on purpose through a separate tool, labelled as unconfirmed.
- **No extra work:** nobody confirms anything. A pattern closes on its own when someone later states a lasting fix: Erkki's "replaced the clock module on TRN-117" resolves the TRN-131 / TRN-229 pattern.

## Rules (and how they avoid flooding)

| Rule | Value | Why |
| --- | --- | --- |
| An occurrence | A workaround bound to a named element, once per source thread, plus each field outcome | A workaround means someone had a problem and did something about it. General advice bound only to a class is not an occurrence |
| Same problem, other name | Two topics count as one problem when they are about the **same place** (a shared element, an overlapping class or site scope, or units of the same type and model; meaning alone needs one of the first two), pass **two guards**, and **say the same thing**. The guards: no contradicting symptom check (`optical_levels` low vs normal, interface DOWN vs UP), and not a workaround vs its cure (reset F3 vs rewire the dehumidifier). They hold for every member of both groups, because grouping is transitive. "Same thing" means one of: topic words or fix words overlap by half or more (element ids and models removed first), identical symptom checks (3+), or, with an embedding model, the **same meaning** (see below). The pattern says why it grouped them | A real LLM does not always reuse a topic name ("turku-harbour-hut-breaker-f3-trip" vs "harbour-hut-breaker-trip"), and people tell the same problem in other words; without this, the repeats would be split |
| Same case | Chat + email on the same element and problem within 24 h count once | Erkki's chat and email are one case, not two |
| Recurring | 2 occurrences = watch, 3+ = insight | Twice can be chance |
| Linked window | Reports at most 6 h apart, fixed windows (a busy day does not chain) | |
| Linked needs | 2+ elements from **separate** conversations, and a shared factor | If one person already linked them in one thread, it is known, not hidden |
| Factor strength | Shared neighbour, direct link, site: strong. Same firmware: medium (only with 3+ elements or a repeat). Same model: weak (only shown, never creates a pattern) | Same firmware is common, so alone it would flood |
| Linked levels | Seen once = watch. Seen twice, or 3+ elements = insight | |
| One entry per cause | A repeat already explained by a linked pattern is not listed again; factors that explain the same reports merge | |
| Watch cap | 10 most recent | |
| Resolved | A *stated* or *verified* lasting fix after the last occurrence, bound to the elements (recurring) or to the shared neighbour or site (linked) | A *hunch* ("someone should rewire it") never closes a pattern |
| Rollout gap | A lasting fix that names a firmware version keeps the pattern open while the inventory shows elements below it | "4.2 fixes it" is true for a node only once it runs 4.2 |
| No future | Knowledge stated after `at` is ignored | The report at a past date shows what was known then |

The rules are in [mvp/patterns.py](../src/context_layer/mvp/patterns.py) (`PatternSettings` holds the numbers).

## Same problem in other words (embedding model)

Word overlap cannot see that "the moisture absorber overloads the cut-out, push it back in" is the breaker F3 trip again. On the labelled pairs, hashed words score the different "ferry radar vs breaker" pair (0.49) above most same-problem paraphrases (0.08 to 0.43), so no threshold works with words alone.

With `EMBEDDING_MODEL` set (the same model as the vector search in [dataset.md](dataset.md), `gemini-embedding-001` was validated there), patterns also compare **meaning**:
- The text embedded is the topic, diagnosis, summary and fix, without element ids and models.
- Two topics with cosine similarity of at least `PATTERNS_SAME_MEANING` (default 0.78, calibrated on `gemini-embedding-001`, see below) count as one problem. Both guards still apply, and no similarity can overrule them (tested with a model that calls everything identical).
- Meaning needs a **real shared place**: the same element, or an overlapping class or site scope. Units that only share a model are never grouped by meaning. The first real run grouped RAD-176's frost margin dip with RAD-198's iced dish (two RU-200s, similarity 0.82): similar kind of problem, two causes, and RAD-176's label says "on RAD-176 only". "Same model" still counts for the stronger evidence (similar words, identical checks).
- Vectors are cached in `out/patterns/embeddings.json`, so the workbench embeds only new knowledge.
- If the model fails (no network, quota), patterns fall back to words only and say so. The report, the API and the Patterns page show `meaning: on / off / failed`.
- The hashed-words fallback of `embed.py` is not used here: it compares words, which the grouping already does.

**Calibrate it once on the real model** (it calls the embedding API; the assistant did not run it, credentials):

```bash
uv run ctx patterns --check-meaning
```

It scores the 13 labelled pairs of [data/eval/pattern_pairs.json](../data/eval/pattern_pairs.json):
- 6 "same problem": two real-LLM wordings, and four hand-written paraphrases with no shared words;
- 6 dangerous look-alikes: same place, no guard to stop them, so only meaning decides. For example, the evening traffic drop vs the SFP forwarding state, both with "UP + counters 0".

The command prints each similarity, says whether a threshold separates the two sets, and suggests a value for `PATTERNS_SAME_MEANING` in `.env`. If nothing separates them on that model, keep `PATTERNS_SAME_MEANING` above the highest look-alike, so meaning can only add groupings the look-alikes never reach.

**Result on `gemini-embedding-001` (run by maybe-e, 2026-11-07):** the model separates the two sets.

| Pairs | Similarity |
| --- | --- |
| Same problem: real-LLM rewordings | 0.957, 0.887 |
| Same problem: paraphrases with no shared words | 0.846, 0.807, 0.803, 0.802 |
| Look-alikes that reach the meaning check | 0.691, 0.671, 0.669, 0.666 |
| Look-alikes the place rule stops before meaning (shown, not counted): RAD-176 vs RAD-198 (same model only), TRN-305 VLAN vs SFP (other place), TRN-305 vs TRN-229 (same model only) | 0.823, 0.760, 0.643 |

- At the old 0.85: no wrong merge, but all 4 paraphrases were missed, so meaning added nothing over words.
- At **0.78** (the default now): every counted pair is right. That is 0.02 below the lowest paraphrase and 0.09 above the highest look-alike that reaches the meaning check.
- On the seed history with your cached vectors (Oct 7 and Oct 31), the patterns are identical to words only: no repeat in the seed is told with different words, so meaning adds nothing there and takes nothing wrong in.
- The gap is narrow and the set is small: rerun the check when you add pairs or change model.

## How to use it

```bash
uv run ctx patterns --at 2026-10-07T08:00   # one evening: TRN-131 + TRN-229 on the watch list, TRN-117 hidden suspect
uv run ctx patterns --at 2026-10-31T12:00   # 3 insights: the linked pair (seen twice), breaker F3, firmware 4.2 not rolled out
uv run ctx patterns --at 2026-11-07T12:00   # the linked pair is resolved by Erkki's clock module fix
uv run ctx patterns --entity TRN-117 --json # only patterns involving an element
```

`ctx patterns` replays the labelled scenarios (the eval timeline plus [data/eval/patterns_timeline.json](../data/eval/patterns_timeline.json)) through the real pipeline and writes `out/patterns/report.md` and `patterns.json`. The extra timeline is a separate file, so `ctx eval` and its numbers do not change.

| Where | What |
| --- | --- |
| Workbench UI | **Patterns** page (Observe group): Insight / Watch / Resolved tabs, links to the elements and the source knowledge, a Markdown report download |
| REST | `GET /api/patterns?at=&entity_id=` (JSON), `GET /api/patterns/report.md?at=` |
| MCP | `get_patterns(entity_id, at)`: for agents, with the "not a rule" warning in its description |

In the workbench, run the `pattern-*` scenarios to see the patterns build up live. Set the sim clock forward between the two evenings, for example 2026-10-06 21:10, then 2026-10-20 21:05.

## Seed data

7 synthetic scenarios in `data/workbench/scenarios/pattern-*.json`, tagged `pattern`:

| Scenario | Role |
| --- | --- |
| `pattern-trn229-sync-loss-evening`, `pattern-trn131-traffic-drop-evening` | First evening: two teams, two channels, two topics; neither mentions TRN-117 |
| `pattern-trn229-sync-loss-again`, `pattern-trn131-traffic-drop-again` | Second evening, two weeks later: watch becomes insight |
| `pattern-trn117-clock-module` | Erkki finds and fixes the cause on TRN-117: the linked pattern resolves |
| `pattern-harbour-breaker-again`, `pattern-harbour-breaker-third` | Breaker F3 trips a 2nd and 3rd time; Liisa proposes a lasting fix that is not applied |

The eval history alone (26 scenarios) produces **no linked pattern**; a test checks this, so no link is invented on data that has none.

## Limits and next steps

- **Without** `EMBEDDING_MODEL`, grouping is word overlap: a repeat told with entirely different words *and* a different fix stays split (two smaller patterns, never a wrong merge).
- **With** it, the threshold is only as good as its calibration: 12 pairs is a small set. Add pairs from real Elisa conversations when there are some.
- Word grouping was tested on the recorded LLM run (`out/eval/extractions.json`) and on renamed topics (`test_repeats_survive_llm_topic_names`). The closest pair that is *not* grouped scores 0.67 on symptom checks, which is why checks must be identical.
- The guards need symptom checks. Two items with no checks at all are only kept apart by place and meaning.
- The occurrence time is the start of the source thread. In the workbench, a store loaded without its threads falls back to the assertion's date.
- Fixes are classified by keywords (reboot vs replace, ignoring "before replacing"). It is simple and visible; an LLM could do better, but it must not invent causes.
- Hypotheses are template sentences built from facts in the graph, not LLM text. An optional LLM summary could rephrase them, as long as it may only use the cited facts.
- Topology "neighbour" is not the same as "depends on". With real data, the link direction (upstream or downstream) and the timing source would sharpen the dependency factor.
