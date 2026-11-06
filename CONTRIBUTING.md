# Contributing

## Language

**English everywhere:** code, comments, commits, issues, PRs, Discord threads, slides.

## Proposals and decisions

- Docs in `docs/` are proposals until a choice is logged in [docs/decisions.md](docs/decisions.md).
- New idea? Add it to the table at the bottom of [docs/ideas.md](docs/ideas.md) and check it against the [scope checklist](docs/challenge.md#scope-checklist).
- Once a decision is logged, update the doc it affects so it no longer reads as a proposal.

## Working with AI assistants

See [AGENTS.md](AGENTS.md); it applies to every AI tool we use (Claude Code, Copilot, Cursor, Gemini…). In short: ask the assistant for alternatives and scope checks, use it to generate code, and keep the decisions with the team.

## Git workflow

- `main` always runs. Never force-push to `main`.
- Work on short-lived branches: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
- Keep PRs small. One approval (or a quick review in the team chat), then merge.
- Commit messages in the imperative mood, e.g. `Add alias matching to entity linker`.

## Shared contracts

Once the data model and interface are decided, changes to them are announced in the team channel **before** merging, because every workstream depends on them.

## Secrets

API keys and credentials live in `.env`, which is never committed. Add any new variable to `.env.example` with a placeholder value.

## Sync

A 10-minute stand-up at every gate of the [48h plan](docs/plan.md).
