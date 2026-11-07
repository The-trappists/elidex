# Context Workbench

> Status: in progress on branch `feat/workbench`. Tool choices (React, Vultr, Slack) are proposals until they are logged in [decisions.md](decisions.md).

The Workbench is the team's real-time test bench. It is not the pitch demo. It lets us:
- watch fake employees talk, in an in-app chat or in a real Slack;
- see each conversation go through our pipeline (listen → understand → link → store → reconcile, with the loop v2 agents hooked in, see below);
- see the network graph with scripted incidents and the knowledge bound to it;
- add or remove generated data;
- read every LLM call afterwards.

```bash
uv run ctx workbench            # API + built UI on http://127.0.0.1:8010
cd web && npm run dev           # UI with hot reload on http://127.0.0.1:5173 (proxies /api)
uv run ctx llm-check            # which LLM provider / JSON mode works
```

## Scope guard

- **Incidents are scripted** ground truth from scenarios (the "as-observed" layer). The Workbench never detects or diagnoses faults, which is out of scope (see [challenge.md](challenge.md)). An incident only triggers a conversation and shows what the context layer knows about the element.
- Knowledge comes only from the messages. Nobody fills in a form.
- Slack stands in for Teams: it shows that the listen step works on the channels people already use.

## Loop v2 overview

The Workbench runs the loop v2 agents on top of the five pipeline steps. The loop is **fully automated**: knowledge goes live with no human review and nobody is asked for a click. The operator console is optional, for observation, debugging and manual override.

- A **critic** (a second model) checks each extracted item against its cited messages, inside the understand step (hook `after_understand`).
- A **judge** compares each new assertion with its neighbours after the store step (hook `after_store`); the lifecycle reconcile step still runs afterwards as a fallback.
- A **passive outcome loop** posts the demo agent's applied action in a thread and reads the technician's reply to update trust (`POST /api/agent/run`, hook `after_store`).
- The **operator console** ("Needs a look" page, assertion editor, item re-run with history and undo) shows what the loop did and why, and never blocks it.
- All three agents are toggles in Settings (`use_critic`, `use_judge`, `use_outcome_loop`, default on; critic and judge stay silent without an LLM key). `use_dedupe` (default on) folds near-duplicate assertions in the store step.

Read more: [plan-loop-v2.md](plan-loop-v2.md) (what was built, known weaknesses), [design.md](design.md) (pipeline and fields), [evaluation.md](evaluation.md) (metric and model comparison), [demo-loop-v2.md](demo-loop-v2.md) (2m30 demo script), and the endpoint tables below.

## Architecture

```
web/ (React + Vite + TS + Tailwind + canvas force graphs)
   │  GET /api/state (snapshot) then GET /api/stream (SSE events)
src/context_layer/workbench/
   app.py ─ routes.py ─ Workbench (state.py) ─ EventBus (bus.py) ─► SSE
                          │            │
           simulator.py ──┘            └─ processor.py ─► core: understand, link.Linker,
           clock.py, generator.py, seed.py                   store.ContextStore, mvp.lifecycle,
           slack_bridge.py ◄─► Slack (Socket Mode)           agent.run_agent, mvp.guard
   persistence ─► out/workbench/state.json, llm_calls.jsonl, llm_cache.json
```

The app is one process with one asyncio loop. State changes only on the loop thread. Blocking work (LLM calls) runs in `asyncio.to_thread`, and results come back to the loop with `bus.publish_threadsafe` / `loop.call_soon_threadsafe`.

## Contract

| What | Where |
| --- | --- |
| Python models | `src/context_layer/workbench/contracts.py` (plus core `models.py`) |
| TypeScript mirror | `web/src/api/types.ts` |
| API client | `web/src/api/client.ts` |
| Facade used by the simulator and Slack | `src/context_layer/workbench/state.py` (signatures) |
| Seed / simulator / generator / Slack interfaces | `seed.py`, `simulator.py`, `generator.py`, `slack_bridge.py` |

Core contract change: `models.SourceKind` now includes `"slack"`.

### REST API (`/api`)

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /state` | | `StateSnapshot` |
| `GET /stream` | | SSE: `data: <WbEvent JSON>\n\n` per event, `: keepalive` comment every 15 s |
| `POST /sim/start`, `/sim/pause` | | `ClockState` |
| `POST /sim/speed` | `SpeedBody` | `ClockState` |
| `POST /sim/clock` | `ClockBody` | `ClockState` |
| `GET /sim/scenarios` | | `Scenario[]` |
| `POST /sim/scenarios` | `Scenario` (upsert by id) | `Scenario` |
| `DELETE /sim/scenarios/{id}` | | 204 |
| `POST /sim/scenarios/{id}/run` | | `ScenarioRun` |
| `POST /sim/generate` | `GenerateBody` | `Scenario` (stored, origin `generated`); 503 if no LLM, 422 if the output is invalid |
| `POST /elements`, `PUT /elements/{id}`, `DELETE /elements/{id}` | `WbElement` | `WbElement` / 204 |
| same for `/sites` (`WbSite`), `/links` (`TopologyLink`), `/personas` (`Persona`) | | |

`PUT` on these collections replaces the whole object: fields omitted from the body are reset to their default (usually `null`), not kept. Send the full object (`id` and `origin` are kept from the stored one). `POST` and `PUT` answer 422 when an element's `site_id` is not a known site, or when a link's `a` or `b` is not a known element (the element `type` stays free text). Only the HTTP layer checks; the seed and the Slack bridge write directly.
| `POST /threads` | `NewThreadBody` | `LiveThread` (origin `manual`) |
| `POST /threads/{id}/messages` | `PostMessageBody` | `Message` |
| `POST /threads/{id}/process` | | 202, job runs now |
| `DELETE /threads/{id}` | | 204; also removes the sources it gave to assertions |
| `POST /incidents` | `IncidentSpec` | `Incident` (origin `manual`) |
| `POST /incidents/{id}/resolve` | | `Incident` |
| `DELETE /incidents/{id}` | | 204 |
| `GET /context/{entity}?at=&include_expired=` | | `[{matched_via, ...ContextAssertion}]`; `at` defaults to sim now |
| `GET /graph?at=` | | `{at, elements}`: the whole knowledge graph as Cytoscape elements; assertions carry `valid` at `at` (default sim now). Used by the Graph page |
| `GET /graph/provenance/{assertion_id}` | | Source messages of an assertion, verbatim (see [knowledge-graph.md](knowledge-graph.md)) |
| `GET /graph/reach/{assertion_id}` | | `{elements: {id: via}, sites}`: what a rule reaches (over-linking check) |
| `GET /graph/experts?entity_id=&at=` | | People who stated knowledge about the entity, most verified first |
| `GET /graph/timeline/{entity}?at=` | | Every advice that covered the entity, with status at `at`, closing and conflicts |
| `GET /graph/mentions/{entity}`, `/graph/stats` | | Raw messages naming the entity; node and edge counts |

The `/graph/*` views are rebuilt on each call from the live store and live threads. The Network page Inspector shows them: "Where it comes from" and "What it reaches" on knowledge, "History of advice" and "Who to ask" on an element.
| `GET /patterns?at=&entity_id=` | | `{at, meaning, patterns: Pattern[]}`: recurring and linked problems with hypotheses, at `at` (default sim now); `meaning` says whether topics were also compared with the embedding model. Never used as rules (see [patterns.md](patterns.md)) |
| `GET /patterns/report.md?at=` | | The same as a Markdown report (attachment) |
| `DELETE /assertions/{id}` | | 204 |
| `PATCH /assertions/{id}` | `OperatorEdit` | `{assertion, edit: AssertionEdit}`. Adds source `operator`; `stated_by` becomes `operator` only when `trust_level` is edited; an explicit `valid_to: null` reopens; 404 unknown, 422 nothing to change. Survives re-processing of the thread |
| `GET /assertions/{id}/history` | | `AssertionEdit[]`, newest first |
| `POST /assertions/{id}/undo` | | `{assertion, edit}`: restores the `before` of the latest edit not undone (409 when none) |
| `GET /review/flags?dismissed=&kind=&thread_id=` | | `ReviewFlag[]`, newest first. Flags are informational, nothing waits for them. Rules in `workbench/review.py`: abstained, low_confidence (below 0.7), conflict, over_reach (6 or more reached elements the thread never names), plus the flags other hooks put in `job.flags` |
| `POST /review/flags/{id}/dismiss`, `/undismiss` | | `ReviewFlag` |
| `POST /jobs/{job_id}/rerun` | `RerunBody` | 202 and the new finished `PipelineJob`. Skips the extractor: uses `items`, else the job's own items. `from_stage="store"` behaves as `link`. `model` is not supported yet (422) |
| `POST /guard` | `GuardBody` | `{decision, action, steps, reasons}` |
| `POST /agent/run` | `AgentRunBody` | `AgentRunResult`. With `use_outcome_loop` on and knowledge applied, it also posts the ops agent message and returns the optional `thread_id` and `applications` |
| `GET /applications?assertion_id=&thread_id=&outcome=` | | `RuleApplication[]`, newest first (outcome loop) |
| `POST /agent/outcome` | `OutcomeBody` | `{recorded, track_record, line}`: did the knowledge work when applied? Field feedback judged from the agent's own observations (see `docs/evaluation.md` §4). Same ledger and same effects as the outcome loop below; it also resolves a pending `RuleApplication` of the same assertion and entity (`method: "observation"`). `track_record` is `{status, worked, failed, failed_on, thread, last_at}`, the same shape as in `/agent/run` hits |
| `GET /company` | | `CompanyState` (status, clock, timeline, last 60 cycles, last 200 agent calls, health of every element that left healthy) |
| `POST /company/start` | `CompanyStartBody` (`speed=120`, `day_minutes=480` (0 = endless), `cycle_minutes=10`, `reset="empty"\|"keep"`, `clear_archive=true` (only with `reset="empty"`: also empties the cold archive), `use_llm=false`) | `CompanyState`; 409 when a day is running or paused |
| `POST /company/pause`, `/company/resume`, `/company/stop` | | `CompanyState`. They also pause or start the sim clock; stop returns to `idle` and keeps the data |
| `GET /company/archive/stats` | | `{backend: files\|atlas\|tiger-sink (joined with +), counts: {threads, incidents, jobs, metrics}, queued, dropped, atlas, tiger}` |
| `POST /company/archive/clear` | | Empties the cold archive: `{files_removed, atlas: {wb_threads: n, wb_incidents: n, wb_jobs: n} \| "off" \| "failed: <ExceptionClass>", tiger: "truncated" \| "off" \| "failed: <ExceptionClass>"}`; 409 when a day is running or paused |
| `GET /company/archive/threads/{id}` | | an archived thread with all its messages; 404 when unknown |
| `GET /company/package?cycle=N` | | Full knowledge handed over at that sync: `{package, assertions, classes, class_members, bindings, sources, counts}` (valid assertions at the cycle time). Default: latest. 404 unknown cycle |
| `GET /company/export?format=json\|markdown&valid_only=true` | | The knowledge graph as a download (attachment): assertions, classes, element bindings, sources (JSON) or a readable report (Markdown). Logic in `company.export_package` / `render_markdown`, reusable by any page |
| `POST /data/reset` | `ResetBody` | 204, then emits `state.reset` |
| `DELETE /data/generated` | | `{removed: {kind: count}}`, then emits `state.reset` |
| `GET /data/export` | | the full state JSON (attachment) |
| `POST /data/import` | the export JSON | 204, then emits `state.reset`. 422 when an element's `site_id` or a link's end is unknown (same rules as `POST /elements` and `/links`). The optional key `process_on_import` (thread ids) is processed right away, as the seed is at first start |
| `POST /data/load-dataset` | `{sites=40 (9-80), threads=300 (0-1000), seed=42}` | the sample summary (counts, `connected_components`). Builds a connected sample of the company dataset on the fly (`DATASET_DIR`, else `out/dataset/tiny`, generated in 2 s when missing) and replaces the state like an import. 422 for a dataset over 500k threads (use the CLI); the Data page button "Load company dataset" calls it |
| `GET /settings`, `PUT /settings` | `SettingsPatch` | `Settings` |
| `GET /assertions/{id}/justification` | | `Justification` (404 unknown): why the assertion has its trust level and confidence, factor by factor. See "Knowledge polish" below |
| `GET /knowledge/dedupe` | | `DedupeReport`: `enabled`, `merged_total`, last 50 merges (newest first), `threshold` |
| `POST /knowledge/dedupe/run` | | `DedupeReport`; folds the near-duplicates of the whole store now (works with the setting off) and emits `assertion.upserted` / `assertion.deleted` |
| `GET /slack/status` | | `{connected, channel, error}` |
| `GET /llm/calls?purpose=&thread_id=&limit=` | | `LlmCall[]`, newest first, read from the JSONL |
| `GET /llm/calls/{id}` | | `LlmCall` |
| `POST /llm/check` | | `LlmCheckResult[]` (same as `ctx llm-check`) |
| `GET /export/llm-calls.jsonl` | | file |
| `GET /export/transcript.md?thread_id=` | | Markdown transcript (one thread, or all) |
| `GET /export/session.json` | | snapshot plus all jobs plus all LLM calls |

Errors use FastAPI's `{"detail": "..."}` with 4xx/5xx codes, so the UI can show `detail` in a toast.

### Passive outcome loop (`src/context_layer/outcome.py`, toggle `use_outcome_loop`)

The loop closes itself and nobody is asked for anything.

1. `POST /agent/run` applies knowledge to a case. When the toggle is on and at least one assertion was applied (conditions not failed), the ops agent (persona `ops-agent`) posts **one informational message** ("Applied ctx_0001 on TRN-117: ... Avoid: ...") into the thread of the entity's newest incident, or into a new `manual` thread named after the case. It never asks anyone to reply, confirm or rate. One `RuleApplication` (outcome `pending`) is created per assertion the recommendation cites (`cited_assertion_ids`: the LLM's citations, or the rule the template picked), not per retrieved hit, so a "fixed" reply never verifies noise; event `application.upserted`.
2. The thread's next job, in the `after_store` hook, looks at the human messages after the agent message (the ops agent's own items are ignored by an `after_understand` hook). One LLM call (critic role, purpose `judge`) returns `worked`, `failed` or `unclear` with a verbatim quote. Without an LLM, or when the call fails, a keyword heuristic decides (`method: "heuristic"`).
3. The verdict is recorded in the one ledger `Assertion.outcomes` (`source: "thread"`, `application_id`, `quote`) and settled by `outcome.settle`, the same rule as `POST /agent/outcome`. `worked` with no failure in the ledger: trust becomes `verified` (the human is added to `confirmed_by`, `stated_by` keeps the rule's author, evidence = quote), the thread message is added as a source, and a `judge_decision` flag says "Confirmed in the field". `worked` with a failure in the ledger: trust is not upgraded, a flag says "Mixed evidence". `failed`: confidence x0.7 and a `low_confidence` flag, and it counts in `track_record` (it can make the rule contested). One application is recorded once, so reprocessing never double counts; an observation outcome for the same assertion and entity resolves the pending application first. `unclear`: nothing changes, the application stays pending. An application is decided once; a thread without a pending application costs no LLM call. A failure is noted in `job.notes` and never blocks the job.

Demo: scenario `agent-outcome-followup` supplies the technician follow-up.

### Processing rules (processor.py)

1. Every `post_message` (re)starts an idle timer for its thread (`settings.idle_seconds`, in wall seconds). `POST /threads/{id}/process` skips the timer. Only one job runs per thread at a time; a new message during a job starts another job afterwards.
2. A job re-extracts the **whole** thread. Before storing:
   - it removes this thread's `SourceRef`s from every assertion;
   - it deletes assertions left with no source (`ContextStore.remove_assertion`);
   - it reopens any assertion it had closed earlier (`closed_by` == this thread's assertion).

   Re-processing is therefore idempotent.
3. Stages and what each one emits (a `pipeline.job` event on every change):
   - `listen`: thread loaded; detail "N messages".
   - `understand`: picks the extractor and runs it.
   - `link`: one `Linker.link` per item; its notes go to the job.
   - `store`: `add_class` and `add_assertion` (new or merged).
   - `reconcile`: `lifecycle.reconcile` when `settings.lifecycle` is on, otherwise `skipped`.
   Hooks (`processor.register_hook(name, fn)`, sync or async, `fn(HookContext)`): `after_understand` (may return a replacement item list), `after_store` (`ctx.new_assertions` filled), `after_reconcile`. A hook exception is noted in `job.notes` and never fails the job. The critic runs in `after_understand` (inside the understand step), the judge and the outcome loop in `after_store` (the judge runs before `lifecycle.reconcile`, which stays as a fallback), and nothing is registered on `after_reconcile` by the loop v2 agents; `STAGES` is still the five steps. Toggles: `use_critic`, `use_judge`, `use_outcome_loop` (default on; critic and judge stay silent without an LLM key).
4. Extractor choice (`settings.extractor_mode`):
   - `llm`: `LLMExtractor(cache_path=out/workbench/llm_cache.json)`; error if no key.
   - `scripted`:
     - the scenario's `expected` if the thread came from a scenario;
     - otherwise the core cache (`data/cache/extractions.json`) for seeded files;
     - otherwise nothing, with note "scripted mode: no ground truth for this thread".
   - `auto`: `llm` if a key is configured, else `scripted`.
5. Eval: when the extractor is the LLM and the thread has `expected`, items are compared on `(type, scope, action similarity)`, not on the topic slug (see [evaluation.md](evaluation.md)), and the result goes in `job.eval`. Same type and scope with a similar action is matched; the same scope with another action, or the same action with another scope, goes in `binding_diffs`.
6. Invalidation items are only applied when `settings.lifecycle` is on (as in `pipeline.build_store`).

### Knowledge polish: dedupe and justification

**Dedupe** (`workbench/dedupe.py`, setting `use_dedupe`, default on). In the store step a new assertion is folded into an older one when it is a near-duplicate. All of this must hold ("a wrong link is worse than none"): same type (never an invalidation); both valid (no `valid_to`) and not in conflict; same trigger and same `applies_to` (or the very same reach); same `avoid` list, same condition checks and same numbers ("5 minutes" never merges with "15"); neither text negates the other; and the advice text (action or fact, avoid, conditions) is at least `DEDUPE_THRESHOLD = 0.85` similar by (a) exact normalised text, (b) Jaccard on stemmed words, (c) embedding cosine when `EMBEDDING_MODEL` is set (vectors are cached and fetched off the event loop; any failure falls back to words). Items from the same job never merge with each other. On a merge the older assertion stays; the newer one's sources (deduplicated), confirmers and outcomes move into it, trust never goes down, confidence rises by 0.03 (cap 0.95) only when a person who had not backed it before joins, so re-processing a thread is idempotent. Each merge is a `DedupeMerge` (last 200, in memory and in the state file under `dedupe`); the job gets an event `dedupe: folded into ctx_xxxx`. Review flags (`low_confidence`, `conflict`, `over_reach`, `abstained`) stay quiet for an assertion this job folded a duplicate into when at least two people back it, and a `conflict` flag is raised once per pair of assertions across all threads.

**Justification** (`workbench/justify.py`): deterministic, built from what was recorded, never invented. Trust factors: level (hunch/stated/verified) with the author, their role and the evidence quote; confirmations or "single voice"; operator edits; outcome track record and the latest human field report; contradictions; closed or expired. Confidence factors: extractor confidence (from the creating job's items), critic verdict with its reason and `confidence_after`, linker notes (class wider than stated, x0.8; "not bound" notes), class vs named-equipment binding, independent sources (references, threads, people), judge verdicts with their reasons, failed outcomes (x0.7 each). When the job, critic or judge data is no longer in memory (jobs are capped at 200) the factor says "Not recorded" and is neutral.

### Data lifecycle

- On first start, the seed is loaded:
  - inventory, personas and scenarios;
  - the historical threads from `data/elisa` and `data/synthetic`, processed right away, so the knowledge base is not empty.
- The sim clock starts at `WORKBENCH_SIM_START` and runs at ×10.
- `POST /data/reset {"mode": "seed"}` restores that seed. `{"mode": "empty"}` keeps the inventory, personas and scenarios, and drops threads, incidents, assertions, jobs and runs: use it to watch knowledge being built from scratch.
- Scenario runs create threads and incidents with origin `generated`. Threads and incidents made by hand are `manual`, and threads from Slack are `slack`. "Remove generated data" deletes all three.

### LLM trace

`llm.complete_traced()` traces every attempt, including fallback attempts, as an `LlmCall` dict. The workbench registers:
- a sink that appends to `out/workbench/llm_calls.jsonl`;
- a sink that publishes `llm.call` (thread-safe).

`LLMExtractor.last_traces` gives the call ids to put in `job.llm_call_ids`. API keys are never traced.

`llm.FILE_LOCK` is shared by the JSONL sink and the compaction below.

### Knowledge export (`workbench/routes_export.py`)

`GET /api/knowledge/export?format=json|markdown|csv|graphml|jsonld&valid_only=true&at=` answers an attachment named `knowledge-<simdate>.<ext>` (`json`, `md`, `csv`, `graphml`, `jsonld`); 422 for another format. `GET /api/knowledge/export/formats` lists format, extension, media type and description. `valid_only` keeps the assertions valid at `at` (default sim now). It reuses `company.export_package` / `render_markdown`; `/company/export` is unchanged.

- `json`: `schema_version`, `valid_at`, counts, assertions, classes, class members, bindings, sources.
- `markdown`: the company report plus an index by element, site and class.
- `csv`: one row per assertion; list fields joined by ` | `; cells starting with `= + - @` get a leading `'` (formula-injection guard).
- `graphml`: the knowledge graph (nodes and edges, all attributes as strings, XML escaped); with `valid_only`, assertions not valid at `at` are left out.
- `jsonld`: `@context` plus `@graph`; stable ids `urn:ctx:assertion:<id>`, entities `urn:ctx:entity:<id>`.

### AI activity log compaction (`workbench/llm_compact.py`)

The log (`out/workbench/llm_calls.jsonl`) is compacted at startup and every 10 wall minutes, or at once with `POST /api/llm/compact`; `GET /api/llm/summary` reports `LlmSummary` (kept, per purpose, errors, oldest/newest, archived total, last run). Rules (wall time): keep every call of the last 2 h; keep errors and parse failures of the last 24 h; keep the newest call per (purpose, thread, model); older than 2 h, drop calls whose thread no longer exists and repeats of an identical request (system + user hash, newest stays); cap at 500. Removed lines (and unreadable ones) are appended to `out/workbench/archive/llm_calls.jsonl` first, then the live file is rewritten via temp file + rename while holding the lock the trace sink uses, so concurrent appends are not lost. `wb.llm_calls` drops the same ids. File work runs in `asyncio.to_thread`.

### Human activity from the sources (`workbench/sources.py`)

Read on demand for one element, never from the Workbench's own threads. Three endpoints, so one failing source never blocks the others. Every answer has `source` (`files`, `atlas`, `tiger`, `workbench`), `status` (`ok`, `not_configured`, `error`, `timeout`) and `detail`; when a cloud source fails and the files can answer, `source` is `files` and `fallback_from` says why. No endpoint raises: cloud calls run in a thread with short timeouts (4 s connect, 5 s query; 6 s overall), and a file scan is cut after 8 s.

| Method and path | Returns | Source |
| --- | --- | --- |
| `GET /sources` | what is configured (no network call) | config only |
| `GET /sources/elements/{id}/threads?limit=&offset=` | `{total, has_more, items[{id, subject, started_at, n_messages, authors, preview[3], in_workbench}]}`, newest first, limit 1-50 | Atlas `threads.mentions` index if `MONGODB_URI`, else a scan of the dataset files (cached per element) |
| `GET /sources/elements/{id}/freshness` | `{last_discussed, days_since, messages, active_days, by_month[{month, messages, people}]}`; `days_since` counts from the **simulated** now | Tiger `daily_mentions` + `activity` if `TIGER_DATABASE_URL`, else computed on the files, same shape |
| `GET /sources/similar?q=&entity=&limit=` | `{items[{id, topic, summary, score, trust}], mode}` | Atlas `$vectorSearch` (embeddings from `EMBEDDING_MODEL`) if `MONGODB_URI`; else, or when Atlas fails, an **offline** ranking of the Workbench's own assertions by hashed words (finds similar wording, not meaning) |

The files source is `DATASET_DIR` (default `out/dataset/demo`), else `out/dataset/tiny`; with none, the status is `not_configured` with the command to generate one. The existing core endpoints `GET /similar` and `GET /freshness/{id}` (api.py) stay as they were.

UI: the element panel of the Network page has a "Human activity" section (summary sentence, messages per month, expandable threads with a message preview and an "Open conversation" button for threads the Workbench holds, "Similar knowledge" with a free-text query). Each block has loading, empty, not-configured and error (with Retry) states.

### Company day (`workbench/company.py`)

The "big boss" scenario: one simulated working day of the whole company. `POST /company/start` (optionally resetting to an empty graph) sets the clock to 08:00 and plays `data/workbench/company/day.json` (list of `{id, at_min, kind, scenario_id, label}`, about 30 chats over 480 sim minutes, through `Simulator.start_scenario`; every `scenario_id` must exist, a test checks it). Finished chats go to the pipeline at once, so the knowledge graph grows during the day.

Every `cycle_minutes` of sim time (first one after `cycle_minutes`, last one at the end of the day) Elisa's autonomous system syncs:

1. it takes the **knowledge package** (assertions valid at that time; new and closed ids since the previous sync);
2. for every element with an open scripted incident (or short ones that opened and closed since the last sync) or a status other than healthy, it asks the context layer (`agent.run_agent`, template recommendation, LLM when `use_llm`; an LLM failure falls back to the template and is logged) and records an `AgentCall`. With `use_outcome_loop` on, applied knowledge is announced once per element and assertion in the incident thread (same posting as `/agent/run`);
3. it updates the status of the element: open incident -> `degraded` (minor, major) or `down` (critical); knowledge cited -> `recovering` (reason = the recommendation, `applied_assertion_ids` = the cited ids); no knowledge -> stays `degraded`/`down` with the reason "no knowledge yet for this case"; incident closed -> `healthy` at the next sync;
4. it stores a `CompanyCycle` with `health_counts` over all elements.

Events: `company.state` (`CompanyState` without cycles, calls and health: status, clock, timeline), `company.cycle`, `agent.call`, `network.status` (`ElementHealth`, on a change of status or applied knowledge). Nothing is persisted: a restart returns to `idle`.

**Endless mode** (`day_minutes=0`): no end, status never becomes `finished`, `ends_at` is null, `CompanyState.endless=true`. The scripted `day.json` timeline plays first; once all its chats have started, `chatgen.ChatGenerator` starts a new chat every 8-25 sim minutes (seeded, so it follows `speed`), at most 4 runs at once. Each one bumps `generated_count`, is stored in `wb.scenarios` as `gen_0001-<base>` (origin `generated`, last 50 kept) and appended to `timeline` as `kind="generated"` (`started=true`, `run_id`; the last 100 generated entries are kept, scripted ones always). `company.state` is emitted for each.

- **Offline mode (default, no LLM, no key needed, deterministic):** recombines a hand-written scenario by re-targeting it to another element of the same type (best class match first): the id, aliases and site name/id are replaced in the incident, the messages and the `expected` ground truth, timings vary by 0.7-1.4x. Mix ~60% a problem seen before (earlier knowledge gets reused), ~25% a new combination (least-used base), ~15% noise. A repeat of the same base on the same element within 6 sim hours is skipped. This works with `extractor_mode=scripted` and no `.env` at all.
- **LLM mode** (`use_llm` and an LLM configured, endless only): a background prefetch (`chatgen.LlmPrefetcher`) fills a queue of at most 3 scenarios with `generator.generate_scenario` in a worker thread (hint: elements with no applied knowledge, recent incidents), at most one call per 90 wall seconds. The company loop only pops from the queue and never waits; an empty queue means the offline recombination. A failure logs one warning and doubles the wait (90 s, 180 s ... cap 10 min). The queue is cleared on stop, finish and restart; a result that arrives after that is dropped.
- **Working calendar and bursts:** pacing follows `chatgen.activity_level(sim_dt)` (a 0-1.2 multiplier, Finnish business week as the sim clock reads it; public holidays ignored): Mon-Fri 08:00-16:30 = 1.0 (morning peak 08:30-10:30 = 1.2, lunch 11:30-12:30 = 0.5), 06:00-08:00 = 0.4, 16:30-22:00 = 0.25, night 22:00-06:00 = 0.05, weekend = 0.1. The 8-25 min gap is divided by the level (capped at 6 sim hours; it is redrawn when activity rises sharply). Night and weekend chats are incident chats only (no noise), at night the incident is critical, and people are swapped for on-call personas (NOC, field, network, radio roles) when they exist; a rare Monday 07-09 handover chat uses `slack-noc-handover`. Each generated chat has a 12% chance (`CompanyDay(burst_p=...)`) of a burst: 1-2 more chats within 1-5 sim minutes on different elements, still at most 4 running. The run starts on the sim clock's current weekday, so weekends occur in multi-day runs.
- **Auto-resolution:** each cycle closes incidents whose chat ended more than 3 sim hours ago ("closed by the cycle: no activity"), so no element stays degraded forever.
- **Pruning** (`_prune`, each cycle): threads over 150 are evicted oldest first (never a running or unprocessed one), even when assertions cite them: the thread goes to the cold archive first and the assertion keeps its `SourceRef`; closed incidents older than 6 sim hours and jobs over 200 are archived, then dropped; finished runs beyond 100, LLM calls 500 (already in `llm_calls.jsonl`), cycles 60, calls 200 are plain caps; healthy elements older than 2 sim hours leave the health list. Assertions, classes and sources are never pruned.
- **Cold archive** (`workbench/archive.py`): what pruning drops is appended first to `out/workbench/archive/{threads,incidents,jobs}.jsonl` (a thread with all its messages). Writes go through a queue to one background thread, so the loop never waits and nothing raises into it. `Archive.get_thread(id)` reads memory, then Atlas, then the file; `GET /graph/provenance/{id}` uses it for evicted threads, `DELETE /threads/{id}` of an archived thread removes the knowledge sources it gave, `/company/archive/threads/{id}` serves it to the UI. Optional cloud backends, only when the config names exist (`MONGODB_URI`, `TIGER_DATABASE_URL`): Atlas collections `wb_threads`, `wb_incidents`, `wb_jobs` (upsert by id; incident and job ids are prefixed with a per-process tag because `inc_0001` restarts after a reset), and a Tiger time-series table `wb_company_metrics` (`sim_time, cycle, knowledge_total, knowledge_valid, open_incidents, healthy, degraded, down, recovering, agent_calls`, one row per sync cycle). Short timeouts; the first cloud failure logs one warning, disables that backend and the documents go to the files (the Tiger sink just stops). The app created with a `state_file` (tests) never uses the cloud.

**Why Atlas + Tiger fit (and what is honest about it).** Pruning turns the endless run into a stream of finished conversations (documents, read by id or by element) and a stream of per-cycle numbers (a time series). Atlas stores the first naturally and also holds the dataset, so one cluster serves both; a hypertable in Tiger answers "knowledge growth and open incidents over weeks" with `time_bucket`. Trade-offs: both are optional and off by default (files work with no account); the cloud paths are written against fakes and have not been exercised against a real cluster, so a human with real keys must smoke-test them once (`GET /company/archive/stats` shows `atlas`/`tiger-sink` only while they work); the archive is write-once cold storage, nothing queries it except by thread id; a 10 GB cluster is ample, but nothing deletes old archive documents automatically.

**Clean-up** (`Archive.clear()`): `POST /company/start` with `reset="empty"` and `clear_archive=true` (the default), or `POST /company/archive/clear`, deletes the JSONL files, resets the counters and, when the cloud backends are configured, runs `delete_many({})` on exactly `wb_threads`, `wb_incidents`, `wb_jobs` (indexes survive) and `TRUNCATE TABLE wb_company_metrics` (only if the table exists; never DROP). Safety allowlist: these four names are hard-coded constants (`CLEARABLE_COLLECTIONS`, `CLEARABLE_TABLE`) and asserted inside `clear()`; no other collection (the dataset ones: `threads`, `assertions`, `facts`, ...) and no other table (`messages`) is ever touched. Writes queued before the clear are dropped (epoch counter) and writes of the new day wait until the wipe is done, so nothing stale lands afterwards. At day start the clear runs in a worker thread and logs one info line. A cloud failure never raises: one warning, the files are still cleared, and the result says `failed: <ExceptionClass>` (never a URI or credential).

**Small company limits.** At most 100 personas (`POST /personas` answers 422 above; the dataset sample takes the seed personas first, then authors of the sampled threads up to 100), at most 600 elements and 80 sites in the Workbench (`POST /data/load-dataset` takes `sites` 9-80 and answers 422 when the sample holds more than 600 elements; `POST /data/import` answers 422 above any cap; `ctx dataset export-workbench` refuses the same). Settings: `reset="empty"` turns `auto_sim` off for the day; stop and finish give it back (unless the user switched it on meanwhile).

Scope: incidents stay scripted ground truth. The Workbench still never detects a fault; statuses derive from the scripted incidents and from what the knowledge says.

### Company dataset sample

`uv run ctx dataset export-workbench out/dataset/tiny [--sites 40 --threads 300 --out out/workbench-sample.json --seed 42]` writes an export file (loadable with Import or `POST /data/import`): a connected sub-network grown from the Elisa seed by walking links (TRN-042 and its hub stay), the people who write, a thread mix (knowledge 30 %, hard negatives 15 %, noise naming sub-network elements 35 %, other noise; never a thread naming an element outside the sample; none after the sim start), the true facts of those threads linked into assertions, the hand-written scenarios and the seed threads (processed on load). Deterministic for the same dataset, options and seed. With the default 40 sites, `tiny` gives about 160 elements and 147 links, which the Network page draws without lag. Never use `large` as the Workbench source of truth: only the small sample goes in.

## Seed data (`data/workbench/`)

- `personas.json`: Elisa's two people (Erkki, Veikko) plus synthetic colleagues.
- `topology.json`: extra elements, sites with lat/lon, and links between elements. It is merged with `data/synthetic/*.csv`.
- `scenarios/*.json`: one `Scenario` per file (25). Elisa's chat replayed word for word is `elisa-trn042-chat.json`.

Everything except Elisa's chat and email is synthetic and documented in `data/workbench/README.md`.

## UI conventions (web/)

- **Calm by default.** Neutral surfaces, one accent (`accent`) for what is interactive, and color only for status (`ok`, `warn`, `bad`). Types, trust, channels and origins are plain grey chips (a small dot at most). Graphs are the one place with a color per kind, and their legend is also their filter. No gradients, glows or decorative motion.
- **One job per screen.** Overview = incidents and recent processing. Conversations = read a thread and follow it through the five pipeline steps (`components/pipeline/JobSteps.tsx`, one step open at a time, each with what it received and produced). Network = topology over time. Graph = the knowledge graph (`pages/GraphPage.tsx`, fed by `GET /graph`). Knowledge = the list.
- Colors come only from the tokens in `src/index.css` and from `src/lib/semantic.ts`.
- Components come from `src/components/ui` (Button, Badge, IdChip, Card/Panel, Modal/Drawer, Input/Select/Textarea/Field/Toggle, Tabs, Table, Avatar, EmptyState, JsonView, `toast` and `withToast`). Containers use `rounded-lg`, controls `rounded-md`; section labels are sentence case, not uppercase.
- Live data is read with `useLive(selector)` from `src/store/live.ts`. Pages never keep their own copy of the state, and they call `api.*` for actions. The SSE event brings the change back.
- Sim time comes from `useSimNow()`, and dates are formatted with `src/lib/format.ts`.
- English only in the UI. Every list has an empty state, and every destructive action asks for confirmation (use a Modal, never `window.confirm`).

## Who owns what (parallel build, Phase 1)

| Owner | Files |
| --- | --- |
| backend-core | `workbench/state.py`, `processor.py`, `persistence.py`, `routes.py`, `app.py`; `ContextStore.remove_assertion` in `store.py`; `tests/test_workbench_core.py` |
| simulator | `workbench/simulator.py`, `seed.py`, `generator.py`; `data/workbench/**`; `tests/test_workbench_sim.py` |
| slack-bridge | `workbench/slack_bridge.py`, `deploy/slack-manifest.yml`, `docs/slack-setup.md`, `tests/test_slack_bridge.py` |
| front-live | `web/src/pages/LivePage.tsx`, `NetworkPage.tsx`; `web/src/components/{graph,pipeline,incidents}/**` |
| front-work | `web/src/pages/{Conversations,Knowledge,LlmLog,Data,Settings}Page.tsx`; `web/src/components/{chat,knowledge,llm,data}/**` |
| deploy | `Dockerfile`, `.dockerignore`, `deploy/{docker-compose.yml,Caddyfile,update.sh}`, `docs/deploy-vultr.md`, `.github/workflows/ci.yml` |
| integration (lead) | everything else: contracts, `llm.py`, `config.py`, `cli.py`, `clock.py`, `bus.py`, `web/src/{api,store,lib,components/ui,components/layout}`, README, docs |
