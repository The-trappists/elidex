# Tech stack options

> **Status: proposal.** Options per layer with a default that is quick to start with. Pick what the team knows best; record choices in [decisions.md](decisions.md).

| Layer | Default (quick start) | Alternatives | Decide based on |
| --- | --- | --- | --- |
| Language | Python 3.12 | TypeScript for UI/bot parts | Team skills; ML libraries are Python-first |
| LLM access | Hosted API (Claude, etc.) | Open-weight model on LUMI / Red Hat stack (partners) | Data privacy rules, compute offered by organisers |
| Structured output | Pydantic models + JSON-schema output | `instructor`, function calling, DSPy | Familiarity |
| Fuzzy matching | `rapidfuzz` | `thefuzz`, plain embeddings | — |
| Embeddings | Hosted embedding API | `sentence-transformers` locally | Privacy, offline need |
| Knowledge store | Neo4j (Docker) | Postgres + pgvector, SQLite + sqlite-vec, NetworkX in memory | Is the graph central to the idea? |
| API | FastAPI | MCP server (agent tool), Flask | Who consumes it: code or an LLM agent |
| Demo UI | Streamlit | Gradio, small React app, chat bot (Slack/Discord mock) | Idea C needs a chat surface |
| Synthetic data | LLM-generated chats, emails, tickets + CSV inventory | Public telecom datasets, if any fit | Realism vs. time |
| Evaluation | Small hand-labelled set + precision/recall script | LLM-as-judge on top | Credibility in front of judges |

## Repo layout (to define after the idea is chosen)

The code structure depends on the chosen direction. A pipeline-shaped layout that fits most ideas:

```
since-ai/
├── docs/          # this documentation
├── data/          # synthetic data + inventory
├── src/           # capture, link, store, serve
├── demo/          # consumer: agent, guard, bot or alert
├── eval/          # labelled samples + metrics
└── tests/
```
