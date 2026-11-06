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

## Event tools that fit

Tools offered to Since AI participants that map to our pipeline, from the [AI Tools & Resources page](https://sinceai.ai/hackathon-2026/guide/resources). Codes arrive through official Since AI messages and event channels.

| Tool | What we get | Where it fits | Optional award |
| --- | --- | --- | --- |
| [n8n Cloud Pro](https://docs.n8n.io/) | Free 1 month; one licence per team, 200 in total | The automated workflow that consumes our knowledge (ideas A, B, E) | — |
| [FIWARE / NGSI-LD](https://fiware-tutorials.readthedocs.io/en/latest/) | Open source; Orion-LD context broker in Docker; [Smart Data Models](https://smartdatamodels.org/) | Network elements and facts as NGSI-LD context entities: a standard "machine-readable context" layer | FIWARE Open Innovation Award (non-cash; needs meaningful integration + live demo) |
| [Featherless AI](https://featherless.ai/docs/quickstart-guide) | $25 credit, no card; limited redemptions, claim early | Open-weight LLMs (Qwen, Llama, Mistral) through an OpenAI-style API, for detection and extraction | — |
| [Google Gemini & AI Studio](https://mlh.link/gemini-aistudio) | Free tier for everyone; students get AI Pro for 1 year + $10/month | LLM extraction and embeddings | Best Use of Gemini API (MLH) |
| [Claude & Claude Code](https://code.claude.com/docs/en/overview) | No event credits; Claude Code needs a paid plan or API credit | Code generation, alternatives, scope checks (see [AGENTS.md](../AGENTS.md)) | — |
| [GitHub Copilot](https://github.com/features/copilot/plans) | Free for verified students; free plan otherwise | In-editor coding help | — |
| [MongoDB Atlas](https://mlh.link/mongodb-free) | Free tier; $50 for students | Knowledge store with vector search | Best Use of MongoDB Atlas (MLH) |
| [Tiger Data](https://mlh.link/tigerdata-quickstart) | $1,000 credit for 30 days, new signups | Managed Postgres for events and AI (a pgvector-style store) | Best Use of Tiger Data (MLH) |
| [Red Hat OpenShift](https://developers.redhat.com/developer-sandbox) | Developer Sandbox free for 30 days | Deploy the API and serve an open model | Red Hat OpenShift AI Technology Award, €1,000 |
| [CSC / LUMI AI Factory](https://lumi-ai-factory.github.io/LUMI_AIF_Onboarding/) | Only for participants registered by 30 Oct 2026 | Aitta: open models behind an OpenAI-compatible API, if data must stay in the EU | — |
| [Lovable](https://lovable.dev) | Pro free for 1 month, 100 credits | Quick demo UI | — |
| [Google Cloud](https://docs.cloud.google.com/docs) | $300 for 90 days, new accounts | Hosting | — |

Less relevant to this challenge: ElevenLabs (voice), Pruna AI (image and video), Solana, Snowflake, Vultr, Cursor (no event credits).

Event facts from the same page:

- One submission per team in [sinceai.app](https://sinceai.app/dashboard) by **Sunday 10:00**.
- Partner awards are entered by ticking the technology on that same submission.
- Keys and coupons must never be committed (see [CONTRIBUTING.md](../CONTRIBUTING.md#secrets)).
- Optional workshops on Friday in Presidenttiauditorio: GitHub Copilot at 20:30, Google AI Studio at 21:00.

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
