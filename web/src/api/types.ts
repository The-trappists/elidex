// Mirror of src/context_layer/models.py and src/context_layer/workbench/contracts.py.
// Change both sides together. Datetimes are ISO strings without timezone, in *simulated* time
// unless the comment says "wall".

// ---------------------------------------------------------------- core (models.py)

export type SourceKind = 'teams' | 'email' | 'slack' | 'operator'
export type AssertionType = 'workaround' | 'access' | 'fact' | 'invalidation'
export type TrustLevel = 'hunch' | 'stated' | 'verified'
export type BindingRole = 'applies_to' | 'observed_on' | 'trigger'
export type Op = '==' | '!=' | '<' | '<=' | '>' | '>='

export interface Message {
  thread_id: string
  source: SourceKind
  seq: number
  author: string
  role: string | null
  sent_at: string
  text: string
}

export interface NetworkElement {
  id: string
  type: string
  model: string
  install_year: number
  firmware: string | null
  site_id: string | null
  aliases: string[]
}

export interface Site {
  id: string
  name: string
  region: string | null
}

export interface ClassCriteria {
  type: string | null
  model: string | null
  install_year_min: number | null
  install_year_max: number | null
}

export interface ElementClass {
  id: string
  label: string
  criteria: ClassCriteria
}

export interface Check {
  field: string
  op: Op
  value: unknown
}

export interface Condition {
  text: string
  check: Check | null
}

export interface Scope {
  instance_ids: string[]
  site_ids: string[]
  element_class: ClassCriteria | null
  trigger: string | null
  qualifier: string | null
}

export interface ExtractedItem {
  type: AssertionType
  topic: string
  summary: string
  scope: Scope
  conditions: Condition[]
  diagnosis: string | null
  action: string | null
  avoid: string[]
  fact: string | null
  trust_level: TrustLevel
  evidence: string | null
  stated_by: string
  cited_seq: number[]
  evidence_quote: string | null
  confidence: number
}

export interface ExtractionResult {
  items: ExtractedItem[]
}

export interface Binding {
  entity: string
  role: BindingRole
}

export interface Trust {
  level: TrustLevel
  stated_by: string
  role: string | null
  evidence: string | null
}

export interface SourceRef {
  source: SourceKind
  file: string // thread id
  seq: number[]
}

export interface ContextAssertion {
  id: string
  type: AssertionType
  topic: string
  summary: string
  bound_to: Binding[]
  conditions: Condition[]
  diagnosis: string | null
  action: string | null
  avoid: string[]
  fact: string | null
  valid_from: string
  valid_to: string | null // null = still believed true
  closed_by: string | null
  trust: Trust
  sources: SourceRef[]
  conflicts_with: string[]
  confidence: number
  link_notes: string[]
}

// ---------------------------------------------------------------- workbench (contracts.py)

export type Origin = 'elisa' | 'synthetic' | 'generated' | 'manual' | 'slack'
export const REMOVABLE_ORIGINS: Origin[] = ['generated', 'manual', 'slack']

export type ThreadSource = SourceKind
export type ThreadStatus = 'active' | 'idle' | 'processing' | 'processed' | 'error'
export type ExtractorMode = 'auto' | 'llm' | 'scripted'
export type StageName = 'listen' | 'understand' | 'link' | 'store' | 'reconcile'
export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'
export type Severity = 'minor' | 'major' | 'critical'
export type IncidentStatus = 'open' | 'resolved'
export type LinkKind = 'fiber' | 'microwave' | 'backhaul'
export type LlmPurpose = 'extract' | 'generate_scenario' | 'agent' | 'check' | 'critic' | 'judge'
export type JsonMode = 'json_object' | 'json_schema' | 'prompt'

export const STAGES: StageName[] = ['listen', 'understand', 'link', 'store', 'reconcile']

export interface WbElement extends NetworkElement {
  origin: Origin
}

export interface WbSite extends Site {
  origin: Origin
  lat: number | null
  lon: number | null
}

export interface TopologyLink {
  id: string
  a: string
  b: string
  kind: LinkKind
  origin: Origin
}

export interface Persona {
  id: string
  name: string
  role: string
  team: string | null
  avatar_color: string
  expertise: string
  style: string
  origin: Origin
}

export interface IncidentSpec {
  entity_id: string
  kind: string
  severity: Severity
  summary: string
  observations: Record<string, unknown>
}

export interface Incident extends IncidentSpec {
  id: string
  status: IncidentStatus
  opened_at: string
  resolved_at: string | null
  thread_id: string | null
  scenario_id: string | null
  origin: Origin
}

export interface ScenarioMessage {
  persona: string
  delay_s: number
  text: string
}

export interface Scenario {
  id: string
  title: string
  description: string
  channel: ThreadSource
  subject: string | null
  incident: IncidentSpec | null
  participants: string[]
  messages: ScenarioMessage[]
  resolves_incident_at_seq: number | null
  expected: ExtractionResult | null
  tags: string[]
  origin: Origin
}

export interface ScenarioRun {
  id: string
  scenario_id: string
  thread_id: string
  incident_id: string | null
  started_at: string
  next_seq: number
  done: boolean
}

export interface LiveThread {
  id: string
  source: ThreadSource
  subject: string | null
  messages: Message[] // empty in thread.upserted events: messages arrive via message.posted
  participants: string[]
  origin: Origin
  status: ThreadStatus
  scenario_id: string | null
  incident_id: string | null
  slack_ts: string | null
  created_at: string
  last_message_at: string | null
  last_job_id: string | null
}

export interface Stage {
  stage: StageName
  status: StageStatus
  detail: string
  duration_ms: number | null
}

export interface EvalResult {
  matched: string[]
  missed: string[]
  unexpected: string[]
  binding_diffs: string[]
}

export type FlagKind =
  | 'abstained'
  | 'low_confidence'
  | 'conflict'
  | 'over_reach'
  | 'critic_rejected'
  | 'judge_decision'
  | 'operator_edit'

export interface ReviewFlag {
  id: string
  kind: FlagKind
  thread_id: string
  job_id: string
  assertion_id: string | null
  item_topic?: string | null // topic of the item or assertion the flag is about, when known
  message: string
  detail: string | null
  created_at: string // wall
  dismissed: boolean
}

export type ApplicationOutcome = 'pending' | 'worked' | 'failed' | 'unclear'

export interface RuleApplication {
  id: string
  assertion_id: string
  entity_id: string
  thread_id: string
  applied_at: string // sim
  message_seq: number | null
  outcome: ApplicationOutcome
  outcome_quote: string | null
  outcome_reason: string | null
  outcome_at: string | null // sim
  method: 'llm' | 'heuristic' | 'observation' | null
}

export interface TrackRecord {
  status: 'untested' | 'ok' | 'contested'
  worked: number
  failed: number
  failed_on: string[]
  thread: number // outcomes that came from a human reply in a thread
  last_at: string | null
}

export type CriticVerdictKind = 'keep' | 'downgrade' | 'reject'

export interface AssertionEdit {
  id: string
  assertion_id: string
  ts: string // wall
  note: string | null
  before: Record<string, unknown>
  after: Record<string, unknown>
  undone: boolean
}

export interface CriticVerdict {
  item_topic: string
  verdict: CriticVerdictKind
  reason: string
  evidence_found: boolean
  confidence_after: number | null
}

export type JudgeVerdictKind = 'supports' | 'contradicts' | 'supersedes' | 'unrelated'

export interface JudgeVerdict {
  new_assertion_id: string
  other_assertion_id: string
  verdict: JudgeVerdictKind
  reason: string
}

export interface PipelineJob {
  id: string
  thread_id: string
  started_at: string // wall
  finished_at: string | null // wall
  extractor: string // "llm:<model>" | "scripted" | "cache" | "none"
  stages: Stage[]
  items: ExtractedItem[]
  notes: string[]
  assertion_ids: string[]
  removed_assertion_ids: string[]
  events: string[]
  llm_call_ids: string[]
  eval: EvalResult | null
  flags: ReviewFlag[]
  critic: CriticVerdict[]
  judge: JudgeVerdict[]
  error: string | null
}

export interface LlmUsage {
  prompt_tokens: number | null
  completion_tokens: number | null
  cost: number | null
}

export interface LlmCall {
  id: string
  ts: string // wall
  sim_time: string | null
  purpose: LlmPurpose
  thread_id: string | null
  provider: string // "primary" | "fallback" | "critic" | "critic_fallback"
  role: string | null // "primary" | "critic"
  base_url: string
  model: string
  json_mode: JsonMode | null
  system: string
  user: string
  raw_response: string | null
  parsed_ok: boolean | null
  parse_error: string | null
  latency_ms: number | null
  usage: LlmUsage
  fallback_used: boolean
  error: string | null
}

export interface Settings {
  extractor_mode: ExtractorMode
  lifecycle: boolean
  idle_seconds: number
  use_conditions: boolean
  use_guard: boolean
  slack_mirror: boolean
  auto_sim: boolean
  auto_every_s: number
  use_critic: boolean
  use_judge: boolean
  use_outcome_loop: boolean
  // read-only
  llm_configured: boolean
  llm_model: string | null
  llm_fallback_model: string | null
  slack_connected: boolean
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'extractor_mode'
    | 'lifecycle'
    | 'idle_seconds'
    | 'use_conditions'
    | 'use_guard'
    | 'slack_mirror'
    | 'auto_sim'
    | 'auto_every_s'
    | 'use_critic'
    | 'use_judge'
    | 'use_outcome_loop'
  >
>

export interface RerunBody {
  items?: ExtractedItem[] | null
  model?: string | null
  from_stage?: 'link' | 'store'
}

export interface OperatorEdit {
  summary?: string | null
  action?: string | null
  avoid?: string[] | null
  conditions?: Condition[] | null
  valid_to?: string | null
  trust_level?: TrustLevel | null
  note?: string | null
}

export interface ClockState {
  sim_now: string
  speed: number
  running: boolean
}

export interface StateSnapshot {
  clock: ClockState
  settings: Settings
  elements: WbElement[]
  sites: WbSite[]
  links: TopologyLink[]
  personas: Persona[]
  threads: LiveThread[]
  incidents: Incident[]
  assertions: ContextAssertion[]
  classes: ElementClass[]
  jobs: PipelineJob[]
  scenarios: Scenario[]
  runs: ScenarioRun[]
  llm_calls: LlmCall[]
}

export interface SlackStatus {
  connected: boolean
  channel: string | null
  error: string | null
}

// SSE events: GET /api/stream, one JSON WbEvent per `data:` line.
export type WbEvent =
  | Ev<'clock', ClockState>
  | Ev<'settings.changed', Settings>
  | Ev<'message.posted', { thread_id: string; message: Message }>
  | Ev<'thread.upserted', LiveThread>
  | Ev<'thread.deleted', { id: string }>
  | Ev<'incident.upserted', Incident>
  | Ev<'incident.deleted', { id: string }>
  | Ev<'pipeline.job', PipelineJob>
  | Ev<'assertion.upserted', ContextAssertion>
  | Ev<'assertion.deleted', { id: string }>
  | Ev<'class.upserted', ElementClass>
  | Ev<'inventory.changed', { elements: WbElement[]; sites: WbSite[]; links: TopologyLink[] }>
  | Ev<'personas.changed', { personas: Persona[] }>
  | Ev<'scenarios.changed', { scenarios: Scenario[]; runs: ScenarioRun[] }>
  | Ev<'slack.status', SlackStatus>
  | Ev<'llm.call', LlmCall>
  | Ev<'review.flag', ReviewFlag>
  | Ev<'application.upserted', RuleApplication>
  | Ev<'state.reset', Record<string, never>>
  | Ev<'log', { level: 'info' | 'warning' | 'error'; text: string }>

interface Ev<T extends string, D> {
  id: number
  ts: string // wall
  sim_time: string
  type: T
  data: D
}

// ---------------------------------------------------------------- request / response bodies

export interface NewThreadBody {
  source: ThreadSource
  subject?: string | null
  participants?: string[]
}

export interface PostMessageBody {
  persona_id?: string | null
  author?: string | null
  role?: string | null
  text: string
}

export interface GuardBody {
  action: string
  entity_id: string
  at?: string | null
  observations?: Record<string, unknown> | null
}

export interface GuardVerdict {
  decision: 'go' | 'adapt'
  action: string
  steps: string[]
  reasons: string[]
}

export interface AgentRunBody {
  entity_id: string
  observations?: Record<string, unknown>
  planned_action?: string | null
  description?: string
  at?: string | null
  use_llm?: boolean
}

export interface ContextHit extends ContextAssertion {
  matched_via: string
}

// Knowledge graph views (GET /api/graph/*, see docs/knowledge-graph.md)
export interface GraphProvenance {
  message: string | null // null when the thread is known but the message is not loaded
  file: string | null
  source: SourceKind | null
  seq: number | null
  author: string | null
  role: string | null
  sent_at: string | null
  text: string | null
}

export interface GraphReach {
  assertion: string
  elements: Record<string, string> // element id -> how it is reached ("direct", a class id, "site X")
  sites: string[]
}

export interface GraphExpert {
  person: string
  role: string | null
  assertions: string[]
  verified: number
}

export interface GraphTimelineRow {
  id: string
  type: AssertionType
  topic: string
  summary: string
  matched_via: string
  valid_from: string
  valid_to: string | null
  status: 'future' | 'valid' | 'closed'
  closed_by: string | null
  conflicts_with: string[]
  stated_by: string
  trust: TrustLevel
}

export interface GraphMention {
  message: string
  file: string
  seq: number
  author: string
  sent_at: string
  text: string
  extracted_into: string[] // assertion ids; empty = named in a message but nothing was extracted
}

export interface AgentRunResult {
  recommendation: string
  hits: ContextHit[]
  skipped: { assertion_id: string; reason: string }[]
  verdict: GuardVerdict | null
  thread_id?: string | null // outcome loop: thread the agent message was posted in
  applications?: RuleApplication[]
  cited_assertion_ids: string[]
  evidence_confidence: number | null
}

export interface LlmCheckResult {
  provider: string
  base_url: string
  model: string
  ping_ok: boolean
  modes: Record<string, { ok: boolean; latency_ms: number | null; error: string | null; items: number | null }>
  recommended_mode: JsonMode | null
}

// Fields an agent can observe (models.OBSERVABLE_FIELDS): used by incident and agent forms.
export const OBSERVABLE_FIELDS: Record<string, string> = {
  sfp_replaced: 'bool, an optical module was just replaced',
  interface_status: '"UP" or "DOWN"',
  optical_levels: '"normal", "low" or "high"',
  traffic_counters: 'number, packets per second on the interface',
  alarms: '"active" or "cleared"',
}

// ---------------------------------------------------------------- knowledge graph view (GET /graph)

export type KgKind = 'Element' | 'Site' | 'Class' | 'Event' | 'Assertion' | 'Person' | 'Message' | 'Thread'

/** One Cytoscape element from the knowledge graph; node data holds the node's properties. */
export interface KgElement {
  group: 'nodes' | 'edges'
  data: { id: string; kind?: KgKind; label?: string; source?: string; target?: string; valid?: boolean; [prop: string]: unknown }
}

export interface KgGraph {
  at: string
  elements: KgElement[]
}

/** POST /data/load-dataset: what the loaded sample of the company dataset contains. */
export interface DatasetSample {
  dataset: string
  sites: number
  elements: number
  links: number
  threads: number
  threads_by_kind: Record<string, number>
  personas: number
  assertions: number
  connected_components: number
}

/** GET /sources/...: human activity around an element (docs/workbench.md). Every answer names its source and status. */
export type SourceName = 'files' | 'atlas' | 'tiger' | 'workbench'
export type SourceStatus = 'ok' | 'not_configured' | 'error' | 'timeout'
export interface SourceAnswer {
  source: SourceName
  status: SourceStatus
  detail: string | null
  fallback_from?: { source: SourceName; status: SourceStatus; detail: string }
}
export interface SourceThread {
  id: string
  source: 'slack' | 'teams' | 'email'
  subject: string | null
  started_at: string
  ended_at: string
  n_messages: number
  authors: string[]
  preview: { seq: number | null; author: string; role: string | null; sent_at: string; text: string }[]
  in_workbench: boolean
}
export interface SourceThreads extends SourceAnswer {
  element: string
  total: number
  offset: number
  limit: number
  has_more: boolean
  items: SourceThread[]
}
export interface SourceFreshness extends SourceAnswer {
  element: string
  last_discussed: string | null
  days_since: number | null
  messages: number
  active_days: number
  threads: number | null
  by_month: { month: string; messages: number; people: number }[]
}
export interface SourceSimilar extends SourceAnswer {
  query: string
  mode: string
  items: { id: string; topic: string | null; summary: string; score: number; trust: string | null; applies_to?: string[]; bound_here?: boolean }[]
}

// ---------------------------------------------------------------- patterns (GET /patterns, see docs/patterns.md)

export type PatternLevel = 'watch' | 'insight' | 'resolved'
export type PatternStrength = 'strong' | 'medium' | 'weak'

export interface PatternOccurrence {
  element: string
  at: string
  topic: string
  problem: string // topics that name the same problem share it
  assertion_id: string
  kind: 'reported' | 'applied'
  sources: string[]
  by: string | null
  action: string | null
  worked: boolean | null
}

export interface PatternFactor {
  kind: 'dependency' | 'link' | 'site' | 'firmware' | 'model'
  entity: string
  strength: PatternStrength
  covers: string[]
  detail: string
  reported: boolean | null // dependency: false = nobody mentioned it (hidden suspect)
}

export interface PatternFix {
  assertion_id: string
  action: string
  stated_by: string
  at: string
  kind: 'temporary' | 'lasting' | 'unknown'
  applied: number
}

export interface PatternHypothesis {
  text: string
  basis: string[]
  strength: PatternStrength
}

/** A recurring or linked problem found in captured knowledge. Hypotheses only: never used as rules by the agent. */
export interface Pattern {
  id: string
  kind: 'recurring' | 'linked'
  level: PatternLevel
  title: string
  elements: string[]
  topics: string[]
  first_seen: string
  last_seen: string
  count: number
  occurrences: PatternOccurrence[]
  factors: PatternFactor[]
  fixes: PatternFix[]
  lasting_fixes: PatternFix[]
  hypotheses: PatternHypothesis[]
  status_note: string | null
  resolved_by: string | null
  people: string[]
  grouped: string[] // why differently named topics were counted as one problem
  note: string
}

export interface PatternReport {
  at: string
  meaning: string // how differently worded topics were compared: words only, or words + an embedding model
  patterns: Pattern[]
}
