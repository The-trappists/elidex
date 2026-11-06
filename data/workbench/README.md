# Workbench data

Seed data for the Context Workbench (`src/context_layer/workbench/seed.py`). Written by an AI assistant (Claude Code) on 2026-11-06 and reviewed by the team.

## What is Elisa's and what is synthetic

| Item | Origin |
| --- | --- |
| Text of `scenarios/elisa-trn042-chat.json` (Teams chat) and `elisa-trn042-email.json` (email) | Elisa, word for word |
| Element id `TRN-042`; the people Erkki Expert and Veikko Vikkelä | Elisa |
| Everything else: other elements, sites, coordinates, links, personas, other scenarios | Synthetic (invented) |

Facts about the Elisa items that are our guesses, not Elisa's: TRN-042 model `TX-3000`, install year 2019, its site (Turku Kupittaa; Elisa only says an unnamed site in Northern Finland), the dates, the message gaps of the email, and that "older units" means installed up to 2019.

## Files

- `topology.json`: 9 sites with lat/lon (the 5 of `data/synthetic/sites.csv`, same ids and names, plus 4 more), 15 extra elements (20 in total with the CSV), and 21 links. The CSV elements are not repeated here.
  - Links: a fibre ring between exchanges, fibre spurs, microwave links to remote radio sites in Lapland, backhaul to routers. The wiring is plausible, not real.
- `personas.json`: 8 people. Aino Arkkitehti and Liisa Lappi come from `data/synthetic/`. Helmi Hakkarainen (NOC), Jaakko Junnila (junior field engineer), Sanna Salminen (site access) and Raimo Rantanen (radio) are new, in the playful alliterative spirit of the existing names.
- `scenarios/*.json`: one `Scenario` per file, each with `tags` and a one-sentence `description` of what it tests. `delay_s` is in simulated seconds.

## Assumptions

- Elisa's chat keeps its real time gaps; two messages share a minute in the original, so a 20 s floor is applied. The first message has a 5 s delay.
- `expected` for the Elisa and the two other file-based scenarios is copied from `data/cache/extractions.json` (hand-written ground truth). The other `expected` items were written by hand in the same format, so the core `Linker` binds them against the seeded inventory (tested in `tests/test_workbench_sim.py`).
- Class criteria are conservative: model plus install year range, never a bare type.
- Incidents are scripted ground truth (observations from `models.OBSERVABLE_FIELDS`). Nothing here detects a fault.
