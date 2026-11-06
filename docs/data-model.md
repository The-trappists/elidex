# Data model options

> **Status: proposal.** A starting schema to react to. Freeze it only after the idea is chosen; then every workstream codes against it.

## Entities that appear in every idea

| Entity | Key fields | Example |
| --- | --- | --- |
| `NetworkElement` | `id`, `type` (site, router, link, base station), `name`, `aliases[]`, `location` | `SITE-TKU-042`, alias "Kupittaa mast" |
| `Incident` | `id`, `opened_at`, `status`, `element_ids[]` | `INC-2026-1187` |
| `Message` | `id`, `channel` (chat, email, ticket), `author_hash`, `sent_at`, `text` | a chat line from the NOC channel |
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

These map directly to the challenge requirements (confidence, freshness, privacy):

- `source_message_id`: every piece of knowledge traces back to its message.
- `observed_at`: when the message was sent (not when we ingested it), used for freshness.
- `confidence`: extraction and linking confidence combined.
- `status`: e.g. `active`, `superseded`, `needs_review`.
- `author_hash`: never the author's name.

## Open points

- Fixed list of predicates, or free text normalised later?
- How to combine extraction confidence and linking confidence into one score?
- Does a contradiction supersede the old knowledge, or keep both with lower confidence?
