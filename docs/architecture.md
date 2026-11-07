# Architecture and diagrams

> **Status: describes the code as it is on `main`.** Every diagram below is written in Mermaid (rendered by GitHub). For the schema rationale see [design.md](design.md); for the workbench API see [workbench.md](workbench.md).

## 1. The big picture: what we add to Elisa's network model

Elisa's layers describe what the network **is**, **was built as** and **does**. Nobody records what the humans **know about it**. That missing layer is what this project builds.

```mermaid
flowchart TB
    subgraph elisa["Elisa's network model (given)"]
        D["Intent / design<br/>as-designed"]
        P["Physical / passive<br/>as-built"]
        R["Runtime / active<br/>as-running, telemetry"]
        E["Event stream<br/>as-observed"]
    end
    subgraph us["Our context layer (built here)"]
        C["Context<br/>as-experienced<br/>assertions with validity and trust"]
    end
    H["Teams chats, emails, Slack<br/>(channels specialists already use)"] -->|"listen, understand, link"| C
    C -. "bound to the same entity ids,<br/>valid_from / valid_to" .-> elisa
    C -->|"get_context, check_action<br/>(REST and MCP)"| A["AI agents"]
    R --> A
```

## 2. The pipeline: from a conversation to a reusable assertion

```mermaid
flowchart LR
    SRC["Conversations<br/>Teams JSON, email .txt,<br/>Slack, workbench chat"] --> L1["1. Listen<br/>listen.py<br/>Thread of Messages"]
    L1 --> U["2. Understand<br/>understand.py<br/>LLM or cached extractor<br/>-> ExtractedItem"]
    U --> LK["3. Link<br/>link.py<br/>bind to instance, class, site<br/>or abstain"]
    INV[("Inventory<br/>elements, sites,<br/>aliases")] --> LK
    LK --> ST["4. Store<br/>store.py<br/>NetworkX graph + JSON<br/>merge same knowledge"]
    ST --> RC["5. Reconcile<br/>mvp/lifecycle.py<br/>close old, flag conflicts"]
    RC --> SV["Serve<br/>REST /context, /guard<br/>MCP get_context, check_action"]
    SV --> AG["Reuse<br/>agent.py + conditions + guard"]
```

| Stage | Module | Decision it makes |
| --- | --- | --- |
| Listen | `listen.py` | Turns files (and live messages) into `Thread` / `Message` |
| Understand | `understand.py`, `llm.py` | Keeps the one sentence of real knowledge; returns nothing for chit-chat; never diagnoses |
| Link | `link.py` | Instance as evidence, class as scope; **abstains** when too broad, unknown or below `MIN_CONFIDENCE` |
| Store | `store.py` | Same binding and same author or same advice = one assertion with several sources; different advice = kept apart |
| Reconcile | `mvp/lifecycle.py` | An invalidation closes `valid_to`; two experts who disagree are both kept and flagged |
| Serve | `api.py`, `mcp_server.py` | `get_context(entity, at)` returns what is valid at time `t` for the node, its classes and its site |
| Reuse | `agent.py`, `mvp/conditions.py`, `mvp/guard.py` | Applies a rule only when its observed conditions do not contradict it; turns "reboot" into "bounce first" |

## 3. Data model

```mermaid
erDiagram
    THREAD ||--|{ MESSAGE : contains
    SITE ||--o{ NETWORK_ELEMENT : hosts
    ELEMENT_CLASS }o--o{ NETWORK_ELEMENT : "member_of (by criteria)"
    CONTEXT_ASSERTION ||--|{ BINDING : "bound_to"
    BINDING }o--|| NETWORK_ELEMENT : "observed_on / applies_to"
    BINDING }o--|| ELEMENT_CLASS : "applies_to"
    BINDING }o--|| SITE : "applies_to"
    BINDING }o--o| EVENT : "trigger"
    CONTEXT_ASSERTION ||--|{ SOURCE_REF : "sources (thread + seq)"
    CONTEXT_ASSERTION ||--|| TRUST : has
    CONTEXT_ASSERTION }o--o{ CONTEXT_ASSERTION : "conflicts_with / closed_by"

    CONTEXT_ASSERTION {
        string id
        string type "workaround, access, fact, invalidation"
        string topic
        string action
        string avoid
        datetime valid_from
        datetime valid_to "null = still believed true"
        float confidence
    }
    TRUST {
        string level "hunch, stated, verified"
        string stated_by
        string role
        string evidence
    }
```

Binding roles: `applies_to` is the scope (class, site or instance when no class is given), `observed_on` is the instance that served as evidence, `trigger` is the event that starts the rule (for example `event:sfp-replacement`). The shared contract is `src/context_layer/models.py`.

## 4. Linking: right generality, never overlink

```mermaid
flowchart TD
    I["ExtractedItem<br/>scope: ids, sites, class criteria, trigger"] --> C{"confidence ≥<br/>MIN_CONFIDENCE?"}
    C -- no --> AB1["abstain"]
    C -- yes --> K{"class criteria given?"}
    K -- "yes, specific<br/>(model or install year)" --> M{"matches ≥ 1 element?"}
    K -- "yes, bare type<br/>('all transmission nodes')" --> TB["note: too broad, class not bound"]
    K -- no --> INS
    M -- yes --> CB["bind class: applies_to<br/>instances become observed_on"]
    M -- no --> NM["note: matches nothing, class not bound"]
    CB --> INS["bind known instances and sites<br/>unknown ids are noted, not bound"]
    TB --> INS
    NM --> INS
    INS --> Q{"at least one<br/>applies_to binding?"}
    Q -- no --> AB2["abstain: nothing to bind it to"]
    Q -- yes --> OK["ContextAssertion<br/>valid_from = time of the cited messages"]
```

Example: "older units, TX-3000, up to 2019" becomes `class:transmission_node:tx-3000:installed-upto-2019` (scope), `TRN-042` (evidence) and `event:sfp-replacement` (trigger). A second TX-3000 installed in 2019 inherits the rule; one installed in 2023 does not.

## 5. Life of an assertion (lifecycle and trust)

```mermaid
stateDiagram-v2
    [*] --> Hunch: hedged message
    [*] --> Stated: expert's claim
    Stated --> Verified: later message reports the outcome<br/>("traffic is back")
    Hunch --> Verified: outcome reported
    Verified --> Closed: invalidation message<br/>(firmware fix, new lock)<br/>valid_to set, closed_by recorded
    Stated --> Closed: invalidation message
    Stated --> Conflicting: another expert gives different advice<br/>on the same scope
    Verified --> Conflicting: same
    Conflicting --> Closed: one side is invalidated
    Closed --> Stated: thread re-processed, closing<br/>message gone (re-opened)
```

Rules, as implemented in `store.py` and `mvp/lifecycle.py`:

- Same binding and (same author or same action) merge into one assertion; the highest trust wins and the sources add up.
- A different action by a different author on the same scope is **not** merged: both stay, `conflicts_with` links them. Scope overlap is checked on class ids **and** instances, so "TX-3000" and "TX-3000 up to 2019" still conflict when both name TRN-088.
- An `invalidation` closes only knowledge that is **older** than itself, on the same topic and an overlapping scope. A replacement given in the same message stays open.
- Closed knowledge is no longer in conflict with anything and no longer returned by `get_context` (unless `include_expired`).
- Nobody is ever asked "is this still true?".

## 6. Reuse: what an agent does with it

```mermaid
sequenceDiagram
    participant Ag as Agent (or workbench "Ask agent")
    participant API as REST / MCP
    participant St as Context store
    participant Gd as Guard and conditions
    Ag->>API: get_context("TRN-117", at=now)
    API->>St: node + member_of classes + site
    St-->>API: assertions valid at t (with matched_via)
    API-->>Ag: rules, facts, trust, sources
    Ag->>API: check_action("reboot", "TRN-117", observations)
    API->>Gd: verb "reboot" vs assertions to avoid
    Gd->>Gd: skip rules whose observed conditions fail
    alt a remaining rule says avoid "reboot"
        Gd-->>Ag: adapt: "bounce the interface first, then reboot only if that fails" (cites the message)
    else no rule applies
        Gd-->>Ag: go: no human knowledge against this action
    end
```

## 7. The Workbench

One Python process (FastAPI + one asyncio loop) serves the REST API, the SSE stream and the built React app.

```mermaid
flowchart LR
    subgraph browser["Browser: web/ (React, Vite, Tailwind, Cytoscape)"]
        UI["Live · Conversations · Network ·<br/>Knowledge · AI activity · Data · Settings"]
    end
    subgraph server["ctx workbench: src/context_layer/workbench/"]
        RT["routes.py<br/>REST /api"]
        BUS["EventBus bus.py<br/>SSE /api/stream"]
        WB["Workbench state.py<br/>the single source of truth"]
        SIM["simulator.py + clock.py<br/>scenarios, sim time ×1..×600"]
        GEN["generator.py<br/>LLM-written scenarios"]
        PR["processor.py<br/>idle timer, one job per thread"]
        SL["slack_bridge.py<br/>Socket Mode"]
        PS[("out/workbench/<br/>state.json, llm_calls.jsonl,<br/>llm_cache.json")]
    end
    CORE["Core pipeline<br/>understand · link · store ·<br/>lifecycle · agent · guard"]
    LLM["LLM provider<br/>Gemini, fallback Featherless"]
    SLACK["Slack workspace"]

    UI -- "GET /state, actions" --> RT
    BUS -- "events" --> UI
    RT --> WB
    SIM --> WB
    GEN --> WB
    WB --> BUS
    WB --> PR
    PR --> CORE
    CORE --> LLM
    SL <--> SLACK
    SL <--> WB
    WB <--> PS
```

### What happens when a message is posted

```mermaid
sequenceDiagram
    participant P as Persona (simulator, human or Slack)
    participant W as Workbench
    participant J as Processor job
    participant X as Extractor (LLM or scripted)
    participant S as Store
    participant UI as Browser (SSE)

    P->>W: post_message(thread, text)
    W-->>UI: message.new
    W->>W: (re)start idle timer (idle_seconds)
    Note over W: nobody writes for N seconds
    W->>J: run job for the whole thread
    J-->>UI: pipeline.job listen
    J->>S: remove this thread's sources and reopen what it closed
    J->>X: extract(thread, known topics)
    X-->>J: items (+ LlmCall traces)
    J-->>UI: understand, link
    J->>S: add_assertion (new or merged)
    J-->>UI: store
    J->>S: lifecycle.reconcile (close, flag conflicts)
    J-->>UI: reconcile done, eval if ground truth exists
    UI->>UI: Knowledge and Network update live
```

Re-processing a whole thread is idempotent, which is why a late message just triggers another job.

### Extractor choice and LLM fallback

```mermaid
flowchart TD
    M{"settings.extractor_mode"} -->|llm| L["LLMExtractor<br/>error if no key"]
    M -->|scripted| SC["scenario expected → core cache →<br/>nothing"]
    M -->|auto| K{"LLM key<br/>configured?"}
    K -- yes --> L
    K -- no --> SC
    L --> P1["Primary: Gemini<br/>(OpenAI-compatible)"]
    P1 -- "429, 5xx, timeout" --> P2["Fallback: Featherless"]
    P1 -- ok --> OUT["items + trace"]
    P2 -- ok --> OUT
    P2 -- fails --> ERR["job failed, AI activity shows<br/>a plain-language error,<br/>in auto mode, scripted answers take over"]
```

Every attempt, including the fallback one, is written to `llm_calls.jsonl` and shown on the **AI activity** page. API keys are never traced.

## 8. Deployment

```mermaid
flowchart LR
    U["Team browser<br/>https://‹ip›.sslip.io"] -->|"443, one team password"| CD["Caddy<br/>HTTPS + basic auth"]
    CD -->|"8000"| APP["context-workbench<br/>(Docker image: Python + built UI)"]
    APP --- VOL[("volume workbench-data<br/>/app/out")]
    APP -->|HTTPS| G["Gemini API"]
    APP -->|HTTPS| F["Featherless API"]
    APP <-->|"Socket Mode<br/>(outbound only)"| SK["Slack"]
    GH["git origin"] -. "deploy/update.sh on the VM:<br/>git pull, docker compose up --build" .-> APP
```

Slack uses Socket Mode, so the VM needs no public webhook. Details: [deploy-vultr.md](deploy-vultr.md), [slack-setup.md](slack-setup.md).

## 9. Code map

```mermaid
flowchart TB
    subgraph core["src/context_layer/"]
        models["models.py<br/>shared contract"]
        listen["listen.py"] --> understand["understand.py + llm.py"] --> link["link.py"] --> store["store.py"]
        pipeline["pipeline.py<br/>build_store"]
        agent["agent.py"]
        api["api.py"]
        mcp["mcp_server.py"]
        cli["cli.py<br/>ctx ..."]
        subgraph mvp["mvp/"]
            lifecycle["lifecycle.py (D)"]
            conditions["conditions.py (C)"]
            guard["guard.py (B)"]
        end
        subgraph wb["workbench/"]
            wbapp["app, routes, state, bus,<br/>processor, simulator, clock,<br/>generator, seed, persistence,<br/>slack_bridge, contracts"]
        end
    end
    web["web/<br/>React UI"] --> wbapp
    wbapp --> pipeline
    cli --> pipeline
    cli --> api
    cli --> mcp
    cli --> wbapp
    pipeline --> lifecycle
    agent --> conditions
    agent --> guard
    demo["demo/app.py<br/>Streamlit"] --> agent
```
