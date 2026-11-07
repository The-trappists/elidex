# Company-sized synthetic dataset

> Status: tool, not a decision. Nothing here is logged in [decisions.md](decisions.md). Generated on 2026-11-07 with Claude Code and reviewed by no one yet. **Everything is invented**; the only hand-written part is the Workbench seed (Elisa's TRN-042 and friends), which is kept inside the generated network.

Why: our hand-written data has 20 elements and a few dozen messages. Knowledge about "TX-3000 installed up to 2019" then reaches 4 nodes. In a real operator it reaches hundreds, the haystack has millions of messages, and two sites share a name. This dataset lets us test linking, over-linking, abstention and latency at that scale.

```bash
uv run ctx dataset generate --scale demo      # 150k threads, ~150 MB, 2 s
uv run ctx dataset generate --scale large     # 3M threads, ~3 GB, ~30 s on 12 workers
uv run ctx dataset generate --scale xl        # 10M threads, ~10 GB
uv run ctx dataset stats out/dataset/large    # manifest
uv run ctx dataset bench out/dataset/large    # link + store the true facts, time lookups
```

Output goes to `out/dataset/<scale>/` (git-ignored). Same `--seed` and scale give byte-identical files, whatever `--workers` is (tested). Override sizes with `--sites --staff --facts --threads`.

## Can the event tools generate several GB for us?

No tool of the event is a data generator, and an LLM cannot do it within our budget. So the generator is plain Python (templates and random draws, no LLM).

| Tool (see [tech-stack.md](tech-stack.md)) | Verdict |
| --- | --- |
| Gemini free tier, Featherless ($25 credit) | Rate-limited and credit-limited; 1 GB of text is hundreds of millions of tokens. Fine for a few hundred hand-quality threads (the Workbench `generate` button), not for volume |
| MongoDB Atlas free tier | Storage cap (512 MB as far as we remember, to verify): cannot hold the large scale; fine for `demo` |
| Vultr VM ($100 credit, 1 vCPU / 2 GB as planned in [deploy-vultr.md](deploy-vultr.md)) | Could host files, but generate locally and copy only `demo`. The 2 GB VM would also struggle to load `large` |
| FIWARE / Orion-LD, Neo4j in Docker | Targets for loading the graph (`network/`), not sources |

## What it contains

| Folder | Content |
| --- | --- |
| `network/` | `sites.csv`, `network_elements.csv` (same columns as `data/synthetic/`, so `Inventory.load(folder)` reads them), `sites.jsonl` (lat/lon, tier, city, build year), `links.jsonl` (fiber / microwave / backhaul, capacity) |
| `people/` | `users.jsonl` (id, name, email, role, team, region, seniority, skills, writing style, shift, manager), `teams.json` |
| `conversations/` | `threads-NNNN.jsonl`, time-ordered shards. One line = one thread in the shape of the core `Thread` (`id`, `source` slack/teams/email, `subject`, `messages[seq, author, author_id, role, sent_at, text]`). Add `thread_id` and `source` to each message to build `models.Message` |
| `ground_truth/` | `facts.jsonl` (the knowledge), `labels-NNNN.jsonl` (which threads carry knowledge or are traps) |
| `manifest.json`, `README.md` | Counts, sizes, seed, generation time |

### Network (complete graph)

Four layers like a real operator: 3 core data centres in a mesh; regional exchanges in rings (each linked to the nearest core); aggregation hubs dual-homed to regional exchanges; access huts (fibre, some microwave when far); radio masts (baseband units, radio units, microwave back to a hub or daisy-chained to another mast). Inside a site everything hangs on a gateway element. Check: one connected component, no orphan element (tested). 12 Finnish regions weighted by population; real city names, invented sites.

`large`: 5,009 sites, 20,086 elements, 15,446 links. The 9 sites, 20 elements and 21 links of the Workbench seed are kept and linked to the nearest generated hub, so TRN-042 now belongs to a real graph. Generated ids are `TRN-10001`, `RTR-`, `AGG-`, `RAD-`, `MWT-`, `BBU-`, `PWR-` (5 digits, no clash with the seed); each element also has an alias like `HEL101-TRN2`, the way field people name things.

Models and years follow a catalogue (e.g. TX-2000 2009–2017, TX-3000 2015–2022, TX-5000 2021–2026) with firmware drawn by age, some already upgraded. A few site names are duplicated on purpose (see Findings).

### People

`large`: 3,012 users in 17 teams (NOC, Transmission, Radio, Core & IP, Field team per region, Logistics, Planning, Customer service, Sales, Facilities, IT, Vendor management, Security, Management). Seniority and skills decide who answers: experts and seniors know models; customer service and sales never state technical knowledge. The 12 Workbench personas are included with their ids. Each user has a writing style (terse, chatty, formal, emoji, finglish) applied to their messages.

### Conversations (Jan 2025 – 6 Nov 2026)

`large`: 3,000,000 threads, 13.8 M messages (Slack 44 %, Teams 36 %, email 20 %), 2.95 GB. Office-hours weighted, skewed so a few elements are discussed far more than the rest.

- **Noise** (the haystack): shift handovers, truck rolls, maintenance windows, alarm chatter, parts, firmware rollouts, customer calls, small talk, sales and facilities admin, vendor emails with long boilerplate.
- **Hard negatives** (labelled `hard_negative`, the pipeline should store nothing): one-off fixes ("rebooted it, fine now"), unanswered questions, rumours with no element, id confusion.
- **Knowledge threads** (labelled `knowledge`, about 0.1 % of threads, like a needle in a haystack).

### Ground truth

One line of `facts.jsonl`:

```json
{"fact_id": "F000021", "family": "class_workaround",
 "item": { ... same fields as models.ExtractedItem ... },
 "sources": [{"thread_id": "slack/2025-02/k000021-1", "seq": [2, 3, 4]}],
 "valid_from": "...", "valid_to": null, "closed_by": null, "conflicts_with": [],
 "reach": {"kind": "class", "count": 9, "entity_ids": ["TRN-10009", "..."], "truncated": false},
 "class_id": "class:transmission_node:tx-2000:installed-upto-2014", "stated_by_id": "u00123"}
```

`item` validates against `ExtractedItem` (tested), so it can be used as `expected` for scripted mode or to score an LLM extractor. `reach` is the exact set of elements the knowledge should cover (precision/recall of linking and over-linking). Families:

| Family | What it tests |
| --- | --- |
| `class_workaround` | Advice for a model installed up to year N, seen on one node; verified / stated / hunch; sometimes a third person confirms on another node; sometimes repeated later in a second source |
| `instance_quirk` | One radio unit or power system, with conditions (after a storm, below −30 °C) |
| `site_access` + `site_access_change` | Gate keys, caretaker, winter road; the key later moves and the old access is closed (`valid_to`, `closed_by`) |
| `firmware_bug` + `firmware_fix` | A bug on a class, later fixed by a release: advice goes out of date |
| `expert_conflict` | Two experts give opposite advice on the same problem (`conflicts_with`) |
| hunch → verified (`instance_quirk`, `trust_history`) | A guess in one thread, confirmed by an expert weeks later: same fact, trust grows |

## Using it

- Core and bench: `Inventory.load(root / "network")`; `ctx dataset bench` feeds the linker with the true extractions, so it measures linking and storing, **not the LLM**. For the LLM, read threads of `conversations/` and score the output against `facts.jsonl`.
- The **Workbench loads everything in memory** and Cytoscape draws every node: use `tiny` or `demo` there, never `large`.
- Load shards lazily (one line at a time); do not `json.load` a whole shard of `large` (~80 MB each is fine, all of them is not).

## Findings from `ctx dataset bench` on `large` (2026-11-07)

Perfect extraction in, so this is the core alone: 3,000 / 3,000 facts linked with the exact scope, 0 over-bound, class reach identical to the ground truth for all 1,295 class facts.

1. **Duplicate site names are bound silently to the wrong site.** `Inventory._site_name` is a dict, so with two sites called the same the last one wins: 23 of 1,000 sampled exact names resolved to another site. The linker should treat a duplicated name as ambiguous and abstain.
2. **`ContextStore.add_assertion` scans every stored assertion** to look for the same knowledge: 2.6 ms median at 3,000 assertions (it grows linearly, so a bulk load is quadratic). Index by `_binding_key` if we ever load more than a few thousand.
3. `Linker.link` and `add_class` loop over all elements per class (p95 4 ms, max 90 ms at 20k elements); `Inventory.resolve_site` scans all site ids for suffix matches. Fine today, to index if the inventory grows.
4. Lookup (`get_context`) stays under 6 ms p95.

## Limits (be honest in the pitch)

- Language is template-based: a few dozen sentence patterns plus slots. An LLM extractor can do very well here and still fail on real chat. Keep the hand-written scenarios of the Workbench as the quality check; use this dataset for scale, volume, ambiguity and lifecycle.
- Only the 6 families above carry knowledge; real knowledge is more varied. Facts are independent: no fact depends on another beyond close / conflict.
- Timestamps cover Jan 2025 – Nov 2026 and ignore holidays; names are random combinations of common Finnish first and last names, any resemblance to real people is by chance. Emails use the reserved domain `demo-operator.example`.
- The data is not Elisa's and says nothing about Elisa's real network or staff.
