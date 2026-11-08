# Retrieval accuracy at company scale (test wording, 2026-11-08T01:19:50)

Dataset `out\dataset\large`: 3,000,000 threads scanned, 3,347 carry knowledge (0.11%). Knowledge base: 1,879 assertions, 26 classes, built in 15.3 s through the real linker, store and lifecycle (ground truth as the extractor). Problem-match threshold 0.4 (chosen on the dev wording). Total run 367.9 s.

## Retrieval: 9,300 cases

| Pipeline | Cases | Accuracy | Solution found | Correct silence | Precision | Items per case (p50 / p95) | Other problem | Stale | Wrong scope | Haystack | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| naive RAG over raw chats (BM25, top 5) | 2,000 | **0.3%** | 66.6% | 0.1% | 11.1% | 5 / 5 | 69 | 119 | 6,548 | 2,152 | 3.78 / 6.22 ms |
| RAG over extracted knowledge, no graph (top 5) | 9,300 | **1.7%** | 49.6% | 3.5% | 8.1% | 5 / 5 | 486 | 0 | 41,345 | 0 | 3.89 / 7.18 ms |
| graph scope + time (today, plain) | 9,300 | **48.3%** | 100.0% | 74.2% | 10.0% | 2 / 46 | 111,935 | 0 | 0 | 0 | 0.34 / 11.34 ms |
| + condition checks (today, with conditions) | 9,300 | **48.3%** | 100.0% | 74.2% | 10.8% | 2 / 42 | 102,330 | 0 | 0 | 0 | 0.44 / 12.28 ms |
| + problem relevance, all rules when none matches (new, default) | 9,300 | **80.3%** | 100.0% | 74.5% | 44.8% | 1 / 10 | 14,675 | 0 | 0 | 0 | 0.49 / 12.19 ms |
| + problem relevance, strict (new) | 9,300 | **89.0%** | 100.0% | 92.9% | 73.0% | 1 / 6 | 4,326 | 0 | 0 | 0 | 0.48 / 11.71 ms |

Same pipelines on the 2,000 cases of the naive-RAG sample (like with like):

| Pipeline | Accuracy | Solution found | Precision | Stale | Wrong scope |
| --- | --- | --- | --- | --- | --- |
| naive RAG over raw chats (BM25, top 5) | 0.3% | 66.6% | 11.1% | 119 | 6,548 |
| RAG over extracted knowledge, no graph (top 5) | 2.1% | 51.9% | 8.6% | 0 | 8,790 |
| graph scope + time (today, plain) | 48.2% | 100.0% | 9.8% | 0 | 0 |
| + condition checks (today, with conditions) | 48.3% | 100.0% | 10.7% | 0 | 0 |
| + problem relevance, all rules when none matches (new, default) | 80.1% | 100.0% | 46.1% | 0 | 0 |
| + problem relevance, strict (new) | 88.7% | 100.0% | 72.5% | 0 | 0 |

Accuracy by kind of case:

| Kind | Cases | Graph + time + conditions (today) | Relevance, default | Relevance, strict | Solution found (strict) |
| --- | --- | --- | --- | --- | --- |
| after closure | 302 | 11.9% | 80.1% | 80.1% | 100.0% |
| before it was said | 2,698 | 45.7% | 74.7% | 87.5% | 100.0% |
| dispatch to the site | 543 | 69.6% | 100.0% | 100.0% | 100.0% |
| near miss, same model | 986 | 7.6% | 68.6% | 90.6% | 100.0% |
| other unit, same site | 1,116 | 79.8% | 79.9% | 93.1% | 100.0% |
| random element | 1,500 | 76.6% | 88.2% | 94.8% | 100.0% |
| same unit | 1,116 | 65.8% | 80.3% | 80.3% | 100.0% |
| similar case, same class | 1,039 | 0.0% | 84.8% | 84.8% | 100.0% |

Threshold sweep on the dev wording (3,000 cases):

| Threshold | Accuracy | Solution found | Precision |
| --- | --- | --- | --- |
| 0.3 | 80.3% | 100.0% | 54.6% |
| 0.35 | 80.6% | 100.0% | 63.0% |
| 0.4 | 85.6% | 100.0% | 72.5% |
| 0.45 | 88.5% | 96.8% | 81.6% |
| 0.5 | 89.2% | 96.8% | 82.8% |
| 0.55 | 89.2% | 96.8% | 82.8% |
| 0.6 | 92.9% | 96.8% | 89.2% |
| 0.7 | 92.9% | 96.8% | 88.7% |

## Linking (right entities)

3,000 of 3,000 facts linked, 0 abstained. Reach exact: **100.0%**; element precision 100.0%, recall 100.0%; over-reach 0 facts, under-reach 0.

| Kind | Facts | Reach exact |
| --- | --- | --- |
| class | 1,295 | 100.0% |
| instance | 1,116 | 100.0% |
| site | 589 | 100.0% |

## Lifecycle (right time, right trust)

| Measure | Expected | Found | Wrong |
| --- | --- | --- | --- |
| Closures per ground-truth fact (firmware fix, key moved) | 302 | 69 (22.9%) | 90 closed that should stay open |
| Closures per assertion (repeated reports merged, closed at the first fix) | 76 | 69 | 0 closed that should stay open; 0 closed by a release not newer than their firmware |
| Expert disagreements flagged | 188 | 188 (100.0%) | 1 false pairs |
| Hunch later verified: one assertion | 285 | 285 | 0 split in two |
| Hunch later verified: trust is verified | 285 | 285 | |
