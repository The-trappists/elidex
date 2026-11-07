# Failed Tests Log: Adversarial & Stress Scenarios

This log documents specific test failures observed when running the codebase against adversarial human input scenarios (without modifying any system source code).

---

## Summary of Failures

| Test Name | Scenario Origin | Component | Failure Type | Severity |
| :--- | :--- | :--- | :--- | :--- |
| **Same-Timestamp Invalidation Failure** | `adversarial-rant-sodankyla-key` | `lifecycle.reconcile` | Stale data left open | **CRITICAL** |
| **Silent Merge of Conflicting Facts** | `adversarial-layperson-cleaning-lady` | `store.same_knowledge` | Erroneous data merge | **CRITICAL** |
| **Guard Prohibition Misclassification** | `adversarial-unparseable-slang-mixed` | `guard.verbs_in` | Semantic inversion | **HIGH** |
| **Unmapped Layperson Entity Resolution** | `adversarial-layperson-cleaning-lady` | `link.Linker` | Silent abstention | **MEDIUM** |
| **Fragile Substring Site Resolution** | `adversarial-rant-sodankyla-key` | `link.Inventory` | Fragile matching | **LOW** |

---

## Detailed Failure Logs

### 1. Same-Timestamp Invalidation Failure
- **Component**: [`src/context_layer/mvp/lifecycle.py`](file:///home/mnlrc/Documents/since-ai-hackathon/src/context_layer/mvp/lifecycle.py#L31)
- **Scenario Tested**: `adversarial-rant-sodankyla-key.json`
- **Severity**: `CRITICAL`
- **Trace / Error Details**:
  ```python
  # Input:
  # Old assertion: ctx_001 (padlock code 1234) valid_from = 2026-11-07 10:00:00
  # New invalidation: ctx_002 (lock frozen, replaced) valid_from = 2026-11-07 10:00:00
  Assertion ctx_001 was not invalidated because old.valid_from (2026-11-07 10:00:00) >= new.valid_from (2026-11-07 10:00:00).
  ctx_001.valid_to remains None.
  ```
- **Observed Behavior**: Invalidation occurring in the same message or conversation thread as the obsolete knowledge (identical `valid_from`) is skipped by the check `old.valid_from >= new.valid_from`. The obsolete rule remains active indefinitely.

---

### 2. Silent Merge of Conflicting Facts
- **Component**: [`src/context_layer/store.py`](file:///home/mnlrc/Documents/since-ai-hackathon/src/context_layer/store.py#L28-L38)
- **Scenario Tested**: `adversarial-layperson-cleaning-lady.json`
- **Severity**: `CRITICAL`
- **Trace / Error Details**:
  ```python
  # Input:
  # Author 1 (Pirjo): "Vibration caused by floor scrubber" (action=None)
  # Author 2 (Helmi): "Vibration caused by faulty chassis fan" (action=None)
  same_knowledge(a_fact1, a_fact2) -> True
  ```
- **Observed Behavior**: When evaluating two purely factual assertions (`action=None`) from different people, `same_action` calculates `" ".join("".split()) == " ".join("".split())` which evaluates to `True`. The system concludes both specialists said the exact same thing, merges them, and fails to flag the diagnostic disagreement.

---

### 3. Guard Prohibition Misclassification
- **Component**: [`src/context_layer/mvp/guard.py`](file:///home/mnlrc/Documents/since-ai-hackathon/src/context_layer/mvp/guard.py#L23-L26)
- **Scenario Tested**: `adversarial-unparseable-slang-mixed.json`
- **Severity**: `HIGH`
- **Trace / Error Details**:
  ```python
  # Input text:
  text = "Never reboot TRN-117"
  verbs_in(text) -> {'reboot'}
  ```
- **Observed Behavior**: The guard regex matches `"reboot"` inside `"Never reboot"`. The guard interprets a strict prohibition/avoidance directive as an intentional reboot command, leading to inverted policy decisions.

---

### 4. Unmapped Layperson Entity Resolution Failure
- **Component**: [`src/context_layer/link.py`](file:///home/mnlrc/Documents/since-ai-hackathon/src/context_layer/link.py#L59-L62)
- **Scenario Tested**: `adversarial-layperson-cleaning-lady.json`
- **Severity**: `MEDIUM`
- **Trace / Error Details**:
  ```python
  inv.resolve_element("giant black metal fridge") -> None
  linker.link(...) -> LinkResult(assertion=None, notes=["unknown element 'giant black metal fridge': not bound", "abstained 'vibration-alert': nothing to bind it to"])
  ```
- **Observed Behavior**: Colloquial descriptions used by non-telecom staff fail inventory resolution completely and are silently discarded unless manually aliased beforehand.

---

### 5. Fragile Substring Site Resolution
- **Component**: [`src/context_layer/link.py`](file:///home/mnlrc/Documents/since-ai-hackathon/src/context_layer/link.py#L77-L79)
- **Scenario Tested**: `adversarial-rant-sodankyla-key.json`
- **Severity**: `LOW`
- **Trace / Error Details**:
  ```python
  inv.resolve_site("harbour") -> SITE-TKU-009
  ```
- **Observed Behavior**: Site resolution matches any string with $\ge 6$ characters that appears as a substring within a site name. If another harbour site is registered in the future, resolution silently collapses to `None` without warning.
