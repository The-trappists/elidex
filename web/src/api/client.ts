// Typed client for every /api route (see docs/workbench.md). Errors throw ApiError with the
// backend's `detail` message, ready for a toast.
import { fixtureAgentRun } from './fixtures/agentRun'
import type {
  AgentRunBody,
  DatasetSample,
  SourceFreshness,
  SourceSimilar,
  SourceThreads,
  AgentRunResult,
  ClockState,
  ContextHit,
  GraphExpert,
  GraphMention,
  GraphProvenance,
  GraphReach,
  GraphTimelineRow,
  GuardBody,
  GuardVerdict,
  Incident,
  IncidentSpec,
  LiveThread,
  LlmCall,
  LlmCheckResult,
  LlmSummary,
  Message,
  NewThreadBody,
  PatternReport,
  Persona,
  PostMessageBody,
  Scenario,
  ScenarioRun,
  Settings,
  SettingsPatch,
  SlackStatus,
  StateSnapshot,
  TopologyLink,
  WbElement,
  WbSite, KgGraph,
  CompanyState,
  CompanyStartBody,
  ContextAssertion,
  ElementClass,
  DedupeReport,
  Justification } from './types'
import { fixtureLlmCall, fixtureLlmCalls, fixtureLlmCompact, fixtureLlmSummary } from './fixtures/llm'

const FX = import.meta.env.VITE_REVIEW_FIXTURES === '1'

/** GET /company/package: what the autonomous system was handed at one cycle. */
export interface CompanyPackage {
  cycle?: number
  at?: string // fixtures only; the real endpoint nests it in `package`
  package?: { cycle: number; at: string } | null // null before the first sync
  assertions: ContextAssertion[]
  classes: ElementClass[]
}

/** GET /company/archive/stats: where the knowledge is archived and how much is in it. */
export interface ArchiveStats {
  backend: 'files' | 'atlas' | 'tiger-sink'
  counts: Record<string, number>
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const enc = encodeURIComponent
export const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return p.length ? '?' + p.map(([k, v]) => `${k}=${enc(String(v))}`).join('&') : ''
}

export const api = {
  // state
  state: () => req<StateSnapshot>('GET', '/state'),
  streamUrl: '/api/stream',

  // simulation
  simStart: () => req<ClockState>('POST', '/sim/start'),
  simPause: () => req<ClockState>('POST', '/sim/pause'),
  simSpeed: (speed: number) => req<ClockState>('POST', '/sim/speed', { speed }),
  simClock: (at: string) => req<ClockState>('POST', '/sim/clock', { at }),
  scenarios: () => req<Scenario[]>('GET', '/sim/scenarios'),
  saveScenario: (s: Scenario) => req<Scenario>('POST', '/sim/scenarios', s),
  deleteScenario: (id: string) => req<void>('DELETE', `/sim/scenarios/${enc(id)}`),
  runScenario: (id: string) => req<ScenarioRun>('POST', `/sim/scenarios/${enc(id)}/run`),
  generateScenario: (body: { entity_id?: string | null; hint?: string | null }) =>
    req<Scenario>('POST', '/sim/generate', body),

  // inventory
  createElement: (e: WbElement) => req<WbElement>('POST', '/elements', e),
  updateElement: (id: string, e: WbElement) => req<WbElement>('PUT', `/elements/${enc(id)}`, e),
  deleteElement: (id: string) => req<void>('DELETE', `/elements/${enc(id)}`),
  createSite: (s: WbSite) => req<WbSite>('POST', '/sites', s),
  updateSite: (id: string, s: WbSite) => req<WbSite>('PUT', `/sites/${enc(id)}`, s),
  deleteSite: (id: string) => req<void>('DELETE', `/sites/${enc(id)}`),
  createLink: (l: TopologyLink) => req<TopologyLink>('POST', '/links', l),
  updateLink: (id: string, l: TopologyLink) => req<TopologyLink>('PUT', `/links/${enc(id)}`, l),
  deleteLink: (id: string) => req<void>('DELETE', `/links/${enc(id)}`),

  // personas
  createPersona: (p: Persona) => req<Persona>('POST', '/personas', p),
  updatePersona: (id: string, p: Persona) => req<Persona>('PUT', `/personas/${enc(id)}`, p),
  deletePersona: (id: string) => req<void>('DELETE', `/personas/${enc(id)}`),

  // threads
  createThread: (body: NewThreadBody) => req<LiveThread>('POST', '/threads', body),
  postMessage: (threadId: string, body: PostMessageBody) =>
    req<Message>('POST', `/threads/${enc(threadId)}/messages`, body),
  processThread: (threadId: string) => req<void>('POST', `/threads/${enc(threadId)}/process`),
  deleteThread: (threadId: string) => req<void>('DELETE', `/threads/${enc(threadId)}`),

  // incidents
  createIncident: (spec: IncidentSpec) => req<Incident>('POST', '/incidents', spec),
  resolveIncident: (id: string) => req<Incident>('POST', `/incidents/${enc(id)}/resolve`),
  deleteIncident: (id: string) => req<void>('DELETE', `/incidents/${enc(id)}`),

  // knowledge
  context: (entity: string, at?: string | null, includeExpired = false) =>
    req<ContextHit[]>('GET', `/context/${enc(entity)}${qs({ at, include_expired: includeExpired })}`),
  deleteAssertion: (id: string) => req<void>('DELETE', `/assertions/${enc(id)}`),
  justification: (id: string): Promise<Justification> =>
    import.meta.env.VITE_REVIEW_FIXTURES === '1'
      ? import('./fixtures/justification').then((m) => m.fixtureJustification(id))
      : req<Justification>('GET', `/assertions/${enc(id)}/justification`),
  dedupe: (): Promise<DedupeReport> =>
    import.meta.env.VITE_REVIEW_FIXTURES === '1'
      ? import('./fixtures/justification').then((m) => m.FIXTURE_DEDUPE)
      : req<DedupeReport>('GET', '/knowledge/dedupe'),
  knowledgeExportUrl: (format: string, validOnly = true) => `/api/knowledge/export${qs({ format, valid_only: validOnly })}`,
  knowledgeGraph: (at?: string) => req<KgGraph>('GET', `/graph${qs({ at })}`),
  provenance: (assertionId: string) => req<GraphProvenance[]>('GET', `/graph/provenance/${enc(assertionId)}`),
  reach: (assertionId: string) => req<GraphReach>('GET', `/graph/reach/${enc(assertionId)}`),
  experts: (entityId: string, at?: string | null) =>
    req<GraphExpert[]>('GET', `/graph/experts${qs({ entity_id: entityId, at })}`),
  timeline: (entityId: string, at?: string | null) =>
    req<GraphTimelineRow[]>('GET', `/graph/timeline/${enc(entityId)}${qs({ at })}`),
  mentions: (entityId: string) => req<GraphMention[]>('GET', `/graph/mentions/${enc(entityId)}`),
  patterns: (entityId?: string | null, at?: string | null) =>
    req<PatternReport>('GET', `/patterns${qs({ entity_id: entityId, at })}`),
  patternsReportUrl: (at?: string | null) => `/api/patterns/report.md${qs({ at })}`,
  guard: (body: GuardBody) => req<GuardVerdict>('POST', '/guard', body),
  agentRun: (body: AgentRunBody) =>
    import.meta.env.VITE_REVIEW_FIXTURES === '1' ? Promise.resolve(fixtureAgentRun(body)) : req<AgentRunResult>('POST', '/agent/run', body),

  // data
  reset: (mode: 'seed' | 'empty') => req<void>('POST', '/data/reset', { mode }),
  deleteGenerated: () => req<{ removed: Record<string, number> }>('DELETE', '/data/generated'),
  exportUrl: '/api/data/export',
  import: (data: unknown) => req<void>('POST', '/data/import', data),
  sourceThreads: (el: string, offset = 0, limit = 8) => req<SourceThreads>('GET', `/sources/elements/${encodeURIComponent(el)}/threads?offset=${offset}&limit=${limit}`),
  sourceFreshness: (el: string) => req<SourceFreshness>('GET', `/sources/elements/${encodeURIComponent(el)}/freshness`),
  sourceSimilar: (q: string, entity: string) => req<SourceSimilar>('GET', `/sources/similar?q=${encodeURIComponent(q)}&entity=${encodeURIComponent(entity)}&limit=4`),
  loadDataset: (body: { sites: number; threads: number; seed?: number }) => req<DatasetSample>('POST', '/data/load-dataset', body),

  // settings
  settings: () => req<Settings>('GET', '/settings'),
  updateSettings: (patch: SettingsPatch) => req<Settings>('PUT', '/settings', patch),
  slackStatus: () => req<SlackStatus>('GET', '/slack/status'),

  // LLM
  llmCalls: (f: { purpose?: string; thread_id?: string; limit?: number } = {}) =>
    FX ? Promise.resolve(fixtureLlmCalls()) : req<LlmCall[]>('GET', `/llm/calls${qs(f)}`),
  llmCall: (id: string) => (FX ? Promise.resolve(fixtureLlmCall(id) as LlmCall) : req<LlmCall>('GET', `/llm/calls/${enc(id)}`)),
  llmSummary: () => (FX ? Promise.resolve(fixtureLlmSummary()) : req<LlmSummary>('GET', '/llm/summary')),
  llmCompact: () => (FX ? Promise.resolve(fixtureLlmCompact()) : req<LlmSummary>('POST', '/llm/compact')),
  llmCheck: () => req<LlmCheckResult[]>('POST', '/llm/check'),

  // company day
  company: () => req<CompanyState>('GET', '/company'),
  companyStart: (body: CompanyStartBody) => req<CompanyState>('POST', '/company/start', body),
  companyPause: () => req<CompanyState>('POST', '/company/pause'),
  companyResume: () => req<CompanyState>('POST', '/company/resume'),
  companyStop: () => req<CompanyState>('POST', '/company/stop'),
  companyArchiveStats: () => req<ArchiveStats>('GET', '/company/archive/stats'),
  companyPackage: (cycle?: number) => req<CompanyPackage>('GET', `/company/package${qs({ cycle })}`),
  companyExportUrl: (format: 'json' | 'markdown', validOnly = true) => `/api/company/export${qs({ format, valid_only: validOnly })}`,

  // exports (plain links: use <a href download>)
  exportLlmCallsUrl: '/api/export/llm-calls.jsonl',
  exportTranscriptUrl: (threadId?: string) => `/api/export/transcript.md${qs({ thread_id: threadId })}`,
  exportSessionUrl: '/api/export/session.json',
}
