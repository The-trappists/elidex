# Elisa research: how they operate, and tools that can help

> **Status: research notes (2026-11-06).** Public sources only, gathered with web search. Nothing here is a team decision. Vendor marketing is marked as such; check anything important with the Elisa mentors (see [demo-and-risks.md](demo-and-risks.md#open-questions-for-elisa-mentors)).

## 1. Elisa in one paragraph

Finnish telecom operator (also in Estonia): 2.8M+ customers, 2025 revenue EUR 2.3B, 6,200+ employees. COO / EVP Technology and Operations is **Sami Komulainen**. Elisa has automated its network for more than a decade and sells that know-how through its software subsidiary **Elisa Industriq** (brands: Polystar, Gridle, sedApta, camLine, CalcuQuote, TenForce). No public code: [github.com/elisaoyj](https://github.com/elisaoyj) has no public repositories.

## 2. How Elisa runs network operations

| Topic | What is public | Source |
| --- | --- | --- |
| Platform | "Elisa Defined Network" (EDN), a highly automated network platform | [TelecomTV, Jun 2025](https://www.telecomtv.com/content/network-automation/elisa-and-google-cloud-expand-collaboration-to-deliver-ai-driven-autonomous-networks-53239/) |
| Cloud and AI stack | Google Cloud Autonomous Network Operations framework; BigQuery + Spanner for network data; Vertex AI, Gemini | same |
| Agents | Built with Google **ADK**, connected as multi-agent systems over **A2A**; agents tailored to Elisa workflows: predictive analytics, automated diagnostics, prescriptive actions | same |
| Digital twin | Elisa has a digital twin of its network; shown with live AI agents at MWC 2026. Google's framework stores the twin as a **temporal graph in Spanner Graph** | [RCR, Jul 2026](https://rcrwireless.com/20260707/5g/elisa-ai-automation), [MWC release](https://www.prnewswire.com/news-releases/elisa-and-elisa-industriq-join-mwc-barcelona-2026-showcasing-innovations-in-energy-optimization-autonomous-networks-scam-prevention-and-more-302699489.html), [Fierce](https://www.fierce-network.com/cloud/google-cloud-opens-its-network-automation-playbook-telcos) |
| Results | Customer-impacting incidents **down more than 80%**; preventive actions **at 99%** | [RCR, Jul 2026](https://rcrwireless.com/20260707/5g/elisa-ai-automation) |
| Human in the loop | "Agentic AI that operates alongside human engineers to troubleshoot issues and predict potential incidents" | same |
| Radio | AI-RAN trials with NVIDIA and Nokia (Europe's first on a live network); commercial target 2027. No Open RAN; focus on Cloud RAN | [PR Newswire, Oct 2026](https://www.prnewswire.com/news-releases/elisa-taps-nvidia-and-nokia-for-its-journey-towards-commercial-ai-ran-in-finland-302915455.html) |
| Regulation | Telecom infrastructure counts as high-risk under the EU AI Act: closed loops need transparency and fail-safes | [TelecomTV](https://www.telecomtv.com/content/network-automation/elisa-and-google-cloud-expand-collaboration-to-deliver-ai-driven-autonomous-networks-53239/) |

**Not public:** NOC organisation, ticketing tool, chat tools, ticket volumes, MTTR, how agents get context today. Ask the mentors.

## 3. The most relevant find: Elisa Industriq's "Digital Master"

Blog post, Oct 2026 (vendor marketing): [Digital Master: the foundation for autonomous network operations](https://www.elisaindustriq.com/resources/blog/digital-master-the-foundation-for-autonomous-network-operations). Homepage banner: "The Missing Foundation for Autonomous Network Operations".

- "A continuously updated operational model constructed from live network data": physical and logical topology, services, dependencies, telemetry, events, assurance context.
- Their framing: **"The answer is not simply more AI. It is better operational context."**
- Collects with gNMI, NETCONF, SNMP; normalises to a common information model.
- Exposes context through **REST, Graph APIs, Kafka streams and MCP servers** for AI agents.
- Closed loop: understand, choose a response, assess impact, execute, validate. Decisions run autonomously or go to a human reviewer; operators design policies and guardrails.

**Why it matters for us:** the Digital Master holds what the *machines* know. The challenge asks for what the *humans* know. A strong pitch is a **human-knowledge layer that plugs into this kind of model**: same element IDs, exposed the same way (MCP / REST / graph), so an Elisa agent gets "the backup link at this site fails in snow" next to the topology. This is a framing option, not a decision.

## 4. Polystar (Elisa Industriq assurance products)

- Products: **Osix Monitoring** (probes, tracing), **Kalix Analytics** (PM and probe KPIs, AI anomaly detection, SQL access), **Kalix DataOps**. Agentic AI in the Roaming Portal. [elisaindustriq.com/polystar](https://www.elisaindustriq.com/polystar)
- 100+ operators; Gartner Representative Vendor 2026 for CSP service and network assurance.
- Users named: engineering, **NOC and SOC teams**, service management.
- Out of scope for us (fault detection), but tells us the vocabulary: alarms, PM KPIs, probes, NOC.

## 5. Tools and data that could help

| Need | Option | Notes |
| --- | --- | --- |
| Agent protocol fit | **A2A** (Google) and **MCP** | Elisa uses ADK + A2A; Industriq exposes MCP. Serving our knowledge as an MCP server or A2A agent speaks their language |
| Agent framework | Google **ADK** + Gemini | Same as Elisa; Gemini free tier and MLH award (see [tech-stack.md](tech-stack.md)) |
| Temporal knowledge graph | **[Graphiti](https://github.com/getzep/graphiti)** (Zep) | Bi-temporal facts; old facts are invalidated, not deleted; ships an MCP server; runs on Neo4j. Matches "freshness" and idea F |
| GraphRAG | [Microsoft GraphRAG](https://github.com/microsoft/graphrag), [FalkorDB GraphRAG SDK](https://github.com/falkordb/graphrag-sdk) | MS GraphRAG is in maintenance mode and costly to index; FalkorDB is more modular |
| Entity extraction | **GLiNER** (zero-shot NER, labels given at run time) | Good for custom labels like site, element, condition |
| Privacy | **[Microsoft Presidio](https://microsoft.github.io/presidio/samples/python/gliner)** + GLiNER PII model | Mask names in messages before LLM calls. Finnish support not evaluated: test it |
| Finnish text | TurkuNLP models (University of Turku, e.g. FinBERT) | From memory, not checked in this search; worth a look since data may be in Finnish |
| Data schemas | **TM Forum Open APIs**: [TMF642 Alarm](https://www.tmforum.org/oda/open-apis/directory/TMF642), TMF621 Trouble Ticket, TMF639 Resource Inventory | Use their field names for synthetic tickets and inventory so output looks "telco-native" |
| Standard context layer | FIWARE / NGSI-LD | Already listed in [tech-stack.md](tech-stack.md) |
| Public datasets | [TeleQnA](https://arxiv.org/abs/2310.15051) (telecom Q&A), TSpec-LLM (3GPP specs), TN-RCA530 (alarm RCA scenarios), [GSMA Open Telco sample data](https://huggingface.co/datasets/GSMA/ot_sample_data) | **No public trouble-ticket or NOC chat dataset found**: plan synthetic data |

## 6. Gaps and questions for the mentors

- Which ticketing and chat tools do Elisa engineers use? (Drives the capture integration.)
- What do element IDs look like in EDN or the digital twin?
- Do the ADK / A2A agents have a context or knowledge source today? Could ours be one more A2A agent or MCP tool?
- Data language: Finnish, English, mixed?
- Can message data leave the EU or go to external LLM APIs?
