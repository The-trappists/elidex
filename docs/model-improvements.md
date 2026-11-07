# Model and eval improvements (suggestions)

> **Status: proposal.** Nothing here is decided. It records one real comparison run and the improvements it suggests. Log a choice in [decisions.md](decisions.md) before treating any of it as settled.

## The run (2026-11-07)

`scripts/eval_models.py --run` on the 22 scenarios that have `expected` items (24 expected items), extractor only (no critic, no judge), one run per candidate, one call per scenario, all in `json_object` mode. The script does **not** send `reasoning_effort`, unlike the app. See [evaluation.md](evaluation.md) for how the metric works.

| Candidate | Matched | Found, scope or action differs | Missed | Unexpected | Link precision / recall | Avg latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Gemini `gemini-3.8-flash` | 3 | 13 | 8 | 11 | 0.45 / 0.60 | 14.8 s |
| Mistral `mistral-large-latest` | 4 | 10 | 10 | 22 | 0.45 / 0.64 | 4.8 s |
| Mistral `mistral-medium-latest` | 1 | 10 | 13 | 41 | 0.29 / 0.57 | 3.3 s |

Per row, matched + differs + missed = 24. "Found" (matched + differs) is 16 for Gemini, 14 for Large and 11 for Medium. Medium also returned 2 outputs that did not validate against the schema (an invalid `type`, and a value that should have been a list). An earlier run had every Gemini call fail with a 400 because of a wrong key in the environment variable; that was a setup error, not a model result.

### What this does and does not show

- Gemini and Large are close; the gaps are 1 or 2 items on a small set with a single run each, so it is **not a ranking**.
- Medium is clearly behind (precision 0.29, 41 unexpected items). The team uses Large for the critic and for the extractor fallback.
- The latency of Gemini is probably inflated by the missing `reasoning_effort`; `ctx llm-check` measured about 4 to 6 s with the app's settings. Not yet measured inside the app.
- Several "differs" are not real errors: the barrier-key, the flooded-road and Elisa's chat actions are paraphrased or longer, and the token similarity falls below the 0.5 threshold. The metric is stricter than reality.
- Some are real: Gemini kept `class:transmission_node` for Elisa's chat and dropped the "installed up to 2019" range (the linker refuses a bare type, so the rule would not reach other old units). On `ambiguous-old-radio-sodankyla`, both Gemini and Large added a class and a site where the expected answer is the instance alone (over-linking risk).
- The run does not include the critic or the judge, so it says nothing about what they fix.

## Suggestions

Effort and impact are our judgment, not measurements. "Where" points at the code or data to touch.

### Measure better

| # | Suggestion | Effort | Why | Where |
| --- | --- | --- | --- | --- |
| 1 | Judge action equivalence with a model (or a lower, calibrated threshold) instead of token overlap, and report "found" (matched + differs) next to "matched" | ~1-2 h | Stops counting paraphrases as errors; the headline number becomes closer to reality | `src/context_layer/evaluation.py` |
| 2 | Add a mode that runs the critic after extraction and reports before and after | ~2 h | The critic exists to fix over-linking; today nothing measures it | `scripts/eval_models.py`, `critic.py` |
| 3 | Repeat each candidate 3 times and report the spread | ~30 min plus credits | One run cannot tell a 1-item gap from noise (extraction already uses `temperature=0`, so remaining variation comes from the provider) | `scripts/eval_models.py` |
| 4 | Make the script usable: a progress line per scenario, keep the error body, a `reasoning_effort` field per candidate, write results incrementally | ~1 h | A silent script that writes only at the end lost its error cause and hides long waits | `scripts/eval_models.py` |
| 5 | Build a small labelled set for the critic and the judge (over-wide scope, unsupported action, true supersede, true conflict) | ~2-3 h | Critic and judge quality is unmeasured; thresholds are guesses | `data/workbench/scenarios/`, new eval |
| 6 | More scenarios with `expected` items (22 of 25 today) and real-looking noise | ongoing | A small set hides failure modes | `data/workbench/scenarios/` |

### Improve the extraction

| # | Suggestion | Effort | Trade-off | Where |
| --- | --- | --- | --- | --- |
| 7 | Few-shot examples for "older units" to year ranges (for example "old", "around 2019" to `install_year_max`) | ~30 min | Fixes the dropped range; may push the extractor to invent a range, so re-check the ambiguous scenarios | `understand.py` prompt |
| 8 | Ask for fewer, better items: one item per distinct advice, no restating, `evidence_quote` required | ~30 min | Cuts unexpected items (Large 22, Medium 41); may miss real secondary knowledge | `understand.py` prompt |
| 9 | Vague scope word with a named instance: bind the instance only (proposal already in [plan.md](plan.md)) versus keep the class with the qualifier note (current behaviour, confidence x0.8) | ~20 min | Precision versus reach: the advice no longer reaches other old units until someone states years | `link.py`, `understand.py` |
| 10 | Use `json_schema` mode for providers that support it (Mistral passed it in `llm-check`) and retry once with the validation error when the output does not parse | ~1 h | Stricter output, a few more tokens; removes the invalid-schema outputs seen on Medium | `llm.py`, `understand.py` |
| 11 | Raise `MIN_CONFIDENCE` or calibrate it per model | ~30 min | Fewer unexpected items versus lost knowledge; needs the eval from items 1 and 3 first | `config.py` |

### Choose and combine models

| # | Suggestion | Effort | Trade-off |
| --- | --- | --- | --- |
| 12 | Keep Gemini as the extractor, Large as the critic and fallback; do not use Medium | none | Settled by the run above for Medium only; Gemini versus Large is open |
| 13 | Compare Gemini with `reasoning_effort` low, minimal and unset (item 4 first) | ~30 min | Latency versus quality; the app already sets low |
| 14 | When the fallback is active, extractor and critic are the same model; use a different family for the critic fallback (an earlier research note lists a free Groq tier, limits unverified) | ~1 h | More providers to maintain, different JSON behaviour |
| 15 | Run two extractors and keep only the items they agree on, flag the rest | ~3-4 h | Higher precision, double the calls and latency; probably not worth it before the critic is measured |
| 16 | A cheap triage model that drops threads with no knowledge before extraction | ~2 h | Fewer calls on noisy channels; one more model that can drop real knowledge |

## Suggested order

1. Items 4 and 1 (usable script, fairer metric), then item 3.
2. Items 7 and 8 (prompt changes), re-run, compare.
3. Item 2 and item 5 to measure the critic and the judge, then adjust thresholds.
4. Items 10 and 13 if the format errors or the latency still matter.

Items 15 and 16 only if the earlier steps leave a precision problem.
