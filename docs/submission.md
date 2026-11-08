Hidden knowledge is the unspoken operational information trapped within the minds and everyday chats of experienced network engineers rarely documented in wikis. When a critical incident occurs at 3 a.m., autonomous AI agents lack this essential "as-experienced" context.

ElidEx captures this "silent metadata" from everyday engineering conversations (Slack, emails) without imposing extra work on specialists. It extracts actionable rules, deterministically links them to network topology and equipment classes with temporal validity, and serves them to autonomous AI agents via the Model Context Protocol (MCP) and REST to ensure safe, end-to-end network operations.

Modern network automation excels at Intent (as-designed), Physical infrastructure (as-built), and Telemetry (as-observed), but lacks Context ("as-experienced"):

* Why is a configuration non-standard?
* Where is the key to a private locked barrier?
* Why does a unit show normal optical power while traffic counters remain at zero?

Rushing into hardware replacements or node reboots is often wrong. Senior engineers know battle-tested fixes—like bouncing an interface before rebooting—that remain trapped in informal chat threads.

To solve this, ElidEx built four core pillars:

1. CAPTURE passively: Ingest discussions directly from communication channels with zero extra forms or documentation overhead.
2. EXTRACT actionable knowledge: Distill reusable operational insight from informal chat noise, extracting testable conditions, recommended actions, source citations, and confidence scores.
3. LINK with high precision: Follow the principle that *"a wrong link is worse than none."* Bind knowledge deterministically to entities, equipment classes, firmware versions, or sites with temporal validity.
4. SERVE to autonomous agents: Expose the knowledge base through MCP and REST so agents verify conditions and consult human wisdom before acting.

---

## What is ElidEx?

ElidEx continuously processes engineering conversations into an active, self-governing Knowledge Graph. The ElidEx Dashboard provides an operational test bench featuring:

* Company Day Simulation: Mirrors a Finnish working calendar with live operational discussions, scripted incidents, and dynamic agent interventions.
* Interactive Network Topology: A real-time canvas visualization of Elisa's network infrastructure showing operational context.
* Dynamic Knowledge Graph & Library: A multi-entity graph linking people, equipment, rules, and incidents with citation provenance and temporal validity.
* Agent Tester (Ask-Before-Act Guard): An interactive playground to observe how an autonomous AI agent retrieves human context, verifies preconditions, and adapts its action plan.
* Insights (Pattern Recognition): Correlates human workarounds across topology to identify recurring problems and hidden shared dependencies.

---

## How We Built It

ElidEx features a production-grade, highly modular architecture:

* Core Context Engine (Python 3.12, FastAPI, NetworkX): An asynchronous pipeline implementing a 5-stage lifecycle: Listen -> Understand -> Link -> Store -> Reconcile.
* Multi-Model LLM Pipeline & Dual-Agent Self-Governance:
* Extraction: High-throughput JSON extraction using Gemini (Vertex AI / Google AI Studio) with Featherless fallback.
* Critic Agent: Cross-evaluates extracted rules against cited quotes to prevent hallucinations and over-generalization.
* Reconciliation Judge Agent: Evaluates new assertions against existing graph knowledge to detect confirmations, contradictions, or obsolescence.


* Deterministic Entity Linker: Maps entities deterministically against inventory topology and abstains when ambiguous.
* Custom Canvas Force Graph Engine (React 18, Vite, TypeScript, Tailwind CSS): A native 60 FPS HTML5 Canvas engine engineered for telecom topology, site clustering, and focus-on-click navigation.
* Agent Interoperability (MCP & REST): Full native implementation of Anthropic’s Model Context Protocol and RESTful endpoints for seamless external agent queries.
* Scalability (MongoDB Atlas & Tiger Data): Supports MongoDB Atlas for document storage and vector search alongside Tiger Data for high-volume time-series chat tracking.

---

## Advantages

* Stable: Using ElidEx will enhance network operability
* Smart: As requested, the tool is automated and doesn't need extra work for specialists
* Trustworthy: Prevent misalignment with a confidence level backed by evidences, and sources
