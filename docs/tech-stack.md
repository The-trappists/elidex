# Tech stack options

> **Status: proposal.** A quick-start default per layer. Pick what the team knows best; log choices in [decisions.md](decisions.md).

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

## Model roles and free access

Chosen direction (team lead, 2026-11-07, logged in [decisions.md](decisions.md)): the **extractor** runs on Gemini via AI Studio with Featherless as fallback; the **critic and judge** run on a DIFFERENT provider so that their errors are not correlated with the extractor's (Mistral recommended, Groq as critic fallback). Each provider must be smoke-tested by a human before the team relies on it: agents never use the `.env` keys. Findings below were fetched by a research agent on 2026-11-07; anything marked unverified was not confirmed.

| Provider | Free access found | Source | Status |
| --- | --- | --- | --- |
| Featherless | Event credit of $25 | [Since AI resources](https://sinceai.ai/hackathon-2026/guide/resources) | Stated on the event page |
| Google AI Studio | Free tier; the limits per model are only visible in the account. Google AI Pro student benefits apply to the AI Studio web UI; direct API key use is billed separately | [rate limits](https://aistudio.google.com/docs/rate-limits), [plans](https://ai.google.dev/gemini-api/docs/google-ai-plans) | A "$10/month AI Studio credits" offer is **unverified** for this team |
| Mistral | The models page lists Mistral Large 4 and Mistral Small 4 | [models overview](https://docs.mistral.ai/getting-started/models/models_overview/) | **Unverified**: whether Education includes API credits, the free-tier limits, an OpenAI-compatible endpoint and JSON-schema support |
| Groq (free plan) | gpt-oss-120b: 30 requests per minute, 1K per day, 8K tokens per minute, 200K per day | [rate limits](https://console.groq.com/docs/rate-limits) | Limits from the docs; small, fine for a fallback |
| OpenRouter (free models) | 20 requests per minute; 50 per day, or 1,000 per day after $10 of credit | [limits](https://openrouter.ai/docs/api-reference/limits) | Too tight to rely on |
| OpenAI | The resources page says no event credits; ChatGPT Plus does not include API usage | [help article](https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-plus) | Not an option without paying |
| Cerebras | Trial of $5 | not recorded | Too tight |

Other event resources found: Vultr $100, Tiger Data, MongoDB Atlas free tier, Snowflake trial, Red Hat OpenShift sandbox, n8n Pro. Claude Code and Cursor get no event credits.

### Environment variables

The extractor and the agent use `LLM_*` and `LLM_FALLBACK_*`. The critic role has its own chain (see `.env.example`, which only holds placeholders). The judge and the outcome decision use the critic chain too (role `critic`, purposes `judge` and `critic` in the LLM log). If no `LLM_CRITIC_*` key is set, the critic silently uses the primary chain, and the LLM log notes "critic not configured: used primary". Then the critic is no longer a different model.

| Variable | Meaning |
| --- | --- |
| `LLM_CRITIC_BASE_URL`, `LLM_CRITIC_API_KEY`, `LLM_CRITIC_MODEL` | Critic provider (OpenAI-compatible endpoint). The example file shows `https://api.mistral.ai/v1` and `mistral-large-latest` as placeholders: the endpoint and model name still have to be smoke-tested |
| `LLM_CRITIC_JSON_MODE` | `json_object`, `json_schema` or `prompt`; defaults to `LLM_JSON_MODE` |
| `LLM_CRITIC_REASONING_EFFORT` | Optional, as for the primary |
| `LLM_CRITIC_FALLBACK_BASE_URL`, `LLM_CRITIC_FALLBACK_API_KEY`, `LLM_CRITIC_FALLBACK_MODEL` | Tried when the critic fails (429, 5xx, timeout). The example file shows Groq as a placeholder |
| `LLM_CRITIC_FALLBACK_JSON_MODE` | Defaults to `LLM_CRITIC_JSON_MODE` |

Compare candidate models with [evaluation.md](evaluation.md) (`scripts/eval_models.py`; the paid mode is run by a human).

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
