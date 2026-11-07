# MVP options on top of the core

> **Status: all four starters work and are wired into the Workbench.** The code base ships the shared core plus a thin, working starter for each idea in [ideas.md](ideas.md). In the Workbench, lifecycle (D), conditions (C) and guard (B) are on by default (Settings). The team has not logged a single "chosen angle" in [decisions.md](decisions.md) yet; the others can stay as extras or be deleted. Diagrams: [architecture.md](architecture.md).

## The core (idea A): runs today

```
Listen ──> Understand ──> Link ──> Store ──> Serve / Reuse
listen.py  understand.py  link.py  store.py  api.py, mcp_server.py, agent.py
```

| Stage | What it does now | Where to add your touch |
| --- | --- | --- |
| Listen | Loads `teams*.json` and `email*.txt` from `data/elisa/` and `data/synthetic/`; live messages from the Workbench chat and Slack | Live replay, Microsoft Graph connector |
| Understand | LLM (any OpenAI-compatible API) or cached extractions | Better prompt, few-shot for implicit knowledge (😄, hedges) |
| Link | Exact ID / alias match, class from type + model + install years, abstains on unknown or too broad | Alias table, embeddings, vaguer scopes |
| Store | NetworkX graph + JSON file; chat and email of the same case merge into one assertion; two authors' different advice stay apart | Neo4j, Graphiti, MongoDB Atlas |
| Serve | `GET /context/{id}`, `POST /guard` (FastAPI); `get_context`, `check_action` (MCP) | Google ADK agent calling the MCP tools |
| Reuse | Demo agent on `data/synthetic/cases.json`: template or LLM | Real tool-calling agent |

## Starters for each angle

| Idea | Module | Turn it on | Demo moment |
| --- | --- | --- | --- |
| **B** Ask-before-act guard | `mvp/guard.py` | `ctx agent --guard`, `POST /guard`, MCP `check_action` | "Reboot TRN-117" becomes "bounce the interface first"; a dispatch to RAD-221 gets "collect the barrier key" |
| **C** Conditional rules | `mvp/conditions.py` | `ctx agent --conditions` | Same old node, counters moving: the rule does not fire |
| **D** Lifecycle, silently | `mvp/lifecycle.py` | `ctx run --lifecycle` | After the firmware 4.2 message, the rule is closed (`valid_to`) and the agent says the bounce is no longer needed |

Combinations from [ideas.md](ideas.md) work by combining flags: `ctx run --lifecycle && ctx agent --conditions --guard`.

## What each MVP still needs

| Idea | Next steps |
| --- | --- |
| A | Run `--llm` on more synthetic threads; eval set + precision/recall of linking |
| B | Richer action vocabulary than the verb list in `guard.py`; show the guard inside an agent loop |
| C | Ask the LLM for checks on more observable fields (`OBSERVABLE_FIELDS` in `models.py`) |
| D | Done in the Workbench: scenarios `expert-disagreement` (both kept and flagged), `hunch-to-verified`, `firmware-4-2-rollout` and `slack-key-moved` (closing). Missing: the same synthetic threads in `data/synthetic/` for the offline `ctx run` path, and an eval on them |

## Scope check

All four stay in scope (see [challenge.md](challenge.md#scope-checklist)): input is chat and email only, no human confirms anything, conditions check what the agent already observed (no fault diagnosis), and the guard is a mock agent step, not Elisa's workflow.
