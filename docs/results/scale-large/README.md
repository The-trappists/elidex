# Retrieval accuracy results: `large` dataset, test wording (2026-11-08)

Saved output of `ctx dataset eval out/dataset/large --split test` (seed 42, 3,000,000 threads, 9,300 agent cases), so the numbers can be read without re-running. Method, discussion and limits: [Part 3 of evaluation.md](../../evaluation.md#part-3-retrieval-accuracy-at-company-scale).

| File | What it is |
| --- | --- |
| `report.md`, `report.json` | Final run, with the store and lifecycle fixes and problem relevance (the numbers quoted in evaluation.md) |
| `report-before-fixes.md`, `report-before-fixes.json` | Same run before the `store.py` and `lifecycle.py` fixes (the "Before" column of the lifecycle table) |
| `dashboard/` | Source and datasets of the results dashboard (see below) |

## Headline (test wording, 9,300 cases)

| Pipeline | Accuracy | Solution found | Rules per case p95 |
| --- | --- | --- | --- |
| Naive RAG over raw chats (BM25, top 5) | 0.3% | 66.6% | 5 |
| RAG over extracted knowledge, no graph | 1.7% | 49.6% | 5 |
| Graph scope + time + conditions (today) | 48.3% | 100% | 42 |
| + problem relevance, default | 80.3% | 100% | 10 |
| + problem relevance, strict | 89.0% | 100% | 6 |

## Dashboard

Live page (claude.ai, private to its owner until shared from claude.ai): https://claude.ai/artifact/QoXW2U4GzjD7ysgfwPZ6M6

`dashboard/index.html` is built on the claude.ai Dashboard artifact type (it calls `dash.draw` and uses the type's CSS variables), so it does not render when opened as a plain file. The `*.json` files are its datasets, taken from `report.json` and `report-before-fixes.json`.
