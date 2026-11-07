# Decision log

Every proposal in these docs stays a proposal until it is logged here. Newest first.

| Date | Decision | Alternatives considered | Why | Decided by |
| --- | --- | --- | --- | --- |
| 2026-11-06 | LLM: Gemini (AI Studio, OpenAI-compatible endpoint) as primary, Featherless (Since AI credit) as fallback; the app stays provider-agnostic and runs in "scripted" mode without a key | Snowflake Cortex (trial, json_schema only), Vultr inference (undocumented), OpenShift AI (self-hosted), OpenAI/Claude (no event credits) | Free with the event's resources; same client for all; fallback covers free-tier rate limits. JSON mode per provider to be confirmed with `ctx llm-check` | UnPtitBelge (with Claude) |
| 2026-11-06 | Deploy the Workbench on a Vultr VM with Docker Compose and Caddy (HTTPS, one team password) | Red Hat OpenShift Sandbox, local only | MLH $100 credits; simplest way to keep SSE, the simulator and the Slack bridge running 24/7 | UnPtitBelge (with Claude) |
| 2026-11-06 | Simulated in-app chat as the default source, plus an optional Slack bridge (Socket Mode, personas posting with their own name and avatar) | Slack only, simulated chat only | Works with zero setup; Slack lets teammates talk to the pipeline like real specialists and stands in for Teams | UnPtitBelge (with Claude) |
| 2026-11-06 | Build the Workbench UI in React + Vite + TypeScript + Tailwind, with Cytoscape for the graph, fed by REST + SSE | Extend the Streamlit demo | Real-time updates and visuals Streamlit cannot do well; `web/` splits cleanly between contributors | UnPtitBelge (with Claude) |
| 2026-11-06 | Build a "Context Workbench": a deployed real-time test bench (network graph, scripted incidents, fake employees chatting, pipeline view, data management, LLM log). It is a work tool, not the pitch demo | Keep testing with CLI + Streamlit | The team needs to see the pipeline work live and analyse every LLM call; incidents stay scripted (no fault detection, out of scope) | UnPtitBelge (with Claude) |
