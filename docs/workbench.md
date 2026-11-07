# Context Workbench

> Status: in progress on branch `feat/workbench`. Tool choices (React, Vultr, Slack) are proposals until they are logged in [decisions.md](decisions.md).

The Workbench is the team's real-time test bench. It is not the pitch demo. It lets us:
- watch fake employees talk, in an in-app chat or in a real Slack;
- see each conversation go through our pipeline (listen → understand → link → store → reconcile);
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
| `DELETE /assertions/{id}` | | 204 |
| `POST /guard` | `GuardBody` | `{decision, action, steps, reasons}` |
| `POST /agent/run` | `AgentRunBody` | `AgentRunResult` (hits carry `check_status`, `to_read`, `track_record`) |
| `POST /agent/outcome` | `OutcomeBody` | `{recorded, track_record, line}`: did the knowledge work when applied? (see `docs/evaluation.md` §4) |
| `POST /data/reset` | `ResetBody` | 204, then emits `state.reset` |
| `DELETE /data/generated` | | `{removed: {kind: count}}`, then emits `state.reset` |
| `GET /data/export` | | the full state JSON (attachment) |
| `POST /data/import` | the export JSON | 204, then emits `state.reset` |
| `GET /settings`, `PUT /settings` | `SettingsPatch` | `Settings` |
| `GET /slack/status` | | `{connected, channel, error}` |
| `GET /llm/calls?purpose=&thread_id=&limit=` | | `LlmCall[]`, newest first, read from the JSONL |
| `GET /llm/calls/{id}` | | `LlmCall` |
| `POST /llm/check` | | `LlmCheckResult[]` (same as `ctx llm-check`) |
| `GET /export/llm-calls.jsonl` | | file |
| `GET /export/transcript.md?thread_id=` | | Markdown transcript (one thread, or all) |
| `GET /export/session.json` | | snapshot plus all jobs plus all LLM calls |

Errors use FastAPI's `{"detail": "..."}` with 4xx/5xx codes, so the UI can show `detail` in a toast.

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
4. Extractor choice (`settings.extractor_mode`):
   - `llm`: `LLMExtractor(cache_path=out/workbench/llm_cache.json)`; error if no key.
   - `scripted`:
     - the scenario's `expected` if the thread came from a scenario;
     - otherwise the core cache (`data/cache/extractions.json`) for seeded files;
     - otherwise nothing, with note "scripted mode: no ground truth for this thread".
   - `auto`: `llm` if a key is configured, else `scripted`.
5. Eval: when the extractor is the LLM and the thread has `expected`, items are compared on `(type, topic)` and the result goes in `job.eval`. Same bindings count as matched; different bindings go in `binding_diffs`.
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

## Seed data (`data/workbench/`)

- `personas.json`: Elisa's two people (Erkki, Veikko) plus synthetic colleagues.
- `topology.json`: extra elements, sites with lat/lon, and links between elements. It is merged with `data/synthetic/*.csv`.
- `scenarios/*.json`: one `Scenario` per file (23, eleven of them on Slack). Elisa's chat replayed word for word is `elisa-trn042-chat.json`.

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
