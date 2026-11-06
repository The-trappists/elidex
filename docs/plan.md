# 48h plan and roles

> **Status: proposal.** Hours count from the official start; adjust once the schedule is confirmed.

| Phase | Hours | Goals | Gate at the end |
| --- | --- | --- | --- |
| Explore | H0 → H4 | Talk to Elisa mentors; compare [ideas](ideas.md) against the [scope checklist](challenge.md#scope-checklist); pick one direction | **Idea chosen** (logged in [decisions.md](decisions.md)) |
| Foundations | H4 → H8 | Freeze data model; synthetic data v1; choose stack; create repo structure | **Schema frozen** |
| Core v1 | H8 → H22 | Crude capture → link → store → serve, end to end | **Runs end to end** |
| Differentiate | H22 → H36 | Build the original angle of the chosen idea; evaluation set + metrics | **Feature freeze** |
| Ship | H36 → H48 | Demo polish; slides + backup video; two full rehearsals | **Final pitch** |

Two principles:

- **Pick fast, then commit.** Exploring longer than the first gate costs build time.
- **End to end before polish.** A crude full pipeline beats a polished half-pipeline.

A 10-minute stand-up happens at every gate.

## Roles

Roles depend on the chosen idea. A split that fits most of them:

| Workstream | Owns | Owner |
| --- | --- | --- |
| Data & eval | Synthetic data, inventory, labelled eval set, metrics | _TBD_ |
| Capture & linking | Detection, extraction, entity linking, prompts | _TBD_ |
| Store & interface | Knowledge store, API or agent tool, freshness logic | _TBD_ |
| Demo & pitch | Consumer (agent, guard, bot…), UI, slides, demo script | _TBD_ |
