# Adversarial & Edge Case Analysis: Conclusions

This report synthesizes the adversarial evaluation of the Context Layer pipeline (`Listen` → `Understand` → `Link` → `Store` → `Reconcile` → `Guard`). It evaluates the divergence between what is displayed on the Workbench UI versus the actual underlying logic failures uncovered when processing human communication ranging from slight ambiguity to heavy colloquialisms, emotional venting, contradictory folk cures, and corrupted inputs.

---

## 1. Executive Summary

When running the 5 adversarial stress scenarios through the Workbench UI:
- **Frontend Perception**: The pipeline reports execution success (green indicators, resolved jobs, extracted entities, and Cytoscape graph nodes).
- **Core Logic Reality**: Critical semantic and temporal failures occur silently under the hood. Specifically, obsolete procedures remain valid forever, conflicting diagnostic facts are silently merged and erased, and safety avoidances are inverted into commands.

---

## 2. Key Findings & The "UI vs Reality" Disconnect

### A. Lifecycle & Invalidation: The Same-Timestamp Freeze
- **Observed in**: `adversarial-rant-sodankyla-key.json` (Sodankylä barrier lock replacement).
- **UI Presentation**: The conversation shows an `invalidation` item for old lock `1234` and an `access` item for new lock `8842`. Both appear in the Knowledge table.
- **Underlying Failure**:
  In [`src/context_layer/mvp/lifecycle.py`](file:///home/mnlrc/Documents/since-ai-hackathon/src/context_layer/mvp/lifecycle.py#L31):
  ```python
  if old.type == "invalidation" or old.valid_to is not None or old.valid_from >= new.valid_from:
      continue
  ```
  When the invalidation is emitted in the same thread as the obsolete fact, `old.valid_from >= new.valid_from` evaluates to `True`. The old assertion is **never closed** (`valid_to` remains `None`). Any querying autonomous agent receives both the dead lock code `1234` and the new code `8842` simultaneously.

---

### B. Store & Deduplication: Silent Erasure of Conflicting Facts
- **Observed in**: `adversarial-layperson-cleaning-lady.json` (Vibrating cabinet diagnostics).
- **UI Presentation**: The Knowledge page displays a single stored fact with elevated confidence.
- **Underlying Failure**:
  In [`src/context_layer/store.py`](file:///home/mnlrc/Documents/since-ai-hackathon/src/context_layer/store.py#L36-L37):
  ```python
  same_action = " ".join((old.action or "").lower().split()) == " ".join((new.action or "").lower().split())
  return old.trust.stated_by == new.trust.stated_by or same_action
  ```
  When specialists state differing explanations or facts where `action` is `None`, `same_action` calculates `"" == "" -> True`. The system treats two opposing statements from different people as the exact same knowledge, merges them, and overwrites evidence without flagging disagreement.

---

### C. Guard Safety: Negation Inversion
- **Observed in**: `adversarial-unparseable-slang-mixed.json` (Finglish slang warning against rebooting dead optical ports).
- **UI Presentation**: The workaround is extracted stating: *"Do not reboot tx-3000 if an optical port is dead"*.
- **Underlying Failure**:
  In [`src/context_layer/mvp/guard.py`](file:///home/mnlrc/Documents/since-ai-hackathon/src/context_layer/mvp/guard.py#L23-L26):
  ```python
  def verbs_in(text: str) -> set[str]:
      return {verb for verb, words in VERBS.items() if any(re.search(rf"\b{re.escape(w)}", text) for w in words)}
  ```
  If an operator submits an intent like `"Never reboot TRN-117"`, regex keyword matching identifies `"reboot"`. The guard cannot detect semantic negation (`never`, `avoid`, `do not`) and treats a prohibition as an intent to execute the action.

---

### D. Linker Scope: Layperson Entity Dropping & Substring Fragility
- **Observed in**: `adversarial-layperson-cleaning-lady.json` and `adversarial-rant-sodankyla-key.json`.
- **Underlying Failure**:
  - Non-technical vocabulary (*"giant black metal fridge"*, *"yellow rubber noodle"*) fails exact/alias inventory resolution. If a technical peer does not translate the lay description later in the thread, the operational knowledge is discarded with no fallback to site-level association.
  - Substring matching for sites (`len(key) >= 6 in s.name`) resolves keywords like `"harbour"` to `SITE-TKU-009`. If a second harbour site is ever provisioned, this resolution collapses to `None`.

---

## 3. Confrontation Matrix

| Stress Vector | Tested Scenario | What the UI Shows | Logic Reality / Code Flaw |
| :--- | :--- | :--- | :--- |
| **Obsolete Codes & Invalidation** | `adversarial-rant-sodankyla-key` | Invalidation and replacement items listed cleanly in Knowledge tab | `old.valid_from >= new.valid_from` check fails to close old assertion; stale code remains active. |
| **Disagreement on Facts** | `adversarial-layperson-cleaning-lady` | Single assertion listed with high confidence | `action=None` causes `same_action` to evaluate `True`, silently merging conflicting viewpoints. |
| **Prohibition Directives** | `adversarial-unparseable-slang-mixed` | Workaround stored instructing operator not to reboot | Guard regex parses `"Never reboot"` as verb `reboot`, inverting the human intent. |
| **Unmapped Lay Descriptions** | `adversarial-layperson-cleaning-lady` | Pipeline shows successful run | Layperson terms without exact inventory aliases are discarded during linking. |
| **Multi-Doctor Contradictions** | `adversarial-conflicting-folk-cures` | Graph page renders red dashed conflict edges | While properly flagged, conflicting actions cannot be programmatically arbitrated by an agent. |

---

## 4. Conclusion & Recommendations

The pipeline exhibits notable strengths in handling unstructured text and identifying multi-party disagreements when actions are distinct. However, production readiness requires hardening the foundational logic:

1. **Fix Invalidation Strictness**: Compare message sequence numbers or change `old.valid_from >= new.valid_from` to `old.valid_from > new.valid_from` so intra-thread invalidations close older assertions.
2. **Require Actions for Action Matching**: In `same_knowledge`, only consider `same_action` if both `old.action` and `new.action` are non-empty strings.
3. **Parse Negations in Guard**: Add basic syntactic negation parsing (`not`, `never`, `don't`) before categorizing actions into planned verb sets.
4. **Hierarchical Fallback for Layperson Linking**: When an element alias cannot be matched, link the observation to the parent site with an `"unmapped_element"` flag rather than dropping the knowledge.
