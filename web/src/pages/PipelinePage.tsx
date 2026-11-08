import { useState } from 'react'
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Copy,
  Cpu,
  FileCode2,
  MessageSquare,
  Network,
  Scale,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { Badge, Button } from '../components/ui'
import { cn } from '../lib/cn'

interface StagePayload {
  inputTitle: string
  inputCode: string
  transformLabel: string
  outputTitle: string
  outputCode: string
}

interface ScenarioData {
  id: string
  title: string
  subtitle: string
  badge: string
  stages: Record<number, StagePayload>
}

interface PipelineStage {
  id: number
  key: string
  name: string
  badge: string
  badgeTone: 'info' | 'ok' | 'warn' | 'accent'
  module: string
  contract: string
  purpose: string
  technicalDetails: string[]
  designJustification: {
    question: string
    answer: string
    elisaContext: string
  }
}

const STAGES: PipelineStage[] = [
  {
    id: 1,
    key: 'ingest',
    name: '1. Ingestion & Event Stream',
    badge: 'Socket Mode & Async IO',
    badgeTone: 'info',
    module: 'src/context_layer/workbench/slack_bridge.py',
    contract: 'LiveThread · Message · ThreadSource',
    purpose:
      'Captures silent operational knowledge directly from live communication channels without requiring technicians to open a ticketing system or fill in documentation forms.',
    technicalDetails: [
      'Socket Mode WebSocket listener connects via App-Level Token (xapp-...) and Bot User Token (xoxb-...).',
      'Event filtering aggressively drops bot loops, system noise, and message edits (IGNORED_SUBTYPES: bot_message, channel_join, message_changed).',
      'Actor identity is asynchronously resolved via the users.info API to capture the real human author name and job title (e.g. "Senior Network Specialist").',
      'Thread correlation matches thread_ts to existing LiveThread instances or initiates a new anchored thread.',
    ],
    designJustification: {
      question: 'Why capture from chat/email rather than requiring structured forms?',
      answer:
        'Elisa\'s core brief states: "If your solution needs Erkki to fill in a form, Erkki won\'t fill in the form." Network engineers communicate fixes in real time on Teams and Slack. Capturing metadata silently from the conversational stream eliminates operational overhead.',
      elisaContext: 'Solves Hard Point 1: "The real knowledge sits inside colleague chats, not wikis."',
    },
  },
  {
    id: 2,
    key: 'debounce',
    name: '2. Burst Debounce & Scheduling',
    badge: 'State Machine Lock',
    badgeTone: 'accent',
    module: 'src/context_layer/workbench/processor.py',
    contract: 'PipelineJob · asyncio.Lock · idle_seconds',
    purpose:
      'Aggregates fragmented multi-line human chat bursts into coherent conversational contexts before invoking inference.',
    technicalDetails: [
      'Human specialists write in bursts (e.g., 3-4 short messages across 90 seconds). An idle debounce timer (default 2.0s in simulation, 60s in production) resets on each incoming message.',
      'When the conversation settles into silence, processor._launch(thread_id) acquires a dedicated asyncio.Lock.',
      'The job lock prevents concurrent background runs from creating race conditions or duplicate assertions on the underlying store graph.',
      'Initializes a trackable PipelineJob recording timestamps, stage statuses, and LLM telemetry.',
    ],
    designJustification: {
      question: 'Why not process each message immediately upon receipt?',
      answer:
        'Single messages like "On TRN-042..." followed 10 seconds later by "...bounce the interface" would result in partial, hallucinated extractions if evaluated independently. Waiting for typing bursts ensures complete context while preventing redundant LLM inference costs.',
      elisaContext: 'Operational stability: handles human conversational cadence naturally.',
    },
  },
  {
    id: 3,
    key: 'understand',
    name: '3. Understand & Extraction',
    badge: 'Structured LLM Schema',
    badgeTone: 'info',
    module: 'src/context_layer/understand.py',
    contract: 'ExtractedItem · ExtractionResult · Scope',
    purpose:
      'Transforms unstructured conversational dialogue into strict, validated JSON context items with machine-evaluable predicates.',
    technicalDetails: [
      'Builds a prompt containing the full thread context, chronological message sequence, and the catalog of known topic slugs to encourage topic re-use across channels.',
      'Enforces a Pydantic schema (ExtractionResult) via constrained decoding / function calling JSON mode.',
      'Extractor classifies knowledge type: workaround, invalidation, access, or fact.',
      'Extracts machine-verifiable Condition checks (field, operator, expected value) restricted to OBSERVABLE_FIELDS (sfp_replaced, interface_status, traffic_counters, optical_levels, alarms, firmware).',
      'Extracts verbatim evidence_quote and cited_seq references for complete auditability.',
    ],
    designJustification: {
      question: 'Why extract structured predicates instead of summarizing into text chunks for RAG?',
      answer:
        'Autonomous network agents cannot act safely on free-text summaries. They require machine-verifiable operational preconditions (e.g. interface_status == "UP" AND traffic_counters == 0) so the agent can evaluate telemetry observations before triggering network state changes.',
      elisaContext: 'Fit for autonomous operations: turns tribal chatter into machine-actionable guardrails.',
    },
  },
  {
    id: 4,
    key: 'critic',
    name: '4. Adversarial Critic Verification',
    badge: 'Two-Phase Quality Gate',
    badgeTone: 'warn',
    module: 'src/context_layer/critic.py',
    contract: 'CriticReview · CriticVerdict · QuoteCheck',
    purpose:
      'Performs independent verification to intercept hallucinated claims, scope inflation, and unsubstantiated generalizations before they touch the knowledge base.',
    technicalDetails: [
      'Step A (Deterministic): Exact string substring verification between item.evidence_quote and the cited message sequence. If the LLM hallucinated words not written by the author, confidence is penalized by a 0.7x multiplier.',
      'Step B (Adversarial LLM Review): A separate critic prompt audits each candidate against three rules:',
      '  1. Scope inflation: Did the author speak about one unit while the extractor inferred a fleet-wide rule?',
      '  2. Vague word leakage: Did words like "older units" inappropriately turn into broad hardcoded install year ranges?',
      '  3. Recommendation truthfulness: Does the cited quote genuinely justify the suggested action?',
      'Returns a strict verdict: keep, downgrade (penalized confidence), or reject (item dropped from pipeline).',
    ],
    designJustification: {
      question: 'Why add an adversarial critic gate right after extraction?',
      answer:
        'Elisa\'s challenge slides explicitly warn: "A wrong link or hallucinated advice is far worse than no advice at all." An unverified LLM output could bounce production routers unnecessarily. The two-phase critic guarantees zero tolerance for invented quotes.',
      elisaContext: 'Secondary Judging Criterion: "Correctness of linking and relevance of context."',
    },
  },
  {
    id: 5,
    key: 'link',
    name: '5. Precision Scope & Entity Linking',
    badge: 'Precision-First Ontology',
    badgeTone: 'ok',
    module: 'src/context_layer/link.py',
    contract: 'Inventory · ClassCriteria · Binding',
    purpose:
      'Binds the extracted rule to the exact network entities, element classes, or geographic sites justified by the conversation, abstaining rather than guessing.',
    technicalDetails: [
      'Author Validation: Verifies that stated_by matches a participant who actually authored a cited message.',
      'Inventory Resolution: Maps element aliases (e.g. "TRN42" -> "TRN-042") and confirms literal mentions via regex word boundaries.',
      'Class Criteria Constraints: A class must contain a specific type or model (bare types like "all nodes" are refused). If install years are specified, the linker verifies that the unit under discussion actually falls inside that install year range.',
      'Assigns explicit binding roles: applies_to (the target entity or class), observed_on (the specific testbed node where the issue was witnessed), and trigger (e.g. event:sfp-replacement).',
      'Vague Qualifier Handling: If a vague scope word ("old", "legacy") is present without concrete dates, the rule is bound to the instance only, avoiding overlinking.',
    ],
    designJustification: {
      question: 'Why refuse broad classes and prefer instance-only bindings on ambiguous words?',
      answer:
        'If Erkki says "these older TX-3000 units need a bounce", binding that rule to every transmission node installed anywhere causes false alarms across modern hardware. Binding precision preserves operational integrity and operator trust.',
      elisaContext: 'Solves Hard Point 2: "Linking: which elements does the knowledge really cover?"',
    },
  },
  {
    id: 6,
    key: 'store',
    name: '6. Store, Deduplication & Retraction',
    badge: 'Idempotent Graph Index',
    badgeTone: 'ok',
    module: 'src/context_layer/store.py',
    contract: 'ContextStore · same_knowledge · retract',
    purpose:
      'Maintains idempotent transactions, merges corroborated facts across different channels, and elevates trust when multiple engineers confirm a workaround.',
    technicalDetails: [
      'Retraction: Before inserting new extractions for a thread, store.retract(thread_id) cleans up previous assertions derived solely from that thread. This guarantees 100% idempotent re-processing.',
      'Structural Deduplication (same_knowledge): Compares (type, topic, bound_to). Two messages match if they share scope and either share the author OR share identical advice/facts.',
      'Corroboration & Trust Elevation: When a second engineer confirms an existing workaround, the system preserves the original author (provenance) and appends the second engineer to confirmed_by, while upgrading trust_level from "hunch" -> "stated" -> "verified".',
      'Confidence score is updated via max(confidence_old, confidence_new).',
    ],
    designJustification: {
      question: 'Why merge knowledge across channels while keeping the original author intact?',
      answer:
        'If Veikko confirms Erkki\'s tip, Erkki remains the original source while Veikko becomes a field confirmer. Overwriting the author would break provenance and prevent the detection of later disagreements or conflicting advice.',
      elisaContext: 'Solves Hard Point 4: "Trust: hunch or verified fix? Who said it, and where?"',
    },
  },
  {
    id: 7,
    key: 'arbitrate',
    name: '7. Multi-Agent Arbitration & Lifecycle',
    badge: 'Reach Subsumption & Semver',
    badgeTone: 'warn',
    module: 'src/context_layer/mvp/lifecycle.py',
    contract: 'reconcile · store.reach · Check.evaluate',
    purpose:
      'Automatically detects when newly announced firmware fixes supersede older workarounds, and arbitrates conflicts between disagreeing specialists.',
    technicalDetails: [
      'Reach Subsumption: Invalidation does not compare raw binding IDs (since "transmission nodes <= 2019" differs from "TX-3000 <= 2018"). Instead, store.reach(assertion) resolves the actual set of network elements covered.',
      'An invalidation closes an older rule only if new_reach fully subsumes old_reach. Partial overlaps keep the rule open for unaffected elements.',
      'Element-Level Firmware Condition: When an invalidation specifies a firmware version (e.g. "Firmware 4.2 fixes the bug"), reconcile attaches Check("firmware", "<", "4.2") to the rule.',
      'Semver Numeric Comparison: Check.evaluate normalizes version tuples with zero-padding (e.g. (4, 2) == (4, 2, 0)), avoiding lexical string comparison traps like "4.10" < "4.2".',
      'Disagreement Handling: If two specialists state opposing actions for the same scope, both are preserved and cross-referenced in conflicts_with.',
    ],
    designJustification: {
      question: 'Why attach a firmware check condition instead of setting valid_to on the message date?',
      answer:
        'Firmware rollout across a national carrier network takes weeks. Setting valid_to on the announcement date erroneously cuts off nodes still running firmware 3.8. Attaching firmware < 4.2 keeps the workaround active for un-upgraded nodes while safely retiring it for upgraded nodes.',
      elisaContext: 'Solves Hard Point 3: "Time: firmware fixes the bug; when does it stop being true?"',
    },
  },
  {
    id: 8,
    key: 'graph_mcp',
    name: '8. Graph Projection & Agent Execution',
    badge: 'Model Context Protocol (MCP)',
    badgeTone: 'accent',
    module: 'src/context_layer/mcp_server.py',
    contract: 'MCPServer · get_context · check_action',
    purpose:
      'Projects the multi-layer temporal knowledge graph and exposes industry-standard MCP tools directly to external autonomous network operations agents.',
    technicalDetails: [
      'Multi-Layer Knowledge Graph: NetworkX graph projecting Provenance (Person, Message, Thread), Extraction (Assertion), Topology (Element, Class, Site), and Lifecycle (ClosedBy, ConflictsWith) edges.',
      'Model Context Protocol (MCP): Runs over stdio/SSE using official Anthropic/Google MCP standard.',
      'get_context(entity_id, observations, include_expired=False): Evaluates telemetry observations against assertion conditions, returning check_status ("fully checked", "not fully checked"), to_read missing fields, and track_record.',
      'Auto-fills element firmware from inventory so agents do not need to query CMDB manually.',
      'check_action(action, entity_id, observations): Ask-before-act guard verifying planned operations against known human avoid lists (e.g. "avoid reboot") before execution.',
    ],
    designJustification: {
      question: 'Why build an MCP server instead of proprietary custom REST endpoints?',
      answer:
        'Elisa operates heterogeneous AI agent frameworks (including Google ADK, A2A, and custom LLM runtimes). Exposing native MCP tools allows any autonomous agent to connect with zero glue code, evaluate preconditions, and cite provenance automatically.',
      elisaContext: 'Primary Evaluation Criterion: "Fit for autonomous agentic network operations."',
    },
  },
]

const SCENARIOS: ScenarioData[] = [
  {
    id: 'sfp-workaround',
    title: 'TRN-042 SFP Forwarding Workaround',
    subtitle: 'Canonical Elisa Challenge Case: Optical swap forwarding state bug on older TX-3000 units',
    badge: 'Workaround · Human Expert',
    stages: {
      1: {
        inputTitle: 'Raw Slack Ingestion Event',
        inputCode: JSON.stringify(
          {
            type: 'message',
            user: 'U042VEIKKO',
            text: 'Replaced optical module on TRN-042. Interface is UP, optics normal, alarms cleared, but zero traffic. Any ideas?',
            ts: '1730985240.001200',
            channel: 'C0123OPS',
          },
          null,
          2
        ),
        transformLabel: 'Filter bots · users.info resolution · Correlate root_ts',
        outputTitle: 'Normalized Message & LiveThread',
        outputCode: JSON.stringify(
          {
            thread_id: 'slack:C0123OPS:1730985240.001200',
            source: 'slack',
            author: 'Veikko Field',
            role: 'Field Engineer',
            sent_at: '2026-11-07T13:14:00',
            text: 'Replaced optical module on TRN-042. Interface is UP, optics normal, alarms cleared, but zero traffic. Bounce the interface before rebooting.',
          },
          null,
          2
        ),
      },
      2: {
        inputTitle: 'Debounce Buffer State',
        inputCode: JSON.stringify(
          {
            thread_id: 'slack:C0123OPS:1730985240.001200',
            buffered_messages: 4,
            idle_timer: '2.0s countdown',
            status: 'waiting_for_silence',
          },
          null,
          2
        ),
        transformLabel: 'Idle timer expires · Acquire asyncio.Lock',
        outputTitle: 'Initialized PipelineJob',
        outputCode: JSON.stringify(
          {
            job_id: 'job_0042',
            thread_id: 'slack:C0123OPS:1730985240.001200',
            lock_acquired: true,
            stages: ['listen', 'understand', 'critic', 'link', 'store', 'reconcile'],
            status: 'running',
          },
          null,
          2
        ),
      },
      3: {
        inputTitle: 'Thread Context & Prompt',
        inputCode: JSON.stringify(
          {
            author: 'Erkki Expert (Senior Specialist)',
            cited_text: 'Older TX-3000 units have a known forwarding state glitch after SFP swap. If link UP but counters 0, disable/enable interface. Never reboot first.',
            known_topics: ['sfp-swap-forwarding-state', 'locked-barrier-key'],
          },
          null,
          2
        ),
        transformLabel: 'Pydantic constrained JSON schema extraction',
        outputTitle: 'ExtractedItem (Inference Result)',
        outputCode: JSON.stringify(
          {
            type: 'workaround',
            topic: 'sfp-swap-forwarding-state',
            summary: 'Bounce interface on older units after SFP swap if traffic counters stay zero.',
            action: 'Disable the interface, wait 10 seconds, then re-enable it.',
            avoid: ['reboot', 'replace SFP again'],
            conditions: [
              { text: 'interface status is UP', check: { field: 'interface_status', op: '==', value: 'UP' } },
              { text: 'traffic counters at zero', check: { field: 'traffic_counters', op: '==', value: 0 } },
              { text: 'optical levels normal', check: { field: 'optical_levels', op: '==', value: 'normal' } },
            ],
            confidence: 0.88,
            evidence_quote: 'Older TX-3000 units have a known forwarding state glitch after SFP swap.',
          },
          null,
          2
        ),
      },
      4: {
        inputTitle: 'Critic Candidate Evaluation',
        inputCode: JSON.stringify(
          {
            candidate_topic: 'sfp-swap-forwarding-state',
            quote_to_verify: 'Older TX-3000 units have a known forwarding state glitch after SFP swap.',
            raw_message: 'Older TX-3000 units have a known forwarding state glitch after SFP swap...',
          },
          null,
          2
        ),
        transformLabel: 'Quote Substring Match (Pass) · Adversarial Scope Check (Pass)',
        outputTitle: 'Critic Review Result',
        outputCode: JSON.stringify(
          {
            verdict: 'keep',
            quote_check: 'VERIFIED_EXACT_SUBSTRING',
            scope_inflation_check: 'PASSED (Target matches unit model)',
            vague_word_check: 'FLAGGED_QUALIFIER ("older" noted)',
            adjusted_confidence: 0.88,
          },
          null,
          2
        ),
      },
      5: {
        inputTitle: 'Unbound Scope & Inventory',
        inputCode: JSON.stringify(
          {
            raw_element: 'TRN-042',
            inventory_lookup: { model: 'TX-3000', type: 'transmission_node', install_year: 2019, firmware: '3.8' },
            stated_by: 'Erkki Expert',
          },
          null,
          2
        ),
        transformLabel: 'Alias match · Class specificity validation · Role assignment',
        outputTitle: 'Bound ContextAssertion',
        outputCode: JSON.stringify(
          {
            id: 'ctx_0001',
            type: 'workaround',
            topic: 'sfp-swap-forwarding-state',
            bound_to: [
              { entity: 'class:transmission_node:tx-3000:installed-upto-2019', role: 'applies_to' },
              { entity: 'TRN-042', role: 'observed_on' },
              { entity: 'event:sfp-replacement', role: 'trigger' },
            ],
            valid_from: '2026-11-07T13:14:00',
            trust: { level: 'stated', stated_by: 'Erkki Expert', confirmed_by: [] },
            link_notes: ['alias TRN42 -> TRN-042', 'class: transmission_node TX-3000 <= 2019'],
          },
          null,
          2
        ),
      },
      6: {
        inputTitle: 'Store Transaction',
        inputCode: JSON.stringify(
          {
            incoming_assertion: 'ctx_0001',
            existing_assertions_count: 14,
            thread_id: 'slack:C0123OPS:1730985240.001200',
          },
          null,
          2
        ),
        transformLabel: 'retract(thread_id) · same_knowledge() deduplication',
        outputTitle: 'Stored & Indexed Node',
        outputCode: JSON.stringify(
          {
            id: 'ctx_0001',
            is_new: true,
            stored_at: '2026-11-07T13:15:00',
            graph_edges_created: 3,
            trust_state: 'stated (Erkki Expert)',
          },
          null,
          2
        ),
      },
      7: {
        inputTitle: 'Arbitration Context',
        inputCode: JSON.stringify(
          {
            new_assertion: 'ctx_0001',
            candidate_neighbours: [],
            reach_elements: ['TRN-042', 'TRN-117', 'TRN-088'],
          },
          null,
          2
        ),
        transformLabel: 'LLM Judge arbitration · Invalidation reach check',
        outputTitle: 'Arbitration Verdict',
        outputCode: JSON.stringify(
          {
            verdict: 'active',
            conflicts_with: [],
            closed_by: null,
            events: ['ctx_0001 registered as active workaround'],
          },
          null,
          2
        ),
      },
      8: {
        inputTitle: 'Agent MCP Tool Invocation',
        inputCode: JSON.stringify(
          {
            mcp_tool: 'get_context',
            arguments: {
              entity_id: 'TRN-042',
              observations: { interface_status: 'UP', traffic_counters: 0, optical_levels: 'normal' },
            },
          },
          null,
          2
        ),
        transformLabel: 'Auto-fill firmware: 3.8 from inventory · Evaluate predicates',
        outputTitle: 'MCP Tool Response to Autonomous Agent',
        outputCode: JSON.stringify(
          [
            {
              id: 'ctx_0001',
              matched_via: 'class:transmission_node:tx-3000:installed-upto-2019',
              summary: 'Bounce interface on older units after SFP swap if traffic counters stay zero.',
              action: 'Disable the interface, wait 10 seconds, then re-enable it.',
              avoid: ['reboot', 'replace SFP again'],
              check_status: 'fully checked',
              condition_applies: true,
              to_read: [],
              track_record: { status: 'untested', worked: 0, failed: 0 },
              trust: { level: 'stated', stated_by: 'Erkki Expert' },
            },
          ],
          null,
          2
        ),
      },
    },
  },
  {
    id: 'firmware-invalidation',
    title: 'Firmware 4.2 Lifecycle Invalidation',
    subtitle: 'Temporal Expiry: Architect announces bug fix; rule becomes element-level condition',
    badge: 'Lifecycle · Invalidation',
    stages: {
      1: {
        inputTitle: 'Architect Invalidation Post',
        inputCode: JSON.stringify(
          {
            author: 'Aino Arkkitehti',
            role: 'Lead Network Architect',
            text: 'Firmware 4.2 rollout to older TX-3000 finished. Release notes confirm the SFP forwarding state bug is permanently fixed. Interface bounce is obsolete.',
          },
          null,
          2
        ),
        transformLabel: 'Slack bridge normalization · Identity mapping',
        outputTitle: 'Normalized Thread Event',
        outputCode: JSON.stringify(
          {
            source: 'teams',
            author: 'Aino Arkkitehti',
            role: 'Lead Network Architect',
            type: 'invalidation',
          },
          null,
          2
        ),
      },
      2: {
        inputTitle: 'Debounce Stage',
        inputCode: '{"status": "single_message_received", "idle_seconds": 2.0}',
        transformLabel: 'Burst timeout · Acquire store lock',
        outputTitle: 'Scheduled Lifecycle Job',
        outputCode: '{"job_id": "job_0089", "task": "lifecycle_reconciliation"}',
      },
      3: {
        inputTitle: 'Understand Input',
        inputCode: '{"topic": "sfp-swap-forwarding-state", "author": "Aino Arkkitehti"}',
        transformLabel: 'LLMExtractor extraction',
        outputTitle: 'Extraction Result (Invalidation)',
        outputCode: JSON.stringify(
          {
            type: 'invalidation',
            topic: 'sfp-swap-forwarding-state',
            fact: 'Firmware 4.2 fixes forwarding state bug; bounce is obsolete',
            confidence: 0.95,
          },
          null,
          2
        ),
      },
      4: {
        inputTitle: 'Critic Gate',
        inputCode: '{"evidence_quote": "Firmware 4.2 rollout... permanently fixed"}',
        transformLabel: 'Deterministic quote check',
        outputTitle: 'Critic Verdict',
        outputCode: '{"verdict": "keep", "confidence": 0.95}',
      },
      5: {
        inputTitle: 'Link Scope Resolution',
        inputCode: '{"scope": {"type": "transmission_node", "install_year_max": 2019}}',
        transformLabel: 'Scope binding',
        outputTitle: 'Bound Invalidation Node',
        outputCode: JSON.stringify(
          {
            id: 'ctx_0002',
            type: 'invalidation',
            topic: 'sfp-swap-forwarding-state',
            bound_to: [{ entity: 'class:transmission_node:installed-upto-2019', role: 'applies_to' }],
          },
          null,
          2
        ),
      },
      6: {
        inputTitle: 'Store Invalidation',
        inputCode: '{"assertion_id": "ctx_0002", "type": "invalidation"}',
        transformLabel: 'Index new invalidation',
        outputTitle: 'Indexed Invalidation',
        outputCode: '{"stored": true, "id": "ctx_0002"}',
      },
      7: {
        inputTitle: 'Reconciliation Execution',
        inputCode: JSON.stringify(
          {
            target_topic: 'sfp-swap-forwarding-state',
            reach_check: 'old_reach (TRN-042, TRN-117) ⊆ new_reach',
            detected_firmware_version: '4.2',
          },
          null,
          2
        ),
        transformLabel: 'lifecycle.reconcile() reach comparison & firmware condition attachment',
        outputTitle: 'Reconciled Knowledge State',
        outputCode: JSON.stringify(
          {
            ctx_0001_modification: {
              attached_condition: {
                text: 'firmware < 4.2',
                check: { field: 'firmware', op: '<', value: '4.2' },
              },
              note: 'Condition attached instead of blind calendar expiry',
            },
            ctx_0002_status: 'active_invalidation',
          },
          null,
          2
        ),
      },
      8: {
        inputTitle: 'Dual Element Query (TRN-042 vs TRN-117)',
        inputCode: JSON.stringify(
          {
            query_1: { entity: 'TRN-042', inventory_firmware: '3.8' },
            query_2: { entity: 'TRN-117', inventory_firmware: '4.2' },
          },
          null,
          2
        ),
        transformLabel: 'Semver Check.evaluate numeric comparison',
        outputTitle: 'Differentiation at Same Timestamp t',
        outputCode: JSON.stringify(
          {
            TRN_042_result: {
              rule_offered: 'ctx_0001 (Bounce interface)',
              check_status: 'fully checked',
              reason: 'firmware 3.8 < 4.2 condition MET',
            },
            TRN_117_result: {
              rule_offered: 'ctx_0002 (Invalidation: upgrade to 4.2 makes bounce obsolete)',
              check_status: 'condition failed',
              reason: 'firmware 4.2 < 4.2 condition FAILED',
            },
          },
          null,
          2
        ),
      },
    },
  },
  {
    id: 'site-access',
    title: 'Northern Finland Locked Barrier Access',
    subtitle: 'Physical Layer Metadata: Private road barrier lockbox code hidden in operational email',
    badge: 'Access · Key Code',
    stages: {
      1: {
        inputTitle: 'Operational Email Ingestion',
        inputCode: JSON.stringify(
          {
            source: 'email',
            subject: 'Re: Access to SITE-NF-017 Sodankyla',
            from: 'Harri SiteOps <harri.siteops@elisa.fi>',
            body: 'Heads up: the private forestry road barrier leading to SITE-NF-017 is locked. Key is inside lockbox #3 behind the transformer kiosk. Code is 8421.',
          },
          null,
          2
        ),
        transformLabel: 'Email parser · Identity resolution',
        outputTitle: 'Normalized Email LiveThread',
        outputCode: JSON.stringify(
          {
            thread_id: 'email:SITE-NF-017-access',
            source: 'email',
            author: 'Harri SiteOps',
            text: 'Key is inside lockbox #3 behind the transformer kiosk. Code is 8421.',
          },
          null,
          2
        ),
      },
      2: {
        inputTitle: 'Scheduling Stage',
        inputCode: '{"channel": "email", "idle_seconds": 0.0}',
        transformLabel: 'Emails trigger immediately without burst debounce',
        outputTitle: 'Job Initialized',
        outputCode: '{"job_id": "job_0104", "immediate": true}',
      },
      3: {
        inputTitle: 'Understand Input',
        inputCode: '{"text": "Key is inside lockbox #3... Code 8421", "type": "access"}',
        transformLabel: 'LLMExtractor extraction',
        outputTitle: 'Extracted Access Item',
        outputCode: JSON.stringify(
          {
            type: 'access',
            topic: 'site-barrier-key',
            summary: 'Access barrier key code for SITE-NF-017 private road.',
            fact: 'Key is inside lockbox #3 behind transformer kiosk. Code: 8421.',
            action: 'Enter 8421 on lockbox #3 behind transformer kiosk to retrieve road barrier key.',
            confidence: 0.95,
          },
          null,
          2
        ),
      },
      4: {
        inputTitle: 'Critic Gate',
        inputCode: '{"quote": "Key is inside lockbox #3 behind the transformer kiosk. Code is 8421."}',
        transformLabel: 'Verbatim quote verification',
        outputTitle: 'Critic Verdict',
        outputCode: '{"verdict": "keep", "confidence": 0.95}',
      },
      5: {
        inputTitle: 'Site Entity Matching',
        inputCode: '{"raw_mention": "SITE-NF-017 Sodankyla"}',
        transformLabel: 'Inventory site lookup · Role binding',
        outputTitle: 'Linked Access Assertion',
        outputCode: JSON.stringify(
          {
            id: 'ctx_0003',
            type: 'access',
            topic: 'site-barrier-key',
            bound_to: [{ entity: 'SITE-NF-017', role: 'applies_to' }],
            trust: { level: 'stated', stated_by: 'Harri SiteOps' },
          },
          null,
          2
        ),
      },
      6: {
        inputTitle: 'Store Execution',
        inputCode: '{"assertion_id": "ctx_0003", "bound_entity": "SITE-NF-017"}',
        transformLabel: 'Insert assertion into ContextStore',
        outputTitle: 'Indexed Access Node',
        outputCode: '{"id": "ctx_0003", "status": "indexed"}',
      },
      7: {
        inputTitle: 'Reconciliation Stage',
        inputCode: '{"new_assertion": "ctx_0003", "type": "access"}',
        transformLabel: 'Conflict check against prior access codes',
        outputTitle: 'Reconciled Access State',
        outputCode: '{"conflicts": [], "active": true}',
      },
      8: {
        inputTitle: 'Dispatcher Agent Guard Check',
        inputCode: JSON.stringify(
          {
            mcp_tool: 'check_action',
            arguments: {
              action: 'dispatch field engineer to SITE-NF-017 for antenna inspection',
              entity_id: 'SITE-NF-017',
            },
          },
          null,
          2
        ),
        transformLabel: 'guard.check() ask-before-act inspection',
        outputTitle: 'Guard Verdict Response',
        outputCode: JSON.stringify(
          {
            decision: 'adapt',
            action: 'dispatch field engineer to SITE-NF-017',
            steps: [
              'Enter 8421 on lockbox #3 behind transformer kiosk to retrieve road barrier key.',
            ],
            reasons: [
              'Site access: Key is inside lockbox #3 behind transformer kiosk. Code: 8421. (ctx_0003, stated by Harri SiteOps)',
            ],
          },
          null,
          2
        ),
      },
    },
  },
]

export default function PipelinePage() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('sfp-workaround')
  const [activeStageId, setActiveStageId] = useState<number>(3)
  const [tabMode, setTabMode] = useState<'pipeline' | 'ontology'>('pipeline')
  const [copiedUml, setCopiedUml] = useState(false)

  const scenario = SCENARIOS.find((s) => s.id === selectedScenarioId) ?? SCENARIOS[0]
  const stage = STAGES.find((s) => s.id === activeStageId) ?? STAGES[2]
  const payload = scenario.stages[activeStageId] ?? scenario.stages[1]

  const copyUmlSummary = async () => {
    const text = `End-to-End Operational Pipeline:\n1. Ingestion (slack_bridge.py)\n2. Burst Debounce (processor.py)\n3. Understand (understand.py)\n4. Critic Verification (critic.py)\n5. Precision Scope Linking (link.py)\n6. Store & Deduplication (store.py)\n7. Arbitration & Lifecycle (lifecycle.py)\n8. Graph Projection & MCP (mcp_server.py)`
    try {
      await navigator.clipboard.writeText(text)
      setCopiedUml(true)
      setTimeout(() => setCopiedUml(false), 1500)
    } catch {
      // clipboard fallback
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-bg p-4 sm:p-6 lg:p-8">
      {/* Page Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-text">
              Pipeline Architecture & Technical Walkthrough
            </h1>
            <Badge className="bg-accent/10 font-mono text-accent">Technical Specialist View</Badge>
          </div>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">
            End-to-end technical justification and step-by-step transformation: from unstructured human conversational
            bursts into a multi-layer temporal knowledge graph consumed by autonomous AI network agents.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => setTabMode('pipeline')}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium transition',
                tabMode === 'pipeline' ? 'bg-accent text-white' : 'text-muted hover:text-text'
              )}
            >
              Pipeline Stages
            </button>
            <button
              type="button"
              onClick={() => setTabMode('ontology')}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium transition',
                tabMode === 'ontology' ? 'bg-accent text-white' : 'text-muted hover:text-text'
              )}
            >
              Multi-Layer Ontology
            </button>
          </div>
          <Button variant="ghost" size="sm" icon={<Copy size={13} />} onClick={copyUmlSummary}>
            {copiedUml ? 'Copied' : 'Copy Architecture'}
          </Button>
        </div>
      </div>

      {tabMode === 'pipeline' ? (
        <div className="space-y-6">
          {/* Scenario Selector */}
          <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Demonstration Scenario:
              </span>
              <span className="text-xs text-muted">Interactive payloads change per scenario</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => setSelectedScenarioId(sc.id)}
                  className={cn(
                    'flex flex-col items-start rounded-lg border p-3 text-left transition',
                    selectedScenarioId === sc.id
                      ? 'border-accent bg-accent/5 ring-1 ring-accent'
                      : 'border-line bg-surface-2 hover:border-line hover:bg-surface'
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-medium text-text text-sm">{sc.title}</span>
                    <Badge className="bg-surface-3 text-[10px] text-muted">{sc.badge}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted leading-relaxed">{sc.subtitle}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Stepper Navigation */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {STAGES.map((s) => {
              const active = s.id === activeStageId
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveStageId(s.id)}
                  className={cn(
                    'flex flex-col items-start rounded-lg border p-2.5 text-left transition',
                    active
                      ? 'border-accent bg-accent/10 shadow-sm'
                      : 'border-line bg-surface hover:bg-surface-2'
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className={cn('text-xs font-bold font-mono', active ? 'text-accent' : 'text-muted')}>
                      Step {s.id}
                    </span>
                    {active && <span className="size-1.5 rounded-full bg-accent" />}
                  </div>
                  <span className="mt-1 line-clamp-1 font-medium text-xs text-text">{s.name.split('. ')[1]}</span>
                  <span className="mt-0.5 line-clamp-1 text-[11px] text-muted">{s.key}</span>
                </button>
              )
            })}
          </div>

          {/* Main Stage Deep Dive: Two Columns */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left: Technical Breakdown & Architectural Justification */}
            <div className="space-y-5 lg:col-span-7">
              {/* Stage Header Card */}
              <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                  <div>
                    <span className="font-mono text-xs text-accent">STAGE 0{stage.id}</span>
                    <h2 className="font-display text-xl font-bold text-text">{stage.name}</h2>
                  </div>
                  <Badge
                    className={cn(
                      'font-mono text-xs',
                      stage.badgeTone === 'ok' && 'bg-ok/10 text-ok',
                      stage.badgeTone === 'warn' && 'bg-warn/10 text-warn',
                      stage.badgeTone === 'info' && 'bg-info/10 text-info',
                      stage.badgeTone === 'accent' && 'bg-accent/10 text-accent'
                    )}
                  >
                    {stage.badge}
                  </Badge>
                </div>

                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Architectural Purpose</h3>
                  <p className="mt-1 text-sm font-medium leading-relaxed text-text">{stage.purpose}</p>
                </div>

                <div className="mt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Technical Execution Details</h3>
                  <ul className="mt-2 space-y-2">
                    {stage.technicalDetails.map((detail, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs">
                  <span className="flex items-center gap-1 font-mono text-muted">
                    <FileCode2 size={13} className="text-accent" />
                    <code>{stage.module}</code>
                  </span>
                  <span className="text-muted">·</span>
                  <span className="text-muted">
                    Contract: <code className="text-text">{stage.contract}</code>
                  </span>
                </div>
              </div>

              {/* Justification Box: "Why this design?" */}
              <div className="rounded-xl border border-accent/20 bg-accent/5 p-5">
                <div className="flex items-center gap-2 text-accent">
                  <ShieldCheck size={18} />
                  <h3 className="font-semibold text-sm">Specialist Architectural Justification</h3>
                </div>
                <h4 className="mt-2 font-medium text-sm text-text">{stage.designJustification.question}</h4>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{stage.designJustification.answer}</p>
                <div className="mt-3 rounded border border-line bg-surface/70 px-3 py-1.5 text-[11px] font-mono text-accent">
                  {stage.designJustification.elisaContext}
                </div>
              </div>
            </div>

            {/* Right: Demonstrative Live Payload Trace */}
            <div className="space-y-4 lg:col-span-5">
              <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <Terminal size={14} className="text-accent" /> Demonstrative Payload Transformation
                  </span>
                  <Badge className="bg-surface-2 text-[10px] text-muted">Step {stage.id} Trace</Badge>
                </div>

                {/* Input Payload */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] font-mono text-muted">
                    <span>INPUT: {payload.inputTitle}</span>
                  </div>
                  <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text">
                    {payload.inputCode}
                  </pre>
                </div>

                {/* Transition Action */}
                <div className="my-3 flex items-center justify-center">
                  <div className="flex items-center gap-2 rounded-full border border-line bg-surface-3 px-3 py-1 text-[11px] font-mono text-accent">
                    <ArrowRight size={12} />
                    <span>{payload.transformLabel}</span>
                  </div>
                </div>

                {/* Output Payload */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] font-mono text-muted">
                    <span>OUTPUT: {payload.outputTitle}</span>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-lg border border-accent/20 bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text">
                    {payload.outputCode}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Multi-Layer Ontology Visualizer Tab */
        <div className="space-y-6">
          <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
            <h2 className="font-display text-xl font-bold text-text">Elisa Multi-Layer Knowledge Graph Ontology</h2>
            <p className="mt-1 text-sm text-muted">
              How human communication, extraction artifacts, network inventory, and operational lifecycle bind together
              at any timestamp $t$.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-accent">
                  <MessageSquare size={16} /> 1. Provenance Layer
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Captures origin channels (Slack, Teams, Email). Every message is preserved with author credentials and
                  timestamp to guarantee human auditability.
                </p>
                <div className="mt-3 font-mono text-[11px] text-text">
                  (Person)-[:AUTHORED]-&gt;(Message)-[:PART_OF]-&gt;(Thread)
                </div>
              </div>

              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-info">
                  <Cpu size={16} /> 2. Extraction Layer
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Context assertions extracted from verified quotes. Encapsulates machine predicates, trust levels, and
                  verbatim justification quotes.
                </p>
                <div className="mt-3 font-mono text-[11px] text-text">
                  (Assertion)-[:DERIVED_FROM]-&gt;(Message)
                </div>
              </div>

              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-ok">
                  <Network size={16} /> 3. Topology & Operational Layer
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Network equipment hierarchy. Assertions bind to abstract classes or concrete elements using roles
                  (applies_to, observed_on, trigger).
                </p>
                <div className="mt-3 font-mono text-[11px] text-text">
                  (Element)-[:MEMBER_OF]-&gt;(Class)-[:LOCATED_AT]-&gt;(Site)
                </div>
              </div>

              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-warn">
                  <Scale size={16} /> 4. Lifecycle & Arbitration Layer
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Multi-agent arbitration edges. When new firmware rolls out or experts disagree, assertions reference
                  each other temporally without erasing history.
                </p>
                <div className="mt-3 font-mono text-[11px] text-text">
                  (Assertion)-[:CLOSED_BY | :CONFLICTS_WITH]-&gt;(Assertion)
                </div>
              </div>

              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-accent">
                  <Bot size={16} /> 5. Autonomous Agent Layer (MCP)
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Model Context Protocol tools (get_context, check_action) allowing Google ADK / Anthropic MCP agents to
                  query knowledge safely.
                </p>
                <div className="mt-3 font-mono text-[11px] text-text">
                  (AutonomousAgent)-[:CALLS]-&gt;[get_context(observations)]
                </div>
              </div>

              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-text">
                  <Activity size={16} /> 6. Feedback Outcome Loop
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Continuous calibration. When an agent executes advice in the field, outcomes record whether it worked,
                  flagging contested rules automatically.
                </p>
                <div className="mt-3 font-mono text-[11px] text-text">
                  (Assertion)-[:HAS_OUTCOME]-&gt;(Outcome: worked=true/false)
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
