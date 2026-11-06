# Synthetic data

Elisa encourages synthetic data and asks us to document it. Everything here was **hand-written by the team with an AI assistant** (Claude Code) on 2026-11-06, in the style of `data/elisa/`. Names, IDs, models and places are invented.

| File | What | Why |
| --- | --- | --- |
| `network_elements.csv` | 5 elements. `TRN-042` comes from Elisa; its model `TX-3000` and year 2019 (chat `seq` 3: "around 2019") are our guesses. The rest are ours. | Linking: `TRN-117` (2018) is a similar old node, `TRN-208` (2020) and `TRN-305` (2024) are not, `RAD-221` sits behind the barrier |
| `sites.csv` | 5 sites | Elements are located at sites; the barrier fact binds to `SITE-NF-017` |
| `email_barrier_access.txt` | Barrier-key email | Elisa gives the story but no email or key location |
| `teams_firmware_rollout.json` | Firmware 4.2 fixes the bug | Knowledge going out of date (`valid_to`, idea D) |
| `cases.json` | 5 new cases for the demo agent | Reuse on a similar node, no overlinking, conditions, time, dispatch |

`aliases` in the CSV are separated by `|`.

## Assumptions

- Elisa's chat and email have **no date**: we use **2026-10-15** (chat at its own times, email at 10:30). Change with `DEFAULT_THREAD_DATE` / `DEFAULT_EMAIL_TIME`.
- "Older units" is read as **transmission nodes installed up to 2019**.

## Cached extractions

`data/cache/extractions.json` holds hand-written extractions in the exact format the LLM extractor returns, so the demo runs offline and deterministically. `ctx run --llm` replaces them with real model output.
