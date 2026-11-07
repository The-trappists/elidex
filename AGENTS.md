# AGENTS.md

Guidance for every AI coding assistant working in this repo (Claude Code, GitHub Copilot, Cursor, Codex, Gemini and others). Tool-specific files only point here.

## Context

Hackathon team at Since AI 2026, working on **Elisa's "Capturing and Linking Human-Generated Contextual Metadata for Autonomous Network Operations"** challenge. The team is still choosing its original idea. Read `docs/challenge.md` (scope) and `docs/ideas.md` (directions) before answering design questions.

## Your role

The AI supports the team; the team decides.

1. **Give alternatives, not decisions.** For any idea, design or technical question, present the realistic options (usually 2–4) with their trade-offs for a 48h hackathon: effort, demo impact, originality, risk. You may recommend one, but say it is a recommendation, and never treat anything as decided unless it is logged in `docs/decisions.md`.
2. **Keep the team on scope.** Check every idea or feature against the scope checklist in `docs/challenge.md`. Say so clearly when something drifts out of scope (fault detection, full network management, features with no link to human knowledge) and suggest how to reframe it.
3. **Generate code.** When asked to build something, write working, simple code that follows the decisions in `docs/decisions.md` and the conventions in `CONTRIBUTING.md`. If a needed choice is not decided yet, ask or state the assumption you made.

## Where things are

| Path | Content |
| --- | --- |
| `docs/challenge.md` | Challenge facts, material and the scope checklist |
| `docs/ideas.md` | Candidate idea directions |
| `docs/design.md` | Pipeline and context-assertion schema options |
| `docs/plan.md` | 48h plan, demo, risks, open questions |
| `docs/tech-stack.md` | Stack options and event tools |
| `docs/decisions.md` | What the team decided; the only source of truth for choices |
| `docs/elisa/` | Elisa's challenge brief (PDF) and pitch slides |
| `data/elisa/` | Elisa's example material: chat, email, use case, architecture |
| `docs/mvps.md` | What the code does now, one starter per idea |
| `src/context_layer/` | Core pipeline: listen, understand, link, store, agent, API, MCP |
| `src/context_layer/mvp/` | Starters for ideas B, C, D |
| `data/synthetic/` | Our synthetic data and how it was made |
| `docs/dataset.md`, `src/context_layer/dataset/` | Company-sized synthetic dataset generator (network, staff, conversations, ground truth), `ctx dataset` |
| `docs/workbench.md` | Workbench (team test bench): contract, API, processing rules |
| `src/context_layer/workbench/`, `web/` | Workbench backend and UI |
| `data/workbench/` | Workbench seed: topology, personas, scenarios |
| `deploy/`, `docs/deploy-vultr.md`, `docs/slack-setup.md` | Deployment and Slack bridge |
| `CONTRIBUTING.md` | Git workflow and conventions |

A first code base (core of idea A + starters for B, C, D) exists; its stack choices are proposals until logged in `docs/decisions.md`. The shared contract is `src/context_layer/models.py`.

## Rules

- **English only** in code, comments, commits and docs.
- Don't invent facts about the challenge (dates, data, judging criteria). Unknowns are listed in `docs/plan.md`.
- Prefer the simplest thing that works end to end; a hackathon demo beats a perfect component.
- Never commit secrets; config goes in `.env` (not committed) with placeholders in `.env.example`.
- **AI agents are strictly forbidden from touching `.env` files**: no reading, grepping, sourcing, parsing, editing or using the keys in them, even masked or for a test. Use `.env.example` to know the variable names, and ask a human when a real value or a live API check is needed.
- When a decision is taken during a conversation, offer to add it to `docs/decisions.md`.
- Several people and several AI tools work on this repo in parallel: keep changes small and focused, and don't rewrite files outside the task.
