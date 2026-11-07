# Company-sized synthetic dataset

> Status: tool, not a decision. Nothing here is logged in [decisions.md](decisions.md). Generated on 2026-11-07 with Claude Code and reviewed by no one yet. **Everything is invented**; the only hand-written part is the Workbench seed (Elisa's TRN-042 and friends), which is kept inside the generated network.

Why: our hand-written data has 20 elements and a few dozen messages. Knowledge about "TX-3000 installed up to 2019" then reaches 4 nodes. In a real operator it reaches hundreds, the haystack has millions of messages, and two sites share a name. This dataset lets us test linking, over-linking, abstention and latency at that scale.

```bash
uv run ctx dataset generate --scale demo      # 150k threads, ~150 MB, 2 s
uv run ctx dataset generate --scale large     # 3M threads, ~3 GB, ~30 s on 12 workers
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

## Keeping it outside memory: MongoDB Atlas and Tiger Data

Both are MLH offers (see the resources page, section Cloud). Roles: **Atlas** holds the documents (threads, network, people, facts), **Tiger Data** (PostgreSQL + TimescaleDB) holds one row per message in a hypertable for questions over time. Neither stage loads a shard in memory: files are read line by line and sent in batches.

Setup (humans, once): create an Atlas cluster (check the storage and hourly price shown before using credit; the free tier is too small for `large`), a database user, and your IP and the Vultr VM's IP under Network Access; create a Tiger Data service. Put `MONGODB_URI`, `MONGODB_DB`, `TIGER_DATABASE_URL` in `.env` (placeholders in `.env.example`; `MONGODB_DB` is the *database* name, not the user).

```bash
uv run ctx dataset db-check                              # ping both, show what they hold
uv run ctx dataset load-mongo out/dataset/demo           # resumable; --drop to start over, --only threads
uv run ctx dataset load-tiger out/dataset/demo           # COPY into the hypertable; --drop to truncate first
uv run ctx dataset threads --source mongo --element TRN-042 --limit 5   # indexed query, no full load
uv run ctx dataset threads --source files --element TRN-042             # same, by scanning the shards
uv run ctx dataset activity TRN-042                      # Tiger Data: messages and people per month
```

Tiger Data service type matters: a **Time-series and analytics** service gives a TimescaleDB hypertable (`load-tiger` prints `Table mode: hypertable`); a plain **PostgreSQL** service works too (`Table mode: plain`: same table with a BRIN index on the date, and `activity` uses `date_trunc`). For the "Best Use of Tiger Data" prize, prefer the time-series type so the demo really uses TimescaleDB.

Analytics layer (Time-series service only): `load-tiger --analytics`, or `ctx dataset tiger-analytics` on data already loaded, compresses chunks older than 30 days and builds `message_mentions` plus the continuous aggregate `daily_mentions` (messages per element per day). `ctx dataset freshness TRN-042` then answers "when did humans last talk about this node?" from it. Both are safe to run again. `ctx dataset tiger-verify [folder]` prints a checklist (`ok` / `FAIL`) of what the project needs from Tiger Data: TimescaleDB present, `messages` is a hypertable, row count equal to the manifest, indexes, compression and its policy, `message_mentions`, `daily_mentions`, and a real query. It exits with code 1 if anything fails, so it can gate a deployment.

### Using the databases from the product

| What | Command or endpoint | Store |
| --- | --- | --- |
| Pipeline assertions and classes saved to Atlas | `ctx run --save-mongo` (cached extractions), or `ctx dataset bench out/dataset/large --save-mongo` (links the 3,000 ground-truth facts of `large`) | Atlas `assertions`, `classes` |
| Embed the knowledge text and create the vector index | `ctx dataset embed --collection assertions` (or `facts`) | Atlas field `embedding`, index `<collection>_vector`, mode recorded in `meta` |
| Knowledge nearest to a sentence | `ctx dataset similar "port stays down after SFP swap" --collection assertions`, or `GET /similar?q=...` | Atlas `$vectorSearch` |
| When humans last talked about an element | `ctx dataset freshness TRN-042`, or `GET /freshness/TRN-042` (adds `days_since`) | Tiger `daily_mentions` |

Tested with `EMBEDDING_MODEL=gemini-embedding-001` on Gemini's OpenAI-compatible endpoint (3,072-dimension vectors, text only; `gemini-embedding-2` needs a text prefix that we do not add). That endpoint leaves the response `index` empty, which the code handles. To switch model, run `ctx dataset embed --reset`. Embeddings come from `EMBEDDING_MODEL` (an OpenAI-compatible embedding model on the primary LLM provider). Left empty, an offline fallback hashes words: it finds texts with similar *wording*, not similar *meaning*, so use a real model for the demo. The mode and the vector size are stored with the vectors and a mismatch is refused. Atlas builds the vector index in the background, give it a few minutes before the first `similar`. Not run by the assistant against the real services (credentials): the first run is yours.

### On the deployed version (Vultr)

The two databases are in the cloud, so the VM needs **no copy of the dataset**: load once from your laptop, with the same URIs, and the app only reads.
1. Add `MONGODB_URI`, `MONGODB_DB`, `TIGER_DATABASE_URL` to the `.env` on the VM (`deploy/docker-compose.yml` passes `.env` to the container with `env_file`). Never commit them.
2. In Atlas, Network Access: add the VM's public IP. Tiger Data may need the same, check the service settings.
3. Redeploy: `docker compose -f deploy/docker-compose.yml --env-file .env up -d --build` (the image installs `pymongo` and `psycopg` from `uv.lock`).
4. Check from the VM: `docker compose -f deploy/docker-compose.yml exec <app-service> ctx dataset db-check` (service name in the compose file).
5. Run the loads from your laptop, not the VM (the 2 GB VM has no `out/dataset/`): `ctx dataset load-mongo out/dataset/demo`, `load-tiger out/dataset/demo --drop --analytics`.

Start with `demo` to check sizes and timings, then `large`. `load-mongo` makes the indexes after the load; threads carry `started_at` and `mentions` (element ids found in the text, aliases resolved) so "all threads about this element" is an index lookup. Code: `dataset/source.py` (`FileSource` and `MongoSource` share `ThreadSource.threads(since, until, element, limit)`), `mongo.py`, `tiger.py`. Not done yet: the Workbench still keeps its own threads in memory and does not read these sources.

Status: the pure parts (mentions, documents, rows, file source) are tested offline. The loaders and queries against real Atlas and Tiger Data were **not run by the assistant** (AI agents must not use `.env` credentials), so the first run is yours: start with `db-check`.

### Measured on the real services (`large`, 2026-11-07, loaded from a laptop)

| | MongoDB Atlas (10 GB cluster, 0.08 $/h) | Tiger Data (Time-series service, PostgreSQL 18, TimescaleDB) |
| --- | --- | --- |
| Loaded | 3,000,000 threads (+ sites, links, elements, users, facts) | 13,772,400 messages |
| Time | 466 s for the threads, then the index build | 735 s including the analytics layer |
| Size | `threads`: 3,423 MB of data, **1,206 MB on disk** (compressed) + 186 MB of indexes; the whole database is about 1.4 GB of the 10 GB | 4,913 MB right after the load (compression of chunks older than 30 days runs later as a background job) |
| `demo` for comparison | 150,000 threads in 34 s | 687,697 messages |

`tiger-verify` passes on `large`, every line `ok`: 13,772,400 rows, 897,169 rows in `message_mentions`, 739,624 in `daily_mentions`. Example answers: `freshness TRN-042` gives "last discussed 2026-09-02, 14 messages over 12 active days"; `activity TRN-042 --bucket "1 month"` lists messages and people per month. At this size `xl` (about three times `large`) would still fit 10 GB in Atlas, but it was dropped as useless for the demo. Elements named per message average 0.07: most messages are noise, which is the point of the haystack.

## Using it

- Core and bench: `Inventory.load(root / "network")`; `ctx dataset bench` feeds the linker with the true extractions, so it measures linking and storing, **not the LLM**. For the LLM, read threads of `conversations/` and score the output against `facts.jsonl`.
- The **Workbench loads everything in memory** and Cytoscape draws every node: never `large`. Take a sample instead: `ctx dataset export-workbench out/dataset/tiny` (or the Data page button "Load company dataset"), see [workbench.md](workbench.md#company-dataset-sample).
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
