# Outcome unification: design note

Status: proposal implemented on branch `unify-outcomes`. Nothing here is decided until it is logged in [decisions.md](decisions.md).

## Question

Two field-outcome mechanisms exist and share no state:

- **A, thread-based (loop v2)**: `outcome.py`, `RuleApplication`, `GET /applications`. A technician's reply in the thread decides worked or failed. It changes `trust` and `confidence`, never `Assertion.outcomes`.
- **B, observation-based (main)**: `mvp/feedback.py`, `POST /agent/outcome`, `Assertion.outcomes`, `track_record`. Post-action observations decide. It changes `track_record`, never trust or confidence.

Does unifying give a better system?

## Verdict: yes, with a small change

What is better:

- **No more split truth.** Today a "failed" application lowers confidence but does not count in `track_record`, so the guard (which reads `track_record`) never sees a failure that a human reported. After unifying, a human saying "still down" can make a rule `contested` and the guard warns.
- **Fewer double counts.** One real field event can today be recorded by both mechanisms. After: one ledger, and each event is recorded once (see below).
- **One trust/confidence rule**, applied from the ledger, instead of two unrelated ones.
- **One API shape**: `track_record` is a dict everywhere (a string in `/agent/run` and a dict in the LLM payload today).

Risks, and how they are contained:

- **Double counting the same event** is the main risk of merging. Mitigation: dedupe by application id, and an observation outcome resolves the matching pending application so a later reply does not count again.
- **Regression of main's accuracy eval**: `feedback.record` and `judge` keep their behaviour; the eval replays through `record` and never goes through the new effects code, so its numbers do not move. New Outcome fields are optional.
- **Complexity before a demo**: the change is small (one ledger, one settle function, no new endpoint, no UI rewrite). The API shape change of `track_record` is the only breaking part; the UI does not read it.

## Design

- `Assertion.outcomes` is the single ledger. `Outcome` gets optional `source` (`observation` default, or `thread`), `application_id`, `quote`.
- `RuleApplication` stays the link between an agent action and its thread. Its `method` may now also be `observation`.
- Both paths record through `mvp/feedback.py`, then call one function, `outcome.settle`, that applies the effects once per recorded outcome:
  - failed: confidence x0.7 and a `low_confidence` flag (one per failed outcome; observation failures now do this too);
  - worked and no failed outcome in the ledger, from a human reply: trust `verified` (the reply's author added to `confirmed_by`, `stated_by` keeps the rule's author, evidence the quote), thread added as source, `judge_decision` flag;
  - worked but the ledger also holds a failure: mixed evidence, trust is not upgraded, a flag says so;
  - observation-based worked: trust unchanged (a machine observation is not a person's word), as in main.
- `track_record.status` keeps main's rule (contested = at least 2 failures and more failures than successes). A rule is never auto-dropped.
- Dedupe: a thread outcome carries its application id and is recorded once per application; `/agent/outcome` resolves pending applications of the same assertion and entity (method `observation`), so they are never decided again.
- `track_record` shape everywhere: `{status, worked, failed, failed_on, thread, last_at}`.
