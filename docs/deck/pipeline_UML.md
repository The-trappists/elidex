# Technical Pipeline: From Slack Message to Knowledge Node

This document details the complete end-to-end technical pipeline implemented on `main` that transforms unstructured human messages in Slack into structured, temporal, linked **Knowledge Nodes** within the operational Knowledge Graph.

---

## 1. End-to-End Architectural Pipeline

```mermaid
flowchart TD
    subgraph INGESTION["1. Ingestion & Event Handling"]
        SLACK["Slack Channel / Thread<br/>(Technician writes message)"]
        SOCKET["SlackBridge (Socket Mode)<br/>AsyncSocketModeHandler"]
        FILTER{"Filter Event<br/>- Ignore bots<br/>- Ignore self<br/>- Validate text"}
        RESOLVE["users.info API<br/>Extract real name & title"]
        THREAD_MAP{"Thread lookup<br/>thread_ts match?"}
        APPEND["Append to existing LiveThread"]
        NEW_TH["Create new LiveThread"]
    end

    subgraph SCHEDULER["2. Debounce & Job Scheduling"]
        POST["wb.post_message()"]
        DEBOUNCE["Idle Timer (2.0s debounce)<br/>Wait for human typing bursts"]
        LAUNCH["processor._launch()<br/>Acquire job lock"]
        JOB["Initialize PipelineJob<br/>[listen, understand, link, store, reconcile]"]
    end

    subgraph UNDERSTAND_STAGE["3. Understand Stage"]
        LISTEN["Stage Listen<br/>LiveThread.to_thread()"]
        PROMPT["Build Prompt<br/>Conversation + Known Topics"]
        LLM_EXTRACT["LLMExtractor<br/>Structured JSON Schema"]
        CRITIC_STEP_A{"Critic Step A<br/>Deterministic:<br/>evidence_quote in text?"}
        CRITIC_STEP_B{"Critic Step B<br/>LLM Critic Check:<br/>Scope, Vague Words, Support"}
        ITEMS["Validated ExtractedItem(s)"]
    end

    subgraph LINK_STAGE["4. Link Stage (Precision-First)"]
        INV[("Inventory<br/>Elements, Sites, Aliases")]
        CHECK_AUTHOR{"Author in thread?"}
        RESOLVE_ENTITIES{"Resolve Scope<br/>Named in thread & Inventory?"}
        CLASS_CRITERIA{"Class Criteria<br/>Specific & contains instances?"}
        BINDINGS["Assign Binding Roles:<br/>- applies_to<br/>- observed_on<br/>- trigger"]
        ASSERTION["Construct ContextAssertion<br/>(valid_from, trust, source_ref)"]
    end

    subgraph STORE_STAGE["5. Store & Deduplication"]
        RETRACT["retract(thread_id)<br/>Idempotency cleanup"]
        DEDUP{"same_knowledge()?<br/>Same binding + author/advice"}
        MERGE["Merge into existing assertion<br/>Combine sources & upgrade trust"]
        STORE_NEW["Add new assertion<br/>Assign ctx_XXXX ID"]
    end

    subgraph LIFECYCLE_STAGE["6. Multi-Agent Arbitration & Lifecycle"]
        JUDGE{"Judge Agent (LLM)<br/>Compare against neighbours"}
        JUDGE_ACTION["Apply Verdict:<br/>supersedes / contradicts / supports"]
        RECONCILE["lifecycle.reconcile()<br/>Reach coverage check<br/>Set valid_to / conflicts_with"]
    end

    subgraph GRAPH_STAGE["7. Knowledge Graph Projection"]
        KG[("KnowledgeGraph<br/>NetworkX / Neo4j Mirror")]
        NODE_ASSERTION["(Assertion: ctx_XXXX)"]
        NODE_MSG["(Message: msg:id#seq)"]
        NODE_PERSON["(Person: name)"]
        NODE_ENTITY["(Element | Class | Site | Event)"]
    end

    SLACK --> SOCKET
    SOCKET --> FILTER
    FILTER -- Valid human message --> RESOLVE
    RESOLVE --> THREAD_MAP
    THREAD_MAP -- Root ts exists --> APPEND
    THREAD_MAP -- New conversation --> NEW_TH
    APPEND --> POST
    NEW_TH --> POST

    POST --> DEBOUNCE
    DEBOUNCE --> LAUNCH
    LAUNCH --> JOB
    JOB --> LISTEN

    LISTEN --> PROMPT
    PROMPT --> LLM_EXTRACT
    LLM_EXTRACT --> CRITIC_STEP_A
    CRITIC_STEP_A -- Missing quote: penalty x0.7 --> CRITIC_STEP_B
    CRITIC_STEP_A -- Quote verified --> CRITIC_STEP_B
    CRITIC_STEP_B -- Reject --> DROPPED["Item Dropped"]
    CRITIC_STEP_B -- Downgrade / Keep --> ITEMS

    ITEMS --> CHECK_AUTHOR
    INV --> RESOLVE_ENTITIES
    CHECK_AUTHOR --> RESOLVE_ENTITIES
    RESOLVE_ENTITIES --> CLASS_CRITERIA
    CLASS_CRITERIA --> BINDINGS
    BINDINGS --> ASSERTION

    ASSERTION --> RETRACT
    RETRACT --> DEDUP
    DEDUP -- True --> MERGE
    DEDUP -- False --> STORE_NEW

    STORE_NEW --> JUDGE
    JUDGE --> JUDGE_ACTION
    JUDGE_ACTION --> RECONCILE
    MERGE --> RECONCILE

    RECONCILE --> KG
    KG --> NODE_ASSERTION
    KG --> NODE_MSG
    KG --> NODE_PERSON
    KG --> NODE_ENTITY
```

---

## 2. Detailed Execution Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Tech as Network Engineer (Slack)
    participant Bridge as SlackBridge (Socket Mode)
    participant WB as Dashboard State
    participant Proc as Pipeline Processor
    participant LLM as LLMExtractor
    participant Critic as Critic Agent
    participant Linker as Linker & Inventory
    participant Store as ContextStore
    participant Judge as Judge Agent
    participant KG as KnowledgeGraph

    Tech->>Bridge: "On TRN-042 after SFP replacement, bounce interface if DOWN"
    Note over Bridge: Filter bot/system messages
    Bridge->>Bridge: Resolve user via slack.users.info (author, role)
    Bridge->>WB: post_message(thread_id, author, text, role)
    WB->>Proc: request(thread_id, immediate=False)
    Note over Proc: Debounce timer started (idle_seconds = 2.0s)
    
    rect rgb(240, 248, 255)
        Note over Proc: Idle timer expires; lock acquired
        Proc->>Proc: Create PipelineJob(thread_id)
        Proc->>LLM: extract(core_thread, known_topics)
        LLM-->>Proc: ExtractionResult([ExtractedItem])
    end

    rect rgb(255, 245, 238)
        Note over Proc,Critic: Hook: after_understand
        Proc->>Critic: Review item (Step A: quote check, Step B: LLM review)
        Critic-->>Proc: Verdict: keep / downgrade / reject
    end

    rect rgb(245, 255, 245)
        Note over Proc,Linker: Stage: Link
        Proc->>Linker: link(item, core_thread)
        Linker->>Linker: Verify author in thread
        Linker->>Linker: Resolve TRN-042 & match text mentions
        Linker->>Linker: Infer ElementClass & assign binding roles
        Linker-->>Proc: LinkResult(ContextAssertion)
    end

    rect rgb(255, 250, 240)
        Note over Proc,Store: Stage: Store
        Proc->>Store: retract(thread_id) [idempotent cleanup]
        Proc->>Store: add_assertion(assertion)
        Store->>Store: same_knowledge() check
        Store-->>Proc: (stored_assertion, is_new=True)
    end

    rect rgb(250, 240, 255)
        Note over Proc,Judge: Hook: after_store
        Proc->>Judge: Compare with stored candidate neighbours
        Judge-->>Proc: Verdicts: supersedes / contradicts / supports
        Proc->>Proc: lifecycle.reconcile() [reach-based invalidation]
    end

    rect rgb(240, 255, 255)
        Note over Proc,KG: Knowledge Graph Projection
        Proc->>KG: Project ContextStore + Messages into Graph
        KG->>KG: Create Node: Assertion(ctx_0001)
        KG->>KG: Create Node: Message(msg:slack_ts#1)
        KG->>KG: Create Node: Person(stated_by)
        KG->>KG: Add Edges: DERIVED_FROM, STATED_BY, APPLIES_TO, OBSERVED_ON
    end
```

---

## 3. Data Transformation Pipeline

The table below shows the exact data transformation contract from the raw Slack payload to the final Knowledge Graph entity:

```mermaid
flowchart LR
    RAW["Slack Event JSON<br/>- text<br/>- user<br/>- ts, thread_ts"] --> MSG["Message & LiveThread<br/>- author: 'Erkki Expert'<br/>- role: 'Network Specialist'<br/>- source: 'slack'"]
    MSG --> ITEM["ExtractedItem<br/>- topic: 'sfp-bounce-trn'<br/>- scope: TRN-042, TX-3000<br/>- action: 'bounce interface'<br/>- conditions: status == DOWN<br/>- confidence: 0.85"]
    ITEM --> ASSERTION["ContextAssertion (ctx_0001)<br/>- bound_to: [class, element, trigger]<br/>- valid_from: 2026-11-07T14:30<br/>- trust: stated (Erkki)<br/>- sources: [slack #1]"]
    ASSERTION --> GRAPH["Knowledge Graph Subgraph<br/>- (ctx_0001)-[:APPLIES_TO]->(class)<br/>- (ctx_0001)-[:OBSERVED_ON]->(TRN-042)<br/>- (ctx_0001)-[:DERIVED_FROM]->(msg)<br/>- (ctx_0001)-[:STATED_BY]->(Erkki)"]
```

---

## 4. Step-by-Step Technical Breakdown

### Step 1: Slack Ingestion & Normalization ([slack_bridge.py](file:///home/matteo/Projects/since-ai/src/context_layer/dashboard/slack_bridge.py#L154-L188))
- **Socket Mode Listener**: Connected via Slack App-Level Token (`xapp-...`) and Bot User Token (`xoxb-...`).
- **Event Filtering**: Discards bot events (`bot_id`, `IGNORED_SUBTYPES`: `bot_message`, `message_changed`, `message_deleted`, `channel_join`), self-messages, and empty payloads.
- **Identity Resolution**: Queries Slack API `users.info(user=user_id)` to resolve the real human name and job title (`profile.title`).
- **Thread Correlating**:
  - Checks if `thread_ts` links to an active conversation in `wb.thread_by_slack_ts(root_ts)`.
  - If found: Appends the message to the existing thread.
  - If new: Instantiates a `LiveThread` with `origin="slack"` and records the thread anchor.
- Calls `wb.post_message(thread_id, author=name, text=text, role=title, mirror=False)`.

### Step 2: Event Bus & Idle Debounce ([processor.py](file:///home/matteo/Projects/since-ai/src/context_layer/dashboard/processor.py#L167-L198))
- Network specialists rarely send operational knowledge in a single sentence; they write multi-line explanations or follow-ups.
- `processor.request(thread_id, immediate=False)` schedules a debounce timer (`wb.settings.idle_seconds`, default `2.0s`).
- Successive messages in the same thread reset the timer.
- When quiet, `processor._launch(thread_id)` triggers a worker task on the `asyncio` event loop.
- Uses an `asyncio.Lock` to guarantee that concurrent threads don't race on store mutations.

### Step 3: Understanding via LLM Extraction ([understand.py](file:///home/matteo/Projects/since-ai/src/context_layer/understand.py#L61-L97))
- Assembles full thread context into `models.Thread`.
- Passes the list of currently known topic slugs (`known_topics`) to promote deduplication and topic reuse across channels.
- Invokes `LLMExtractor`:
  - Strict system prompt requiring Pydantic JSON Schema validation (`ExtractionResult`).
  - Instructs the model: *extract only operational rules or facts*, *never diagnose faults yourself*, *copy entity IDs verbatim*, *flag vague scope words* (`qualifier: "old"`).
  - Produces structured `ExtractedItem` objects.

### Step 4: Critic Verification Hook ([critic.py](file:///home/matteo/Projects/since-ai/src/context_layer/critic.py#L29-L90))
- Runs on the `after_understand` hook before any entities are linked:
  1. **Deterministic Evidence Check**: Validates that `item.evidence_quote` matches verbatim text in the cited message sequence. If fabricated or hallucinated, applies a penalty: `confidence = confidence * 0.7`.
  2. **LLM Critic Review**: A secondary LLM prompt reviews each item for:
     - **Scope inflation**: Did the author mention a specific unit while the extractor bound an entire class or site?
     - **Vague word leakage**: Was a word like "legacy" converted into an unsubstantiated install-year filter?
     - **Truthfulness**: Does the cited text genuinely back the action?
  - Verdicts: `keep`, `downgrade` (sets lower `confidence_after`), or `reject` (discards item).

### Step 5: Precision Linking ([link.py](file:///home/matteo/Projects/since-ai/src/context_layer/link.py#L200-L291))
- Adheres to the principle: **A wrong link is worse than none (abstain rather than guess)**.
- **Author Verification**: Verifies `stated_by` corresponds to a verified speaker in the thread.
- **Entity Resolution**:
  - Matches element IDs against `Inventory` (including aliases like `TRN42` -> `TRN-042`).
  - Regex check (`mention_pattern`) confirms the entity was literally mentioned in the text.
- **ElementClass Scope Validation**:
  - Resolves `ClassCriteria(type, model, install_year_min, install_year_max)`.
  - Rejects classes that are too broad (e.g., "all elements") or that exclude the unit the thread is specifically discussing.
  - If a vague qualifier word was present (`qualifier="old"`), multiplies confidence by `0.8` with an explicit audit note (`"class wider than stated"`).
- **Role Binding**:
  - `applies_to`: Target of the advice (the `ElementClass`, specific `NetworkElement`, or `Site` if local).
  - `observed_on`: Specific element instance where the issue was observed.
  - `trigger`: Event slug (e.g. `event:sfp-replacement`).

### Step 6: Store Deduplication & Idempotence ([store.py](file:///home/matteo/Projects/since-ai/src/context_layer/store.py#L73-L135))
- **Retraction**: `processor.retract(thread_id)` drops earlier assertions derived solely from this thread, ensuring re-processing is completely idempotent.
- **Deduplication Check (`same_knowledge`)**:
  - Compares `(type, topic, bound_to)` and checks if author or advice matches.
  - **If match exists**: Merges sources, sets `valid_from = min(...)`, `confidence = max(...)`, and calls `trust.add_confirmation(...)`.
  - **If new assertion**: Generates ID (`ctx_0001`), saves in store index, and creates graph edges.

### Step 7: Judge Arbitration & Reconcile ([judge.py](file:///home/matteo/Projects/since-ai/src/context_layer/judge.py#L30-L75), [lifecycle.py](file:///home/matteo/Projects/since-ai/src/context_layer/mvp/lifecycle.py#L27-L72))
- **LLM Judge**: Compares new assertion against up to 8 candidate assertions retrieved by topology bindings:
  - `supersedes`: Closes older candidate (`valid_to = new.valid_from`, `closed_by = new.id`).
  - `contradicts`: Flags bidirectional conflict in `conflicts_with`.
  - `supports`: Adds source and upgrades trust rank.
- **Reach Invalidation**: If the assertion is of type `invalidation` (e.g. firmware upgrade), checks `store.reach(invalidation)`. If it completely subsumes older rules, marks them closed.

### Step 8: Multi-Layer Knowledge Graph Projection ([kg.py](file:///home/matteo/Projects/since-ai/src/context_layer/graph/kg.py#L40-L132))
- Context assertions, network topology, and raw Slack communication are projected into an interconnected graph:
  - **Provenance Layer**: Slack message node linked to author `(Person)-[:AUTHORED]->(Message)-[:PART_OF]->(Thread)`.
  - **Extraction Layer**: `(Assertion)-[:DERIVED_FROM]->(Message)` and `(Assertion)-[:STATED_BY]->(Person)`.
  - **Episodic Mentions**: `(Message)-[:MENTIONS]->(Element)`.
  - **Operational Layer**: `(Assertion)-[:APPLIES_TO]->(Class)` and `(Assertion)-[:OBSERVED_ON]->(Element)`.
  - **Topology Layer**: `(Element)-[:MEMBER_OF]->(Class)` and `(Element)-[:LOCATED_AT]->(Site)`.
  - **Lifecycle Layer**: `(Assertion)-[:CLOSED_BY]->(Assertion)` and `(Assertion)-[:CONFLICTS_WITH]->(Assertion)`.

---

## 5. Knowledge Graph Multi-Layer Ontology

```mermaid
flowchart LR
    subgraph PROVENANCE["Provenance Layer"]
        P["Person<br/>(name, role)"]
        M["Message<br/>(seq, sent_at, text)"]
        T["Thread<br/>(source: slack, slack_ts)"]
    end

    subgraph CONTEXT["Context Assertion Layer"]
        A["Assertion (ctx_0001)<br/>(topic, action, conditions,<br/>valid_from, valid_to, trust)"]
        EV["Event<br/>(event:sfp-replacement)"]
    end

    subgraph NETWORK["Network Topology Layer"]
        C["Class<br/>(criteria: type, model, years)"]
        E["Element<br/>(TRN-042, model, firmware)"]
        S["Site<br/>(SITE-NF-017, region)"]
    end

    P -- "AUTHORED" --> M
    M -- "PART_OF" --> T
    M -. "MENTIONS (raw text)" .-> E
    M -. "MENTIONS" .-> S

    A -- "DERIVED_FROM" --> M
    A -- "STATED_BY" --> P
    A -- "APPLIES_TO" --> C
    A -- "OBSERVED_ON" --> E
    A -- "TRIGGER" --> EV

    E -- "MEMBER_OF" --> C
    E -- "LOCATED_AT" --> S

    A2["Assertion (ctx_0002)<br/>(invalidation / alternative)"]
    A2 -- "CLOSED_BY" --> A
    A2 -. "CONFLICTS_WITH" .- A
```