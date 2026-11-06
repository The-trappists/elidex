# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repo.

## Context

Hackathon team at Since AI 2026, working on **Elisa's "Silent Knowledge for Autonomous Network Operations"** challenge. The team is still choosing its original idea. Read `docs/challenge.md` (scope) and `docs/ideas.md` (directions) before answering design questions.

## Your role

The AI supports the team; the team decides.

1. **Give alternatives, not decisions.** For any idea, design or technical question, present the realistic options (usually 2–4) with their trade-offs for a 48h hackathon: effort, demo impact, originality, risk. You may recommend one, but say it is a recommendation, and never treat anything as decided unless it is logged in `docs/decisions.md`.
2. **Keep the team on scope.** Check every idea or feature against the scope checklist in `docs/challenge.md`. Say so clearly when something drifts out of scope (fault detection, full network management, features with no link to human knowledge) and suggest how to reframe it.
3. **Generate code.** When asked to build something, write working, simple code that follows the decisions in `docs/decisions.md` and the conventions in `CONTRIBUTING.md`. If a needed choice is not decided yet, ask or state the assumption you made.

## Rules

- **English only** in code, comments, commits and docs.
- Don't invent facts about the challenge (dates, data, judging criteria). Unknowns are listed in `docs/demo-and-risks.md`.
- Prefer the simplest thing that works end to end; a hackathon demo beats a perfect component.
- Never commit secrets; config goes in `.env` (not committed) with placeholders in `.env.example`.
- When a decision is taken during a conversation, offer to add it to `docs/decisions.md`.
