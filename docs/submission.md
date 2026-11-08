# ElidEx — Project Submission

> **Challenge:** Elisa — *Capturing and Linking Human-Generated Contextual Metadata for Autonomous Network Operations*  
> **Team:** The Trappists (Since AI Hackathon 2026, Turku, Finland)

---

## 1. Short Pitch (Summary / Hook)

Hidden knowledge is the unspoken operational wisdom trapped within the minds and everyday communications of experienced network engineers—rarely documented in central databases or wikis. When a critical incident occurs at 3 a.m., an autonomous AI agent cannot call a senior engineer on Microsoft Teams. 

**ElidEx** (Elisa Context Index) captures this "silent metadata" from everyday engineering conversations (Teams, Slack, emails) without imposing extra documentation work on specialists. It extracts actionable rules, deterministically links them to network topology and equipment classes with time validity, and serves them to autonomous AI agents via the Model Context Protocol (MCP) and REST. ElidEx provides the missing "as-experienced" context layer required for safe, end-to-end autonomous network operations.

---

## 2. The Problem & Challenge Context

Elisa is a pioneer in autonomous network operations powered by AI agents. While modern network automation systems excel at understanding **Intent** (as-designed), **Physical infrastructure** (as-built), and **Telemetry** (as-observed), they completely lack the **Context Layer ("as-experienced")**:
- *Why is a specific configuration non-standard?*
- *Where is the physical key to a private locked road barrier?*
- *Why does a transmission unit show normal optical power and an "UP" interface status after an SFP swap while traffic counters remain at zero?*

When an automated agent detects a fault, rushing into an immediate hardware replacement or a disruptive node reboot is often the wrong answer. Senior engineers already know the battle-tested fixes—such as bouncing the interface before rebooting—but that knowledge remains locked in chat threads with an informal *"Not that I know of 😄"* when asked if it is documented.

To solve this, we addressed the four fundamental pillars of the challenge:
1. **CAPTURE passively:** Ingest discussions directly from existing communication channels (Teams, Slack, email) with **zero extra forms, zero clicks, and zero documentation overhead** for engineers.
2. **EXTRACT actionable knowledge:** Distill the single sentence of reusable operational insight from informal conversational noise, extracting machine-testable conditions, recommended actions, source citations, and confidence scores.
3. **LINK with high precision:** Follow the golden principle that *"a wrong link is worse than none."* Bind knowledge deterministically to specific network entities, equipment classes, firmware versions, or physical sites with strict temporal validity (`valid_from` / `valid_to`).
4. **SERVE to autonomous agents:** Expose the contextual knowledge base through open standards (Model Context Protocol - MCP and REST) so autonomous agents can verify conditions and consult human wisdom before taking action.

---

## 3. Our Solution: ElidEx & The Interactive Dashboard

**ElidEx** bridges human operational experience and autonomous machine execution. It continuously processes engineering conversations into an active, self-governing Knowledge Graph. 

To visualize, validate, and test this pipeline in real time, we built the **ElidEx Dashboard**—an interactive operational test bench featuring:

- **Company Day Simulation:** A live, high-fidelity operational simulation mirroring a Finnish working calendar. Simulates concurrent NOC and field discussions, scripted incidents, dynamic pipeline ingestion, and autonomous agent interventions in real time.
- **Interactive Network Topology:** A real-time, interactive canvas visualization of Elisa's network infrastructure (nodes, routers, transmission links, and physical facilities) showing real-time operational context.
- **Dynamic Knowledge Graph & Library:** A multi-entity graph linking people, equipment, contextual rules, and incidents. Operators can inspect reach (preventing over-linking), full citation provenance, and temporal validity.
- **Agent Tester (Ask-Before-Act Guard):** An interactive playground where users can trigger simulated network incidents to observe how an autonomous AI agent retrieves human context, verifies preconditions (e.g., checking traffic counters), and adapts its action plan (e.g., bouncing an interface instead of initiating a reboot).
- **Insights (Pattern Recognition):** Beyond explicit statements, ElidEx correlates human workarounds across time and network topology to identify:
  - *Recurring problems:* Identical workarounds repeatedly applied (e.g., a power breaker tripped 3+ times).
  - *Linked problems & Hidden suspects:* Elements in separate conversations failing concurrently that share an unmentioned common dependency (e.g., a shared clock module or site power supply).

---

## 4. How We Built It

We built ElidEx as a production-grade, highly modular, and extensible architecture:

- **Core Context Engine (Python 3.12, FastAPI, NetworkX):** An asynchronous pipeline implementing a clean 5-stage lifecycle: **Listen → Understand → Link → Store → Reconcile**. State and temporal graph relations are managed with NetworkX and served through high-performance FastAPI endpoints.
- **Multi-Model LLM Pipeline & Dual-Agent Self-Governance:**
  - *Extraction:* High-throughput structured JSON extraction using Gemini (Vertex AI / Google AI Studio) with Featherless as an automatic fallback.
  - *Independent Critic Agent:* A secondary model cross-evaluates each extracted rule against verbatim cited quotes to prevent hallucinated rules and over-generalized scopes.
  - *Reconciliation Judge Agent:* Automatically evaluates new assertions against existing graph knowledge to detect confirmations, contradictions, or firmware-driven obsolescence.
- **Deterministic Entity Linker:** Adhering strictly to *"a wrong link is worse than none,"* the linker maps entities deterministically against inventory topology (IDs, models, install years, facilities) and abstains when ambiguous rather than guessing.
- **Custom Canvas Force Graph Engine (React 18, Vite, TypeScript, Tailwind CSS):** Instead of bloated third-party charting libraries, we developed a lightweight, native 60 FPS HTML5 Canvas force-directed graph engine (`web/src/components/force/`) specifically engineered for telecom topology, site boundary clustering, and dynamic focus-on-click navigation.
- **Agent Interoperability (Model Context Protocol & REST):** Full native implementation of Anthropic’s **Model Context Protocol (MCP)** and RESTful endpoints, allowing external operational agents to call `get_context`, `read_observation`, and query knowledge provenance seamlessly.
- **Scalability (MongoDB Atlas & Tiger Data):** Validated against a company-scale procedural generator (millions of messages). Supports MongoDB Atlas for document storage and vector search, alongside Tiger Data for high-volume time-series chat and freshness tracking.

---

## 5. Reliability, Trust & Zero Human Burden

For an operator of Elisa’s scale, network reliability is paramount. ElidEx was engineered with rigorous safeguards:
- **Zero Specialist Overhead:** Specialists never fill in forms, confirm wikis, or tag metadata. Knowledge extraction is 100% passive and continuous.
- **Complete Explainability & Provenance:** Every context assertion is backed by verbatim conversational quotes, identifiable authors, and deterministic justification (`GET /api/assertions/{id}/justification`).
- **Closed-Loop Feedback (Outcome Loop):** When an agent applies a recommendation, subsequent field observations and engineer responses automatically update the rule's confidence score and trust status—closing the loop without manual triage.
