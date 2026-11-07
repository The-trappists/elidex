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
- `personas.json`: 12 people. Aino Arkkitehti and Liisa Lappi come from `data/synthetic/`. Helmi Hakkarainen (NOC), Jaakko Junnila (junior field engineer), Sanna Salminen (site access) and Raimo Rantanen (radio) are new, in the playful alliterative spirit of the existing names. Four non-specialists were added on 2026-11-07: Tiina Toimisto (office manager), Matti Myynti (sales rep), Outi Asiakaspalvelu (customer service) and Heikki Huolto (building caretaker).
- Ambiguity and layperson scenarios (8, added 2026-11-07):
  - `ambiguous-*` (4): the text does not name the element. `ambiguous-two-turku` (two sites called Turku, resolved in the chat), `ambiguous-helsinki-unresolved` (four devices, never resolved: `expected` is empty, the pipeline must abstain), `ambiguous-number-clash-176` (TRN-176 vs RAD-176), `ambiguous-old-radio-sodankyla` ("the old one" of two radios).
  - `layperson-*` (4): people with no network vocabulary describe symptoms in their own words and the problem has to be guessed. `layperson-caretaker-beeping-cabinet` (sounds, lights, a sticker), `layperson-callcentre-ferry-evenings` (customer words, the knowledge stays a `hunch`), `layperson-salesrep-flooded-road` (a site seen from the road), `layperson-office-manager-humming-cabinet` (email, a wrongly read sticker).
  - In every one of them the useful knowledge comes from the reply of someone who knows, never from the lay description alone. Tags `ambiguity`, `abstention`, `no-overlink` and `layperson` select them.
- `scenarios/*.json`: one `Scenario` per file (23), each with `tags` and a one-sentence `description` of what it tests. `delay_s` is in simulated seconds (8 to 180; 8-15 s is a burst from one person).
  - Slack scenarios (6): `slack-radio-tilt`, `slack-noc-handover`, `slack-breaker-harbour-hut`, `slack-key-moved`, `slack-needle-in-noise`, `slack-vendor-secondhand`. Thread replies start with `↳ ` (a stand-in for real Slack threads).
  - Run `barrier-key-kemijarvi` before `slack-key-moved` to see the old access closed by the correction.

## Writing style of the scenarios

Rewritten on 2026-11-07 (Claude Code) to sound less robotic, reviewed by the team: one thought per message and bursts of short messages, each persona in their own voice (`style` in `personas.json`), no one saying "note this down", hedges, interruptions, side topics, corrections, and a few light Finnish words (hei, moi, joo, kiitos, kahvi). The LLM generator follows the same guide (`generator.py`). The ground truth in `expected` did not change for the rewritten scenarios, only `cited_seq` and `evidence`.

## Assumptions

- Elisa's chat keeps its real time gaps; two messages share a minute in the original, so a 20 s floor is applied. The first message has a 5 s delay.
- `expected` for the Elisa and the two other file-based scenarios is copied from `data/cache/extractions.json` (hand-written ground truth). The other `expected` items were written by hand in the same format, so the core `Linker` binds them against the seeded inventory (tested in `tests/test_workbench_sim.py`).
- Class criteria are conservative: model plus install year range, never a bare type.
- Incidents are scripted ground truth (observations from `models.OBSERVABLE_FIELDS`). Nothing here detects a fault.
