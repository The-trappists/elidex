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
uv run streamlit run demo/app.py    # demo UI
uv run ctx serve                    # REST API, docs at http://127.0.0.1:8000/docs
uv run ctx mcp                      # MCP server (stdio) for agents
uv run pytest
```

| Path | Content |
| --- | --- |
| `src/context_layer/` | `listen` → `understand` → `link` → `store`, then `agent`, `api`, `mcp_server` |
| `src/context_layer/mvp/` | Starters for ideas B (guard), C (conditions), D (lifecycle): see [docs/mvps.md](docs/mvps.md) |
| `data/synthetic/` | Our synthetic records, messages and cases ([how they were made](data/synthetic/README.md)) |
| `data/cache/` | Cached extractions for the offline demo |
| `demo/app.py` | Streamlit demo |
| `tests/` | End-to-end checks on Erkki's case |

<h2>The license</h2>
