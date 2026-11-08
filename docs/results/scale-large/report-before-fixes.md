# Retrieval accuracy at company scale (test wording, 2026-11-08T00:59:50)

Dataset `out\dataset\large`: 3,000,000 threads scanned, 3,347 carry knowledge (0.11%). Knowledge base: 2,950 assertions, 26 classes, built in 24.2 s through the real linker, store and lifecycle (ground truth as the extractor). Problem-match threshold 0.4 (chosen on the dev wording). Total run 353.1 s.

## Retrieval: 9,300 cases

| Pipeline | Cases | Accuracy | Solution found | Correct silence | Precision | Items per case (p50 / p95) | Other problem | Stale | Wrong scope | Haystack | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| naive RAG over raw chats (BM25, top 5) | 2,000 | **0.3%** | 66.2% | 0.1% | 10.8% | 5 / 5 | 72 | 90 | 6,593 | 2,162 | 3.13 / 4.81 ms |
| RAG over extracted knowledge, no graph (top 5) | 9,300 | **2.9%** | 43.2% | 3.5% | 9.5% | 5 / 5 | 304 | 115 | 40,782 | 0 | 5.6 / 9.6 ms |
| graph scope + time (today, plain) | 9,300 | **48.3%** | 100.0% | 74.2% | 8.1% | 4 / 293 | 521,322 | 31,995 | 0 | 0 | 0.39 / 12.46 ms |
| + condition checks (today, with conditions) | 9,300 | **48.3%** | 100.0% | 74.2% | 8.8% | 3 / 266 | 469,728 | 31,995 | 0 | 0 | 0.46 / 12.31 ms |
| + problem relevance (new) | 9,300 | **84.5%** | 99.6% | 95.3% | 71.4% | 1 / 36 | 17,115 | 2,073 | 0 | 0 | 0.57 / 14.37 ms |

Same pipelines on the 2,000 cases of the naive-RAG sample (like with like):

| Pipeline | Accuracy | Solution found | Precision | Stale | Wrong scope |
| --- | --- | --- | --- | --- | --- |
| naive RAG over raw chats (BM25, top 5) | 0.3% | 66.2% | 10.8% | 90 | 6,593 |
| RAG over extracted knowledge, no graph (top 5) | 3.5% | 46.2% | 10.3% | 27 | 8,632 |
| graph scope + time (today, plain) | 48.2% | 100.0% | 8.0% | 6,986 | 0 |
| + condition checks (today, with conditions) | 48.3% | 100.0% | 8.8% | 6,986 | 0 |
| + problem relevance (new) | 84.9% | 99.8% | 71.9% | 460 | 0 |

By kind of case (+ problem relevance (new) vs graph + time):

| Kind | Cases | Accuracy (graph + time) | Accuracy (new) | Solution found (new) | Precision (new) |
| --- | --- | --- | --- | --- | --- |
| after closure | 302 | 11.9% | 35.4% | 99.3% | 56.6% |
| before it was said | 2,698 | 45.7% | 87.1% | 99.9% | 74.2% |
| dispatch to the site | 543 | 69.6% | 96.9% | 96.9% | 100.0% |
| near miss, same model | 986 | 7.6% | 76.9% | 100.0% | 73.8% |
| other unit, same site | 1,116 | 79.8% | 93.5% | 100.0% | 1.9% |
| random element | 1,500 | 76.5% | 93.2% | 99.2% | 66.0% |
| same unit | 1,116 | 65.8% | 88.7% | 100.0% | 69.5% |
| similar case, same class | 1,039 | 0.0% | 66.0% | 100.0% | 75.1% |

Threshold sweep on the dev wording (3,000 cases):

| Threshold | Accuracy | Solution found | Precision |
| --- | --- | --- | --- |
| 0.3 | 77.2% | 99.3% | 46.2% |
| 0.4 | 84.5% | 99.3% | 73.2% |
| 0.5 | 83.5% | 96.1% | 74.4% |
| 0.6 | 83.8% | 91.5% | 78.5% |
| 0.7 | 82.0% | 83.5% | 83.2% |

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
| Closures (firmware fix, key moved) | 302 | 72 (23.8%) | 47 closed that should stay open |
| Expert disagreements flagged | 188 | 188 (100.0%) | 4 false pairs |
| Hunch later verified: one assertion | 285 | 72 | 213 split in two |
| Hunch later verified: trust is verified | 285 | 76 | |
