# Evaluation labels

`retrieval_cases.json` is **hand-labelled synthetic data**, written by the team with Claude on 2026-11-07.

- **`timeline`**: when each labelled workbench scenario (`data/workbench/scenarios/`) happens. Dates are our choice; they set the order the knowledge arrives in (e.g. the barrier key moves after it was first shared, firmware 4.2 closes the SFP rule after Erkki's chat).
- **`cases`**: a problem on an element at a time, with the observations an agent would have. Each case lists:
  - `expect`: the knowledge that must come back, as `type:topic` keys of the scenarios' expected items;
  - `acceptable`: related knowledge that is fine to show but not required (e.g. site access on a dispatch);
  - anything else that comes back counts as noise.
- `why` explains the label in one line.

How the labels were chosen: for each case we asked "what would an experienced engineer want the agent to know here?". 14 cases have a right answer: similar problems on other units of the same class, knowledge closed or replaced later, site access. 8 cases are traps where the right answer is nothing: same class but conditions not met, a new unit, the TRN-176 vs RAD-176 number clash, same model or site but different problem, an unknown element.

**Limit:** the labels were written by people who know how the system works, so they are not blind. Ask someone else to add cases before trusting a high score.
