# Data model options

> **Status: proposal.** A starting schema to react to. Freeze it only after the idea is chosen; then every workstream codes against it.

## Entities that appear in every idea

| Entity | Key fields | Example |
| --- | --- | --- |
| `NetworkElement` | `id`, `type` (site, router, link, base station), `name`, `aliases[]`, `location` | `SITE-TKU-042`, alias "Kupittaa mast" |
| `Incident` | `id`, `opened_at`, `status`, `element_ids[]` | `INC-2026-1187` |
| `Message` | `id`, `source` (slack, discord, email), `channel`, `thread_id`, `author_id`, `sent_at`, `text` | a Slack line from the NOC channel |
| `Knowledge` | depends on the option below | |

## Three ways to represent a piece of knowledge

| Option | Shape | Good for | Weak at |
| --- | --- | --- | --- |
| **Fact triple** | `(subject, predicate, object)` + metadata | Graph queries, contradiction checks (ideas A, B, F) | Losing nuance of the original sentence |
| **Conditional rule** | `subject` + `condition` + `effect` + metadata | Proactive warnings (idea E) | Harder extraction, harder to evaluate |
| **Annotated snippet** | Original text span + linked entities + tags | Faithfulness, fast to build (idea C) | Machine consumers must interpret free text |

### Example: fact triple

```json
{
  "id": "fact_0193",
  "subject_id": "SITE-TKU-042",
  "predicate": "has_known_issue",
  "object": "backup microwave link degrades in heavy snow",
  "source_message_id": "msg_88412",
  "observed_at": "2026-01-14T08:22:00Z",
  "confidence": 0.82,
  "status": "active"
}
```

### Example: conditional rule

```json
{
  "id": "rule_0042",
  "subject_id": "SITE-TKU-042",
  "condition": {"signal": "snowfall_mm_per_h", "op": ">", "value": 5},
  "effect": "backup microwave link unreliable",
  "recommendation": "avoid failover to backup link",
  "source_message_id": "msg_88412",
  "observed_at": "2026-01-14T08:22:00Z",
  "confidence": 0.7
}
```

## Metadata every option should keep

These map to the dimensions Elisa named (time, trust, people) and to confidence and freshness:

- `source_message_id` + `quote`: every piece of knowledge traces back to its message.
- `observed_at`: when the message was sent (not when we ingested it), used for freshness.
- `last_confirmed` / `valid_until`: when the fact was last seen true, or stopped being true.
- `confidence`: extraction and linking confidence combined; hedges ("I think", "^^") lower it.
- `status`: e.g. `active`, `superseded`, `conflicting`.
- `author_id` + role: who said it, for trust. Privacy and GDPR are out of scope (per Elisa), so hashing is optional.

## Making the context exploitable

The output is read by a machine, with no human in between. Properties to aim for:

| Property | Why | Example |
| --- | --- | --- |
| Linked to a real ID | Workflows look up by element, not by sentence | `element_id: "SITE-TKU-042"` |
| Typed | Each workflow reads only what concerns it | `access`, `known_issue`, `workaround`, `condition`, `contact` |
| Actionable | Says what to do, not only what happened | `action: "get_key"`, `where: "neighbouring farm"` |
| Testable conditions | "Flaky in winter" becomes a rule a machine can evaluate | `condition: {"season": "winter"}` |
| Scored | The workflow sets its own threshold | `confidence: 0.82` |
| Fresh | Old facts weigh less | `last_confirmed: "2026-10-11"` |
| Traceable | An automated decision can be justified | source, quote, author |
| Deduplicated, conflicts visible | Ten messages saying the same thing make one stronger fact | `mentions: 10`, `conflicts_with: [...]` |

### Example: access fact

```json
{
  "id": "fact_0412",
  "element_id": "SITE-TKU-042",
  "type": "access",
  "fact": "Barrier key held at the neighbouring farm",
  "action": "get_key",
  "where": "neighbouring farm",
  "condition": null,
  "confidence": 0.82,
  "observed_at": "2024-03-02T09:10:00Z",
  "last_confirmed": "2026-10-11T14:03:00Z",
  "mentions": 3,
  "source": {"source": "email", "message_id": "msg_10233", "quote": "..."},
  "status": "active"
}
```

### Two output shapes (to discuss)

| Option | Good for | Weak at |
| --- | --- | --- |
| **Atomic facts** (one record per fact, as above) | Simple to produce, filter and evaluate | The workflow must aggregate |
| **Per-element profile** (everything known about one element, grouped by type, stale facts and conflicts resolved) | Directly usable by a workflow | More merging work |

Suggested (not decided): store atomic facts, build the per-element profile on request.

## Open points

- Fixed taxonomy of types and fields, or free text normalised later? To align with the context types Elisa's workflows use, if they share them.
- How to combine extraction confidence and linking confidence into one score?
- Does a contradiction supersede the old knowledge, or keep both with lower confidence?
