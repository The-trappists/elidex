// Demo data for the Company day page, ONLY for VITE_REVIEW_FIXTURES=1 or `?demo=1`. It plays a short fake day
// (a few minutes) through the same event path as the real backend, so the page can be checked without it.
// Nothing here is imported on the normal path except `isDemo` and `demoIdleState`.
import type {
  AgentCall,
  CompanyCycle,
  CompanyState,
  CompanyStartBody,
  CompanyTimelineEntry,
  ContextAssertion,
  ElementHealth,
  HealthStatus,
  KgGraph,
  KgElement,
  LiveThread,
  Pattern,
  PatternOccurrence,
  PatternReport,
  PipelineJob,
  SourceKind,
  Stage,
  StageName,
  WbEvent,
} from '../types'

const DEMO = import.meta.env.VITE_REVIEW_FIXTURES === '1' || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === '1')
export const isDemo = () => DEMO

const DAY_MIN = 480
const CYCLE_MIN = 10
const SPEED = 120 // 1 wall second = 2 sim minutes
const T0 = new Date('2026-11-07T08:00:00')
const iso = (min: number) => {
  const d = new Date(T0.getTime() + min * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

interface Template {
  subject: string
  channel: SourceKind
  kind: CompanyTimelineEntry['kind']
  element: number // index into the inventory
  lines: [string, string, string][] // author, role, text
  topic: string
  summary: string
  action: string
}

const TEMPLATES: Template[] = [
  {
    subject: 'TRN-042 optics flapping after SFP swap', channel: 'teams', kind: 'incident_chat', element: 0, topic: 'sfp-flap',
    lines: [
      ['Helmi Hakkarainen', 'NOC Operator', 'TRN-042 has been flapping since the SFP swap this morning.'],
      ['Erkki Expert', 'Network Expert', 'Known on TX-3000 with fw 3.8: reseat the SFP and force 1G for ten minutes.'],
      ['Helmi Hakkarainen', 'NOC Operator', 'Done, link is stable again.'],
    ],
    summary: 'After an SFP swap on TX-3000 (fw 3.8) force 1G for ten minutes', action: 'Reseat the SFP and force the port to 1G for ten minutes.',
  },
  {
    subject: '#radio-field cold mornings on RAD-176', channel: 'slack', kind: 'chat', element: 4, topic: 'cold-margin',
    lines: [
      ['Raimo Rantanen', 'Radio Specialist', 'RAD-176 shows a link margin warning on cold mornings.'],
      ['Helmi Hakkarainen', 'NOC Operator', 'Is that normal for RU-200?'],
      ['Raimo Rantanen', 'Radio Specialist', 'Yes below -15C, it clears by 10:00. No action needed.'],
    ],
    summary: 'Margin warnings on RU-200 below -15C clear by themselves', action: 'Do not dispatch; check again after 10:00.',
  },
  {
    subject: 'RE: Oulu exchange power maintenance', channel: 'email', kind: 'incident_chat', element: 3, topic: 'oulu-power',
    lines: [
      ['Pekka Virtanen', 'Field Engineer', 'Mains maintenance at Oulu Linnanmaa tonight, TRN-229 on battery.'],
      ['Erkki Expert', 'Network Expert', 'Battery holds 40 minutes. Fail over traffic to TRN-176 before that.'],
      ['Pekka Virtanen', 'Field Engineer', 'Understood, failover scheduled.'],
    ],
    summary: 'TRN-229 on battery holds 40 minutes: fail over to TRN-176 first', action: 'Fail over traffic to TRN-176 before mains work.',
  },
  {
    subject: 'Access to Sodankyla fell mast', channel: 'teams', kind: 'chat', element: 5, topic: 'mast-access',
    lines: [
      ['Raimo Rantanen', 'Radio Specialist', 'Who has the key for the Sodankyla fell mast in winter?'],
      ['Pekka Virtanen', 'Field Engineer', 'Snowmobile access only, call the caretaker the day before.'],
      ['Raimo Rantanen', 'Radio Specialist', 'Thanks, noted.'],
    ],
    summary: 'Sodankyla mast is reachable by snowmobile only in winter', action: 'Call the caretaker the day before a visit.',
  },
  {
    subject: 'TRN-088 high CPU after firmware', channel: 'slack', kind: 'incident_chat', element: 1, topic: 'cpu-fw',
    lines: [
      ['Helmi Hakkarainen', 'NOC Operator', 'TRN-088 CPU is at 92% since the firmware push.'],
      ['Erkki Expert', 'Network Expert', 'Fw 3.8 leaks a process on TX-3000. Restart the telemetry agent.'],
      ['Helmi Hakkarainen', 'NOC Operator', 'Restarted, CPU back to 30%.'],
    ],
    summary: 'TX-3000 fw 3.8 leaks a process: restart the telemetry agent', action: 'Restart the telemetry agent; schedule fw 4.0.',
  },
  {
    subject: 'Harbour hut humidity', channel: 'teams', kind: 'noise', element: 7, topic: 'humidity',
    lines: [
      ['Pekka Virtanen', 'Field Engineer', 'Harbour hut feels damp again.'],
      ['Helmi Hakkarainen', 'NOC Operator', 'RAD-254 is fine, humidity sensor reads 61%.'],
      ['Pekka Virtanen', 'Field Engineer', 'OK, false alarm.'],
    ],
    summary: 'Harbour hut feels damp but sensors stay below 70%', action: 'No action below 70% humidity.',
  },
]

const HEALTH_TEXT: Record<string, string> = {
  degraded: 'Open incident with matching knowledge in force.',
  down: 'Open critical incident, no service.',
  recovering: 'Incident resolved, watching for a full cycle.',
}

export function demoIdleState(): CompanyState {
  return {
    status: 'idle', started_at: null, ends_at: null, day_minutes: DAY_MIN, endless: false, generated_count: 0, cycle_minutes: CYCLE_MIN, speed: SPEED,
    use_llm: false, next_cycle_at: null, cycles: [], calls: [], health: [], timeline: [],
  }
}

interface Store {
  setState: (p: { company: CompanyState; healthFlash: Record<string, number> }) => void
  getState: () => { apply: (e: WbEvent) => void; elements: { id: string; site_id: string | null }[]; assertions: Record<string, ContextAssertion>; company: CompanyState | null; threads: Record<string, LiveThread> }
}

interface Run {
  entry: CompanyTimelineEntry
  tpl: Template
  threadId: string
  sent: number
  jobStep: number
  job: PipelineJob | null
  incidentId: string | null
  resolveAt: number | null
}

let driver: ReturnType<typeof makeDriver> | null = null
export const demoDriver = (store: Store) => (driver ??= makeDriver(store))

function makeDriver(store: Store) {
  let eid = 9_000_000
  let timer: number | undefined
  let min = 0
  let cycleN = 0
  let newSinceCycle: string[] = []
  let runs: Run[] = []
  let state: CompanyState = demoIdleState()
  let generated = 0
  const health = new Map<string, ElementHealth>()
  const emit = (e: { type: string; data: unknown }) => store.getState().apply({ id: ++eid, ts: new Date().toISOString(), ...e } as WbEvent)
  const publish = () => emit({ type: 'company.state', data: { ...state, cycles: [], calls: [], health: [] } })
  const elements = () => store.getState().elements

  const stage = (name: StageName, status: Stage['status']): Stage => ({ stage: name, status, detail: '', duration_ms: status === 'done' ? 400 + Math.round(Math.random() * 900) : null })
  const NAMES: StageName[] = ['listen', 'understand', 'link', 'store', 'reconcile']
  const jobAt = (r: Run, step: number): PipelineJob => ({
    id: `job-${r.threadId}`, thread_id: r.threadId, started_at: new Date().toISOString(), finished_at: step >= 5 ? new Date().toISOString() : null,
    extractor: 'scripted', stages: NAMES.map((n, i) => stage(n, i < step ? 'done' : i === step ? 'running' : 'pending')),
    items: [], notes: [], assertion_ids: step >= 4 ? [`demo-${r.entry.id}`] : [], removed_assertion_ids: [], events: [], llm_call_ids: [],
    eval: null, flags: [], critic: [], judge: [], error: null,
  })

  const thread = (r: Run, status: LiveThread['status']): LiveThread => ({
    id: r.threadId, source: r.tpl.channel, subject: r.tpl.subject, messages: [], participants: [], origin: 'synthetic', status,
    scenario_id: null, incident_id: r.incidentId, slack_ts: null, created_at: iso(min), last_message_at: iso(min), last_job_id: null,
  })

  const assertionFor = (r: Run): ContextAssertion => ({
    id: `demo-${r.entry.id}`, type: r.tpl.kind === 'noise' ? 'fact' : 'workaround', topic: r.tpl.topic, summary: r.tpl.summary,
    bound_to: [{ entity: elements()[r.tpl.element % elements().length].id, role: 'applies_to' }], conditions: [], diagnosis: null,
    action: r.tpl.action, avoid: [], fact: null, valid_from: iso(min), valid_to: null, closed_by: null,
    trust: { level: r.tpl.kind === 'incident_chat' ? 'verified' : 'stated', stated_by: r.tpl.lines[1][0], role: r.tpl.lines[1][1], evidence: null },
    sources: [{ source: r.tpl.channel, file: r.threadId, seq: [2] }], conflicts_with: [], confidence: 0.82, link_notes: [],
  })

  const setHealth = (h: ElementHealth) => {
    health.set(h.element_id, h)
    emit({ type: 'network.status', data: h })
  }

  const cycle = () => {
    cycleN += 1
    const as = store.getState().assertions
    const valid = Object.values(as).filter((a) => a.valid_to == null).length
    const changes: CompanyCycle['status_changes'] = []
    const callIds: string[] = []
    const openIncidents = runs.filter((r) => r.incidentId && r.resolveAt == null || (r.resolveAt != null && r.resolveAt > min))
    const touched = new Set<string>()
    const handle = (elementId: string, incidentId: string | null, threadId: string | null, next: HealthStatus, rec: string) => {
      touched.add(elementId)
      const before = health.get(elementId)?.status ?? 'healthy'
      const hits = Object.values(as).filter((a) => a.bound_to.some((b) => b.entity === elementId))
      const call: AgentCall = {
        id: `call-${cycleN}-${elementId}`, cycle: cycleN, at: iso(min), entity_id: elementId, incident_id: incidentId, thread_id: threadId,
        observations: { alarm: next === 'down' ? 'link_down' : 'high_error_rate', errors_per_min: next === 'healthy' ? 0 : 38 },
        hit_ids: hits.map((a) => a.id), skipped: Math.max(0, hits.length - 2), cited_assertion_ids: hits.slice(0, 2).map((a) => a.id),
        recommendation: rec, verdict: next === 'healthy' ? 'allow' : 'apply_known_fix', status_before: before, status_after: next, used_llm: state.use_llm,
      }
      callIds.push(call.id)
      emit({ type: 'agent.call', data: call })
      if (before !== next) {
        changes.push({ element_id: elementId, from_status: before, to_status: next, reason: HEALTH_TEXT[next] ?? 'Back to normal.' })
        setHealth({
          element_id: elementId, status: next, since: iso(min), incident_id: incidentId, reason: HEALTH_TEXT[next] ?? 'Back to normal.',
          applied_assertion_ids: call.cited_assertion_ids, recommendation: rec,
        })
      }
    }
    for (const r of openIncidents) {
      if (r.job && r.jobStep < 5) continue
      const el = elements()[r.tpl.element % elements().length].id
      const critical = r.tpl.topic === 'oulu-power'
      handle(el, r.incidentId, r.threadId, critical ? 'down' : 'degraded', r.tpl.action)
    }
    for (const h of [...health.values()]) {
      if (touched.has(h.element_id)) continue
      if (h.status === 'degraded' || h.status === 'down') handle(h.element_id, h.incident_id, null, 'recovering', 'Incident resolved. Keep watching the error rate.')
      else if (h.status === 'recovering') handle(h.element_id, h.incident_id, null, 'healthy', 'Back to normal.')
    }
    const counts: Record<string, number> = { healthy: elements().length, degraded: 0, down: 0, recovering: 0 }
    for (const h of health.values()) {
      counts[h.status] = (counts[h.status] ?? 0) + (h.status === 'healthy' ? 0 : 1)
      if (h.status !== 'healthy') counts.healthy -= 1
    }
    const c: CompanyCycle = {
      n: cycleN, at: iso(min), agent_call_ids: callIds, status_changes: changes, open_incidents: openIncidents.length, health_counts: counts,
      package: { cycle: cycleN, at: iso(min), total: Object.keys(as).length, valid, new_ids: newSinceCycle, closed_ids: [], classes: 3, trust: { verified: 2, stated: valid - 2 } },
    }
    newSinceCycle = []
    emit({ type: 'company.cycle', data: c })
    state = { ...state, next_cycle_at: iso(min + CYCLE_MIN) }
    publish()
  }

  const tick = () => {
    min += 2
    emit({ type: 'clock', data: { sim_now: iso(min), speed: SPEED, running: true } })
    // endless: after the first hour, make up a new chat every few ticks (the backend keeps the 100 newest)
    if (state.endless && min > 60 && Math.random() < 0.45) {
      generated += 1
      const i = Math.floor(Math.random() * TEMPLATES.length)
      const tpl = TEMPLATES[i]
      state.timeline.push({ id: `g${generated}`, at_min: min, kind: 'generated', scenario_id: String(i), label: tpl.subject, started: false, run_id: null })
      state.timeline = state.timeline.filter((e) => e.kind !== 'generated').concat(state.timeline.filter((e) => e.kind === 'generated').slice(-100))
      state.generated_count = generated
    }
    // start planned chats
    let started = false
    for (const e of state.timeline) {
      if (e.started || e.at_min > min) continue
      e.started = true
      started = true
      const tpl = TEMPLATES[Number(e.scenario_id)]
      const r: Run = { entry: e, tpl, threadId: `DM-${e.id}`, sent: 0, jobStep: -1, job: null, incidentId: null, resolveAt: null }
      if (e.kind === 'incident_chat') {
        r.incidentId = `INC-D${e.id}`
        emit({
          type: 'incident.upserted',
          data: { id: r.incidentId, entity_id: elements()[tpl.element % elements().length].id, kind: tpl.topic, severity: tpl.topic === 'oulu-power' ? 'critical' : 'major', summary: tpl.subject, observations: {}, status: 'open', opened_at: iso(min), resolved_at: null, thread_id: r.threadId, scenario_id: null, origin: 'synthetic' },
        })
      }
      runs.push(r)
      emit({ type: 'thread.upserted', data: thread(r, 'active') })
    }
    if (started) publish()
    // one message per tick, then the pipeline
    for (const r of runs) {
      if (r.sent < r.tpl.lines.length) {
        const [author, role, text] = r.tpl.lines[r.sent]
        r.sent += 1
        emit({ type: 'message.posted', data: { thread_id: r.threadId, message: { thread_id: r.threadId, source: r.tpl.channel, seq: r.sent, author, role, sent_at: iso(min), text } } })
        if (r.sent === r.tpl.lines.length) emit({ type: 'thread.upserted', data: { ...thread(r, 'processing'), messages: [] } })
      } else if (r.jobStep < 5) {
        r.jobStep += 1
        r.job = jobAt(r, r.jobStep)
        emit({ type: 'pipeline.job', data: r.job })
        if (r.jobStep === 4) {
          const a = assertionFor(r)
          newSinceCycle.push(a.id)
          emit({ type: 'assertion.upserted', data: a })
        }
        if (r.jobStep === 5) {
          emit({ type: 'thread.upserted', data: { ...thread(r, 'processed'), messages: [] } })
          if (r.incidentId) r.resolveAt = min + 25
        }
      }
      if (r.incidentId && r.resolveAt != null && r.resolveAt <= min) {
        emit({ type: 'incident.upserted', data: { id: r.incidentId, entity_id: elements()[r.tpl.element % elements().length].id, kind: r.tpl.topic, severity: 'major', summary: r.tpl.subject, observations: {}, status: 'resolved', opened_at: iso(min - 30), resolved_at: iso(min), thread_id: r.threadId, scenario_id: null, origin: 'synthetic' } })
        r.resolveAt = min - 1000 // done
        r.incidentId = null
      }
    }
    if (min % CYCLE_MIN === 0) cycle()
    // finished chats leave the run list so a long run stays small
    runs = runs.filter((r) => r.jobStep < 5 || r.incidentId)
    if (!state.endless && min >= DAY_MIN) finish()
  }

  const finish = () => {
    window.clearInterval(timer)
    timer = undefined
    state = { ...state, status: 'finished', next_cycle_at: null }
    emit({ type: 'clock', data: { sim_now: iso(min), speed: SPEED, running: false } })
    publish()
  }

  const run = () => {
    window.clearInterval(timer)
    timer = window.setInterval(tick, 1000)
  }

  return {
    async start(body: CompanyStartBody): Promise<CompanyState> {
      min = 0
      cycleN = 0
      runs = []
      newSinceCycle = []
      health.clear()
      const entries = [5, 20, 45, 75, 100, 130, 170, 200, 240, 285, 330, 380, 420]
      const timeline: CompanyTimelineEntry[] = entries.map((m, i) => {
        const tpl = TEMPLATES[i % TEMPLATES.length]
        return { id: String(i + 1), at_min: m, kind: tpl.kind, scenario_id: String(i % TEMPLATES.length), label: tpl.subject, started: false, run_id: null }
      })
      generated = 0
      const dayMin = body.day_minutes ?? DAY_MIN
      state = { ...demoIdleState(), status: 'running', started_at: iso(0), ends_at: dayMin ? iso(dayMin) : null, day_minutes: dayMin, endless: dayMin === 0, speed: SPEED, use_llm: !!body.use_llm, next_cycle_at: iso(CYCLE_MIN), timeline }
      emit({ type: 'clock', data: { sim_now: iso(0), speed: SPEED, running: true } })
      store.setState({ company: state, healthFlash: {} })
      run()
      return state
    },
    async pause() {
      window.clearInterval(timer)
      state = { ...state, status: 'paused' }
      emit({ type: 'clock', data: { sim_now: iso(min), speed: SPEED, running: false } })
      publish()
      return state
    },
    async resume() {
      state = { ...state, status: 'running' }
      emit({ type: 'clock', data: { sim_now: iso(min), speed: SPEED, running: true } })
      publish()
      run()
      return state
    },
    async stop() {
      finish()
      return state
    },
    async package(cycle?: number) {
      const as = Object.values(store.getState().assertions)
      return { cycle: cycle ?? cycleN, at: iso(min), assertions: as, classes: [] }
    },
  }
}

/** The knowledge graph of the live store, shaped like GET /graph (demo only). */
export function demoKnowledgeGraph(store: Store): KgGraph {
  const st = store.getState()
  const els: KgElement[] = []
  const seen = new Set<string>()
  const node = (id: string, kind: string, label: string, extra: Record<string, unknown> = {}) => {
    if (seen.has(id)) return
    seen.add(id)
    els.push({ group: 'nodes', data: { id, kind: kind as never, label, ...extra } })
  }
  const edge = (s: string, t: string, type: string) => els.push({ group: 'edges', data: { id: `${s}|${type}|${t}`, source: s, target: t, type } })
  for (const a of Object.values(st.assertions)) {
    node(a.id, 'Assertion', a.topic, { summary: a.summary, topic: a.topic, valid: a.valid_to == null })
    for (const b of a.bound_to) {
      node(b.entity, 'Element', b.entity)
      edge(a.id, b.entity, 'APPLIES_TO')
    }
    node(`person:${a.trust.stated_by}`, 'Person', a.trust.stated_by)
    edge(a.id, `person:${a.trust.stated_by}`, 'STATED_BY')
    for (const s of a.sources) {
      node(s.file, 'Thread', st.threads[s.file]?.subject ?? s.file)
      edge(a.id, s.file, 'FROM_THREAD')
    }
  }
  return { at: new Date().toISOString(), elements: els }
}

/** Every `Pattern` field, so the fixture cannot drift from the contract. */
function makePattern(partial: Partial<Pattern> & Pick<Pattern, 'id' | 'kind' | 'level' | 'title'>): Pattern {
  return {
    elements: [],
    topics: [],
    first_seen: '',
    last_seen: '',
    count: 0,
    occurrences: [],
    factors: [],
    fixes: [],
    lasting_fixes: [],
    hypotheses: [],
    status_note: null,
    resolved_by: null,
    people: [],
    grouped: [],
    headline: '',
    suspects: [],
    links: [],
    note: '',
    ...partial,
  }
}

/** Correlations for fixture mode: assertions that share a site and name different problems. Demo only. */
export function demoPatterns(store: Store, at?: string | null): PatternReport {
  const st = store.getState()
  const bySite = new Map<string, ContextAssertion[]>()
  for (const a of Object.values(st.assertions)) {
    if (at && new Date(a.valid_from).getTime() > new Date(at).getTime()) continue
    for (const b of a.bound_to) {
      if (b.role === 'trigger') continue
      const site = st.elements.find((e) => e.id === b.entity)?.site_id
      if (site) bySite.set(site, [...(bySite.get(site) ?? []), a])
    }
  }
  const patterns: Pattern[] = []
  for (const [site, list] of bySite) {
    const occurrences: PatternOccurrence[] = list.map((a) => {
      const element = a.bound_to.find((b) => b.role !== 'trigger')?.entity ?? site
      return {
        element,
        at: a.valid_from,
        topic: a.topic,
        problem: a.topic,
        assertion_id: a.id,
        kind: 'reported',
        sources: a.sources.map((s) => s.file),
        by: a.trust.stated_by,
        action: a.action,
        worked: null,
      }
    })
    const elements = [...new Set(occurrences.map((o) => o.element))]
    if (elements.length < 2) continue
    const times = occurrences.map((o) => o.at).sort()
    patterns.push(
      makePattern({
        id: `demo-linked-${site}`,
        kind: 'linked',
        level: 'watch',
        title: `Problems at ${site}`,
        elements,
        topics: [...new Set(list.map((a) => a.topic))],
        first_seen: times[0],
        last_seen: times[times.length - 1],
        count: occurrences.length,
        occurrences,
        suspects: [site],
        headline: `${elements.length} problems at ${site} may share a cause.`,
        note: 'Hypothesis to check, not a rule.',
      }),
    )
  }
  return { at: at ?? new Date().toISOString(), meaning: 'off (words only)', patterns }
}
