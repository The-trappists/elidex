<div align="center">
  <h1>Since AI 2026</h1>
</div>

Codebase for the Since AI hackathon 2026 challenge

<h2>The team</h2>
<h2>The project</h2>

We are tackling **Elisa's challenge "Capturing and Linking Human-Generated Contextual Metadata for Autonomous Network Operations"**: capture the knowledge experts share in Teams chats and emails, bind it to network entities with a validity period, and let an AI agent reuse it on a similar case.

> **Status: choosing an idea.** Docs are proposals until logged in [docs/decisions.md](docs/decisions.md). Start with **Challenge**, then **Ideas**.

| Doc | What's inside |
| --- | --- |
| [Challenge](docs/challenge.md) | The brief, the material, scope checklist |
| [Ideas](docs/ideas.md) | Candidate directions, all in scope |
| [Design](docs/design.md) | Pipeline and context-assertion schema |
| [Plan](docs/plan.md) | 48h plan, demo, risks, questions for mentors |
| [Tech stack](docs/tech-stack.md) | Stack options and event tools |
| [MVPs](docs/mvps.md) | What the code does now, one starter per idea |
| [Knowledge graph](docs/knowledge-graph.md) | Graph over network, assertions and provenance; agent queries; Neo4j mirror |
| [Dataset](docs/dataset.md) | Company-sized synthetic data, Atlas and Tiger Data loaders, vector search |
| [Decisions](docs/decisions.md) | What we chose and why |
| [Contributing](CONTRIBUTING.md) | Language, git workflow, shared contracts |
| [AGENTS.md](AGENTS.md) | Instructions for every AI assistant |

Elisa's material: [brief](docs/elisa/challenge-brief.pdf), [slides](docs/elisa/sinceai-2026-challenge-pitch-elisa.html), example data in [data/elisa/](data/elisa/).

<h2>Quick start</h2>

Needs [uv](https://docs.astral.sh/uv/). Runs offline by default (cached extractions); add an LLM key in `.env` (see `.env.example`) to use `--llm`.

```bash
uv sync
uv run ctx run                      # Teams + email -> context assertions (out/context_store.json)
uv run ctx context TRN-117 --at 2026-10-20T08:00
uv run ctx agent                    # demo agent on the synthetic cases
uv run ctx run --lifecycle && uv run ctx agent --conditions --guard   # MVP angles D, C, B
uv run ctx workbench                # team test bench: live UI + API on http://127.0.0.1:8010 (build web/ first)
uv run ctx llm-check                # which LLM provider and JSON mode work with your .env
uv run streamlit run demo/app.py    # demo UI
uv run ctx serve                    # REST API, docs at http://127.0.0.1:8000/docs
uv run ctx mcp                      # MCP server (stdio) for agents
uv run pytest
```

<h2>Demo checklist: big data and the MLH prizes</h2>

Details in [docs/dataset.md](docs/dataset.md). The company-sized data (`large`: 3 M threads, 13.8 M messages) lives in **MongoDB Atlas** and **Tiger Data**, outside the app's memory. Prizes: *Best Use of MongoDB Atlas* and *Best Use of Tiger Data*. **Tick both categories on the team submission in sinceai.app before Sunday 10:00** (the page gives no judging criteria).

**Before the demo** (needs `MONGODB_URI`, `MONGODB_DB`, `TIGER_DATABASE_URL`, `EMBEDDING_MODEL` in `.env`):

```bash
uv run ctx dataset db-check                          # both databases answer; vector index queryable
uv run ctx dataset tiger-verify out/dataset/large    # every line [  ok]
uv run ctx serve                                     # API on http://127.0.0.1:8000/docs
```

If the Atlas cluster was paused or the dataset is gone: `ctx dataset generate --scale large`, `ctx dataset load-mongo out/dataset/large --drop`, `ctx dataset load-tiger out/dataset/large --drop --analytics`, `ctx dataset bench out/dataset/large --save-mongo`, `ctx dataset embed --collection assertions --reset`.

**The 2-minute script**

| Step | Command (or API) | What to say |
| --- | --- | --- |
| 1. The scale | `uv run ctx dataset stats out/dataset/large` | A full operator: 5 009 sites, 20 086 elements, 3 012 staff, 3 M threads |
| 2. Atlas, by element | `uv run ctx dataset threads --source mongo --element TRN-042 --limit 5` | Every thread naming this node, from 3 M, in milliseconds (indexed). Nothing is loaded in memory |
| 3. Atlas, by meaning | `uv run ctx dataset similar "port stays down after SFP swap" --limit 5` (or `/similar?q=...`) | Vector search finds the nearest human knowledge, even without the same node or words |
| 4. Tiger, over time | `uv run ctx dataset activity TRN-042 --bucket "1 month"` | 13.8 M messages in a hypertable: who talked about it, when |
| 5. Tiger, freshness | `uv run ctx dataset freshness TRN-042` (or `/freshness/TRN-042`) | Knowledge goes stale: when did a human last talk about this node? |
| 6. The link to the challenge | `uv run ctx context TRN-117 --at 2026-10-20T08:00` | The context layer returns what humans know, with source, trust and validity |

One sentence per database for the jury: *Atlas stores the threads, the assertions and the vector search; Tiger Data stores the message time series and the freshness of knowledge.*

**After the hackathon:** pause or delete the Atlas cluster (0.08 $/h) and delete the Tiger service before its 30-day credit ends.

<h2>Run locally on Windows</h2>

Tested on Windows 11 with PowerShell. Python itself is not needed: `uv` downloads the pinned version (3.12, see `.python-version`).

**1. Install the tools** (once, then open a new terminal so `PATH` is updated):

| Tool | Needed for | Install (PowerShell) |
| --- | --- | --- |
| Git | Cloning | `winget install --id Git.Git -e` |
| uv | Everything in Python | `winget install --id astral-sh.uv -e` (or `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 \| iex"`) |
| Node.js 22 (includes npm) | Workbench UI only (`web/`) | `winget install --id OpenJS.NodeJS.22 -e` (see step 3) |
| Docker Desktop | Neo4j only (optional) | `winget install --id Docker.DockerDesktop -e`, then start it |

**2. Install and run the core** (offline, no API key needed):

```powershell
git clone https://github.com/The-trappists/since-ai-hackathon.git
cd since-ai-hackathon
uv sync
Copy-Item .env.example .env          # optional: add an LLM key to use --llm
uv run ctx run --lifecycle           # Teams + email -> context assertions
uv run ctx context TRN-117 --at 2026-10-20T08:00
uv run ctx graph reach ctx_0002      # knowledge graph queries, see docs/knowledge-graph.md
uv run pytest
```

**3. Workbench UI** (http://127.0.0.1:8010). It needs Node.js 22, the version CI uses.

Install Node.js 22 (once), then **close and reopen the terminal** and check it:

```powershell
winget install --id OpenJS.NodeJS.22 -e
node --version    # v22.x
npm --version
```

Use `OpenJS.NodeJS.22`, not `OpenJS.NodeJS.LTS`: the LTS package is now Node 26, which CI does not test. Without winget, take the "Windows Installer (.msi)" for v22 from https://nodejs.org/en/download and keep the default options (it adds `node` and `npm` to `PATH`). If you already have another Node version, [nvm-windows](https://github.com/coreybutler/nvm-windows) can switch: `nvm install 22` then `nvm use 22`.

Build the UI and start the workbench:

```powershell
cd web
npm ci
npm run build
cd ..
uv run ctx workbench
```

**4. Neo4j mirror of the knowledge graph** (optional; browser on http://localhost:7474, user `neo4j`):

```powershell
uv sync --extra neo4j
# in .env: NEO4J_PASSWORD=<at least 8 characters>
docker compose --env-file .env -f deploy/docker-compose.neo4j.yml up -d
uv run ctx graph push
docker compose --env-file .env -f deploy/docker-compose.neo4j.yml down    # stop (data is kept)
```

**Troubleshooting**

| Symptom | Fix |
| --- | --- |
| `uv`, `node` or `npm` is not recognized | Open a new terminal after installing; if it persists, sign out and back in so `PATH` is reloaded |
| `npm.ps1 cannot be loaded because running scripts is disabled` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `npm.cmd` instead of `npm` |
| `npm ci` fails on a `package-lock.json` mismatch | Check `node --version` is v22, delete `web\node_modules`, run `npm ci` again |
| `The token '&&' is not a valid statement separator` | Windows PowerShell 5.1 has no `&&`: run the commands of the Quick start one per line, or use PowerShell 7 |
| `failed to connect to the docker API` | Start Docker Desktop and wait until it says "Engine running" |
| `set NEO4J_PASSWORD` error from Compose | Set it in `.env` and keep `--env-file .env` (Compose looks for `.env` in `deploy/` otherwise) |
| `No store at out\context_store.json` | Run `uv run ctx run` first |
| Port 7474, 7687, 8000 or 8010 already in use | Stop the other program, or pass `--port` to `ctx serve` / `ctx workbench` |

**Workbench UI** (see [docs/workbench.md](docs/workbench.md)): `cd web && npm ci && npm run build`, then `uv run ctx workbench`. For UI work with hot reload, run `npm run dev` in `web/` (port 5173, proxies `/api` to 8010). Deployment: [docs/deploy-vultr.md](docs/deploy-vultr.md). Slack: [docs/slack-setup.md](docs/slack-setup.md).

| Path | Content |
| --- | --- |
| `src/context_layer/` | `listen` → `understand` → `link` → `store`, then `agent`, `api`, `mcp_server` |
| `src/context_layer/graph/` | Knowledge graph: ontology, queries (provenance, reach, experts, timeline), exports, Neo4j push |
| `src/context_layer/mvp/` | Starters for ideas B (guard), C (conditions), D (lifecycle): see [docs/mvps.md](docs/mvps.md) |
| `data/synthetic/` | Our synthetic records, messages and cases ([how they were made](data/synthetic/README.md)) |
| `data/cache/` | Cached extractions for the offline demo |
| `src/context_layer/workbench/` | Workbench backend: live state, pipeline jobs, simulator, Slack bridge, REST + SSE |
| `web/` | Workbench UI (React, Vite, Tailwind, Cytoscape) |
| `data/workbench/` | Workbench seed: topology, personas, scenarios ([how they were made](data/workbench/README.md)) |
| `deploy/` | Docker Compose + Caddy for the Vultr VM, Slack app manifest |
| `demo/app.py` | Streamlit demo |
| `tests/` | End-to-end checks on Erkki's case |

<h2>The license</h2>
