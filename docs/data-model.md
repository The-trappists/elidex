# Data model options

> **Status: proposal.** A starting schema to react to. Freeze it only after the idea is chosen; then every workstream codes against it.

Elisa's reference architecture fixes two points (see [challenge.md](challenge.md#elisas-network-model)): every piece of knowledge is a **context assertion bound to a graph entity**, and it has **`valid_from` / `valid_to`** (`valid_to` empty means "still believed true").

## Entities

| Entity | Key fields | Example |
| --- | --- | --- |
| `NetworkElement` | `id`, `type` (transmission node, site, link…), `model`, `install_year`, `aliases[]`, `location` | `TRN-042`, model from ~2019 |
| `ElementClass` | `id`, `criteria` (model, install year range, type) | "older transmission units, ~2019" |
| `Site` | `id`, `name`, `aliases[]`, `access` | the Northern Finland site behind a locked barrier |
| `Incident` | `id`, `opened_at`, `status`, `element_ids[]` | the SFP swap on TRN-042 |
| `Message` | `id`, `source` (teams, email), `thread_id`, `author_id`, `sent_at`, `text` | Erkki's "Don't trust the green link status" |
| `Person` | `id`, `role` (expert, field engineer) | Erkki, expert; Veikko, field engineer |
| `ContextAssertion` | see below | |

`ElementClass` exists because of Elisa's linking question: "these older units" may mean TRN-042 only, its model, or its install year. Binding to a class lets the rule reach **another** old node, which is what the demo's Reuse step needs.

## Three ways to represent an assertion

| Option | Shape | Good for | Weak at |
| --- | --- | --- | --- |
| **Fact triple** | `(subject, predicate, object)` + metadata | Graph queries, contradiction checks | Loses the conditions of a rule |
| **Conditional rule** | `subject` + `conditions` + `action` + `outcome` + metadata | Erkki's rule: symptoms → action; directly usable by an agent | Harder extraction, harder to evaluate |
| **Annotated snippet** | Original text span + linked entities + tags | Faithfulness, fast to build | The agent must interpret free text |

Erkki's case is naturally a conditional rule; the barrier key is a simple fact. A mix (rule when there are conditions, fact otherwise) is a reasonable option.

### Example: Erkki's rule

```json
{
  "id": "ctx_0001",
  "type": "workaround",
  "bound_to": [
    {"entity": "class:transmission-node-2019", "role": "applies_to"},
    {"entity": "TRN-042", "role": "observed_on"}
  ],
  "conditions": [
    "after SFP replacement",
    "link status UP",
    "optics normal",
    "traffic counters near zero"
  ],
  "diagnosis": "forwarding-state issue; green link status is misleading on these units",
  "action": "disable the interface, wait, enable it",
  "avoid": ["reboot", "replace SFP again"],
  "outcome": "traffic restored",
  "valid_from": "2026-03-12T10:41:00Z",
  "valid_to": null,
  "trust": {"level": "verified", "evidence": "Veikko: 'Traffic is back'", "stated_by": "person:erkki", "role": "expert"},
  "sources": [{"source": "teams", "message_ids": ["m03", "m05", "m07"]}, {"source": "email", "file": "email.txt"}],
  "confidence": 0.86,
  "status": "active"
}
```

### Example: access fact

```json
{
  "id": "ctx_0002",
  "type": "access",
  "bound_to": [{"entity": "SITE-NF-017", "role": "applies_to"}],
  "fact": "Barrier key held at the neighbouring farm",
  "action": "get the key before dispatch",
  "valid_from": "2024-03-02T09:10:00Z",
  "valid_to": null,
  "trust": {"level": "stated", "stated_by": "person:x"},
  "sources": [{"source": "email", "message_ids": ["msg_10233"]}],
  "confidence": 0.8,
  "status": "active"
}
```

IDs, dates and the site ID are illustrative; align them with Elisa's material and our synthetic inventory.

## Metadata every assertion keeps

These map to Elisa's five "hard" points:

| Field | Hard point | Note |
| --- | --- | --- |
| `bound_to[]` with roles | Linking | Instance vs. class; never bind when unsure (a wrong link is worse than none) |
| `valid_from` / `valid_to` | Time | `valid_to` null = still believed true; closed by a firmware fix, a new lock, a contradicting message |
| `trust` (`hunch`, `stated`, `verified`) + `stated_by` + role | Trust | "Traffic is back" upgrades a hunch to verified |
| `conflicts_with[]` | Trust | Two experts disagree: keep both, flag the conflict |
| `sources[]` + quotes | Trust, traceability | Every assertion traces back to its messages |
| `confidence` | Real knowledge | Extraction and linking confidence combined; hedges and 😄 do not mean low value |

## Making the context exploitable

The output is read by an agent, with no human in between. Properties to aim for:

| Property | Why | Example |
| --- | --- | --- |
| Bound to real entities | Agents look up by entity, not by sentence | `bound_to: TRN-042`, `class:transmission-node-2019` |
| Typed | Each workflow reads only what concerns it | `workaround`, `access`, `known_issue`, `config_reason`, `contact` |
| Actionable | Says what to do and what to avoid | `action`, `avoid` |
| Testable conditions | An agent can check them against telemetry | "counters near zero" |
| Time-valid | Agents query "true now" or "true at time T" | `valid_from` / `valid_to` |
| Trusted and traced | An automated action can be justified | `trust`, `sources` |
| Deduplicated, conflicts visible | Teams chat + email of the same case = one assertion, two sources | `sources[]`, `conflicts_with[]` |

### Two output shapes (to discuss)

| Option | Good for | Weak at |
| --- | --- | --- |
| **Atomic assertions** (as above) | Simple to produce, filter and evaluate | The agent must aggregate |
| **Per-entity profile** (everything valid now for one entity and its classes) | Directly usable by an agent | More merging work |

Suggested (not decided): store atomic assertions, build the per-entity profile on request.

## Open points

- Fixed taxonomy of types and fields, or free text normalised later?
- How to decide the class an assertion applies to (model, install year, type)?
- How to combine extraction and linking confidence into one score?
- Does a contradiction close the old assertion's validity, or keep both with a conflict flag?
