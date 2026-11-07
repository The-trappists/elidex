# Evaluation and model comparison

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
