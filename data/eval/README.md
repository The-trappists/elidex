# Evaluation labels

`retrieval_cases.json` is **hand-labelled synthetic data**, written by the team with Claude on 2026-11-07.

- **`timeline`**: when each labelled workbench scenario (`data/workbench/scenarios/`) happens. Dates are our choice; they set the order the knowledge arrives in (e.g. the barrier key moves after it was first shared, firmware 4.2 closes the SFP rule after Erkki's chat).
- **`cases`**: a problem on an element at a time, with the observations an agent would have. Each case lists:
  - `expect`: the knowledge that must come back, as `type:topic` keys of the scenarios' expected items;
  - `acceptable`: related knowledge that is fine to show but not required (e.g. site access on a dispatch);
  - anything else that comes back counts as noise.
- `why` explains the label in one line.

- **`outcomes`**: field feedback. An agent applied a rule (`rule` + the `source` scenario it was learnt from) on an element, and `after` is what it observed next. `expect_worked` is true, false, or null when no verdict is possible. Retrieval cases can list `expect_contested`: rules that must come back flagged "contested".

How the labels were chosen: for each case we asked "what would an experienced engineer want the agent to know here?". 19 cases have a right answer: similar problems on other units of the same class, knowledge closed or replaced later, site access, advice that failed in the field. 7 cases are traps where the right answer is nothing: same class but conditions not met, a new unit, the TRN-176 vs RAD-176 number clash, same model or site but different problem, a personal chat that looks technical, an unknown element.

**Limit:** the labels were written by people who know how the system works, so they are not blind. Ask someone else to add cases before trusting a high score.
