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
- All three agents are toggles in Settings (`use_critic`, `use_judge`, `use_outcome_loop`, default on; critic and judge stay silent without an LLM key).

Read more: [plan-loop-v2.md](plan-loop-v2.md) (what was built, known weaknesses), [design.md](design.md) (pipeline and fields), [evaluation.md](evaluation.md) (metric and model comparison), [demo-loop-v2.md](demo-loop-v2.md) (2m30 demo script), and the endpoint tables below.

## Architecture

```
web/ (React + Vite + TS + Tailwind + Cytoscape)
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
| `POST /data/reset` | `ResetBody` | 204, then emits `state.reset` |
| `DELETE /data/generated` | | `{removed: {kind: count}}`, then emits `state.reset` |
| `GET /data/export` | | the full state JSON (attachment) |
| `POST /data/import` | the export JSON | 204, then emits `state.reset`. 422 when an element's `site_id` or a link's end is unknown (same rules as `POST /elements` and `/links`). The optional key `process_on_import` (thread ids) is processed right away, as the seed is at first start |
| `POST /data/load-dataset` | `{sites=40 (9-150), threads=300 (0-1000), seed=42}` | the sample summary (counts, `connected_components`). Builds a connected sample of the company dataset on the fly (`DATASET_DIR`, else `out/dataset/tiny`, generated in 2 s when missing) and replaces the state like an import. 422 for a dataset over 500k threads (use the CLI); the Data page button "Load company dataset" calls it |
| `GET /settings`, `PUT /settings` | `SettingsPatch` | `Settings` |
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

1. `POST /agent/run` applies knowledge to a case. When the toggle is on and at least one assertion was applied (conditions not failed), the ops agent (persona `ops-agent`) posts **one informational message** ("Applied ctx_0001 on TRN-117: ... Avoid: ...") into the thread of the entity's newest incident, or into a new `manual` thread named after the case. It never asks anyone to reply, confirm or rate. One `RuleApplication` (outcome `pending`) is created per assertion; event `application.upserted`.
2. The thread's next job, in the `after_store` hook, looks at the human messages after the agent message (the ops agent's own items are ignored by an `after_understand` hook). One LLM call (critic role, purpose `judge`) returns `worked`, `failed` or `unclear` with a verbatim quote. Without an LLM, or when the call fails, a keyword heuristic decides (`method: "heuristic"`).
3. The verdict is recorded in the one ledger `Assertion.outcomes` (`source: "thread"`, `application_id`, `quote`) and settled by `outcome.settle`, the same rule as `POST /agent/outcome`. `worked` with no failure in the ledger: trust becomes `verified` (stated by the human, evidence = quote), the thread message is added as a source, and a `judge_decision` flag says "Confirmed in the field". `worked` with a failure in the ledger: trust is not upgraded, a flag says "Mixed evidence". `failed`: confidence x0.7 and a `low_confidence` flag, and it counts in `track_record` (it can make the rule contested). One application is recorded once, so reprocessing never double counts; an observation outcome for the same assertion and entity resolves the pending application first. `unclear`: nothing changes, the application stays pending. An application is decided once; a thread without a pending application costs no LLM call. A failure is noted in `job.notes` and never blocks the job.

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
