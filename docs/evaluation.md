# Evaluation: how accurate is it?

> **Status: proposal** (branch `accuracy`). The labels are ours: see [data/eval/README.md](../data/eval/README.md).

`ctx eval` answers two questions and writes `out/eval/report-<extractor>.md` and `.json`.

```bash
uv run ctx eval                      # offline: labels used as a perfect extractor
uv run ctx eval --extractor llm      # the real LLM extractor (needs LLM_* in .env); answers cached
uv run ctx eval --extractor cache    # re-score the last LLM run offline
```

The knowledge base is rebuilt from the 23 labelled workbench scenarios in time order, through the real pipeline (extract → link → store → lifecycle). Retrieval uses the demo agent's own code (`agent.run_agent`).

## 1. Retrieval: when a problem happens, do we get the right solution?

22 labelled cases (`data/eval/retrieval_cases.json`): a problem on an element at a time, with observations. 14 have a right answer, 8 are traps where the right answer is nothing.

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
| plain | 68% | 100% | 67% | 9 |
| with conditions | 100% | 100% | 100% | 0 |

Plain retrieval always finds the solution but adds useless knowledge in 7 of 22 cases. For example, it returns the old-unit SFP rule when counters are moving, or the TX-5000 power-dip advice for an SFP problem. Condition checks remove all of it. With labels as the extractor, extraction scores are 100% by construction, so **the real extractor has not been measured yet**: run `--extractor llm`.

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

With **every** observation, condition checks give 100%. A real agent often has only some. Example: on TRN-117 it knows "SFP swapped, interface UP" but not the counters. The SFP rule's counter check cannot run, so the rule stays in, and it may be noise (if counters are moving, it is). `ctx eval` reruns every case with **every subset** of its observations (325 runs, all combinations, no random sampling):

| Observations missing | 0 | 1 | 2 | 3 | 5 |
| --- | --- | --- | --- | --- | --- |
| Accuracy | 100% | 90% | 78% | 66% | 43% |
| Solution lost | 0 | 0 | 0 | 0 | 0 |

The right answer never goes missing, but noise comes back.

### What we tried and rejected

- **Weights** (rank by trust, by specificity, by LLM confidence): all the ranking signal sits in 3 cases, and fixed priorities are biased. On TRN-305 after a power dip, "verified" and "unit-specific" both put the VLAN rule above the right answer (a class-wide hunch). LLM confidence ranked worst of all (not calibrated).
- **Strict drop** (remove any rule that could not be fully checked): it lost the right answer in 31–48% of runs. Dropping is worse than showing noise.

### The solution: tell the agent how far each rule was checked

Each kept rule gets a **check status**, a fact about the case, not a weight. Nothing is dropped or reordered:

| Check status | Meaning | Example | What the agent does | Precision |
| --- | --- | --- | --- | --- |
| `fully checked` | every check ran and passed | TRN-131: swapped, UP, normal optics, counters 0 → SFP rule 4/4 | act on it | **100%** (46 items) |
| `not fully checked` | some checks could not run; `to_read` lists the fields | same case without counters → "read first: traffic_counters" | read those fields, then act | 72% (all 140 noise items) |
| `text only` | no machine check (none, or in words only) | barrier key at Kemijärvi; "after a storm" | use it, judging the words | 100% (73 items) |
| `failed` | a check is false | counters 1250 → SFP rule removed | (not shown, listed as "not applied") | |

All the noise lands in `not fully checked`, and the agent can clear it itself by reading the missing field. No human step. Shown in `ctx agent --conditions`, sent to the LLM agent, and returned by the workbench agent API (`check_status`, `to_read`).

Caveat: "fully checked = 100%" is partly true by design (a rule whose checks all pass applies). The real risk is the LLM extractor writing a wrong check, so rerun with `--extractor llm`.

## Confidence: what the percentage is

The `confidence` shown in the workbench (e.g. "conf 85%") is **the LLM's own estimate** (0 to 1), written in each extracted item. Nothing computes it, and the prompt does not define it. In scripted and cached runs it is a number written by hand in the labels or the cache.

What the code does with it:
- the linker drops items below `MIN_CONFIDENCE` (0.5, `.env`);
- when the same knowledge arrives from chat and email, the stored assertion keeps the higher value;
- retrieval and the agent do **not** use it to rank or filter.

It is not calibrated: 85% does not mean "right 85% of the time". `ctx eval --extractor llm` reports the average confidence of right vs. invented items, which shows whether it carries any signal.

## Limits

- Labels written by people who know the system; small set (22 cases, 23 conversations).
- Conditions only help when the agent has the observations; with none, plain retrieval applies.
- No ranking, on purpose (see section 3): the agent gets a set plus a check status per rule.
