# Tech stack options

> **Status: options below are the original proposals; "What we actually use" shows the current state.** Log choices in [decisions.md](decisions.md).

| Layer | Default (quick start) | Alternatives | Decide based on |
| --- | --- | --- | --- |
| Language | Python 3.12 | TypeScript for the UI | Team skills |
| LLM | Hosted API (Claude, Gemini) | Open-weight models via Featherless | Compute and privacy are not constraints |
| Structured output | Pydantic + JSON-schema output | `instructor`, function calling | Familiarity |
| Graph store | NetworkX in memory | Neo4j (Docker); [Graphiti](https://github.com/getzep/graphiti) (temporal facts, invalidates instead of deleting, ships an MCP server) | Elisa recommends graph DBs (Neo4j or Spanner); in-memory is fastest to start |
| Agent interface | MCP server exposing `get_context` | FastAPI REST | MCP is what agents call; Elisa's agents use Google ADK / A2A |
| Demo agent | LLM with tool calling | Google ADK (same as Elisa) | Time |
| Demo UI | Streamlit | Gradio, small web page | Time |
| Synthetic data | LLM-generated chats, emails + CSV of network elements | — | Must be documented |
| Evaluation | Hand-labelled set + precision/recall script | LLM-as-judge on top | Credibility |

## What we actually use

| Layer | In the code today | Logged in [decisions.md](decisions.md)? |
| --- | --- | --- |
| Language | Python 3.12 (`uv`), TypeScript for the UI | No (default) |
| LLM | Gemini via AI Studio (OpenAI-compatible), Featherless fallback, provider-agnostic client, `scripted` mode without a key | Yes |
| Structured output | Pydantic models + JSON mode chosen per provider (`ctx llm-check`) | No |
| Graph store | NetworkX in memory + JSON file | No (Neo4j, Graphiti, MongoDB not used) |
| Agent interface | FastAPI REST and an MCP server (`get_context`, `check_action`) | No |
| Demo agent | Template or LLM-phrased plan, with guard and conditions; no Google ADK | No |
| UIs | Workbench: React, Vite, Tailwind, Cytoscape, REST + SSE. Pitch-style demo: Streamlit | Yes (Workbench) |
| Chat sources | Simulated in-app chat, optional Slack bridge (Socket Mode) | Yes |
| Hosting | Vultr VM, Docker Compose, Caddy (HTTPS, team password) | Yes |
| CI | GitHub Actions: `pytest`, web typecheck and build | No |
| Evaluation | In-Workbench comparison with a scenario's `expected` items; no precision/recall script yet | No |

## Event tools that fit

From the [Since AI resources page](https://sinceai.ai/hackathon-2026/guide/resources). Codes come through official event channels; never commit them (see [CONTRIBUTING.md](../CONTRIBUTING.md#secrets)).

| Tool | What we get | Use | Optional award |
| --- | --- | --- | --- |
| [Google Gemini & AI Studio](https://mlh.link/gemini-aistudio) | Free tier | Extraction, demo agent | Best Use of Gemini API (MLH) |
| [Featherless AI](https://featherless.ai/docs/quickstart-guide) | $25 credit, claim early | Open-weight LLMs, OpenAI-style API | — |
| [FIWARE / NGSI-LD](https://fiware-tutorials.readthedocs.io/en/latest/) | Orion-LD in Docker | Assertions as standard context entities | FIWARE Open Innovation Award |
| [MongoDB Atlas](https://mlh.link/mongodb-free) | Free tier | Assertion store | Best Use of MongoDB Atlas (MLH) |
| [GitHub Copilot](https://github.com/features/copilot/plans) | Free for students | Coding | — |

Partner awards are entered by ticking the technology on the submission.

## Repo layout (once the idea is chosen)

```
since-ai/
├── docs/       # this documentation
├── data/       # elisa/ (given) + synthetic/ (ours, with a README on how it was made)
├── src/        # capture, link, store, serve
├── demo/       # demo agent and UI
└── eval/       # labelled samples + metrics
```
