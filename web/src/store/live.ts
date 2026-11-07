// Live state: GET /api/state once, then every SSE event is applied by `apply()`.
// Pages read from this store with selectors, e.g. `const threads = useLive(s => s.threads)`.
import { create } from 'zustand'
import { api } from '../api/client'
import { demoIdleState, isDemo } from '../api/fixtures/company'
import { fixtureSnapshot } from '../api/fixtures/review'
import { backoffDelay, subscribeStream } from './stream'
import type {
  AgentCall,
  ClockState,
  CompanyState,
  ContextAssertion,
  ElementClass,
  Incident,
  LiveThread,
  LlmCall,
  Persona,
  PipelineJob,
  Scenario,
  ScenarioRun,
  Settings,
  SlackStatus,
  StateSnapshot,
  TopologyLink,
  WbElement,
  WbEvent,
  WbSite,
} from '../api/types'

const MAX_JOBS = 200
const MAX_LLM_CALLS = 500
const MAX_LOG = 200
const MAX_CYCLES = 60
const MAX_CALLS = 200
// Endless company days: keep only the newest closed threads and incidents so memory stays flat.
const MAX_THREADS = 400
const MAX_INCIDENTS = 300

/** Drops the oldest entries beyond `max`, never an open one (`keep`). */
function pruneOldest<T extends { id: string }>(m: Record<string, T>, max: number, key: (x: T) => string, keep: (x: T) => boolean): Record<string, T> {
  const all = Object.values(m)
  if (all.length <= max) return m
  const drop = new Set(
    all
      .filter((x) => !keep(x))
      .sort((a, b) => key(a).localeCompare(key(b)))
      .slice(0, all.length - max)
      .map((x) => x.id),
  )
  return Object.fromEntries(Object.entries(m).filter(([id]) => !drop.has(id)))
}

let snapshotIsFixture = false

export type Connection = 'connecting' | 'live' | 'offline'

export interface LogLine {
  id: number
  ts: string
  level: 'info' | 'warning' | 'error'
  text: string
}

export interface LiveState {
  ready: boolean
  connection: Connection
  clock: ClockState | null
  clockReceivedAt: number // wall ms when `clock` arrived, to interpolate the displayed sim time
  settings: Settings | null
  slack: SlackStatus
  elements: WbElement[]
  sites: WbSite[]
  links: TopologyLink[]
  personas: Persona[]
  threads: Record<string, LiveThread>
  incidents: Record<string, Incident>
  assertions: Record<string, ContextAssertion>
  classes: Record<string, ElementClass>
  jobs: PipelineJob[] // oldest first
  scenarios: Scenario[]
  runs: ScenarioRun[]
  llmCalls: LlmCall[] // oldest first
  log: LogLine[]
  lastEventId: number
  company: CompanyState | null
  /** true when the last GET /company failed (the page shows an error instead of loading forever) */
  companyError: boolean
  /** wall ms of the last status change per element, to flash it for a moment */
  healthFlash: Record<string, number>

  load: () => Promise<void>
  loadCompany: () => Promise<void>
  apply: (e: WbEvent) => void
}

const emptyDemoCompany = demoIdleState

const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]))

function upsertList<T extends { id: string }>(list: T[], item: T, max: number): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i >= 0) {
    const next = list.slice()
    next[i] = item
    return next
  }
  const next = [...list, item]
  return next.length > max ? next.slice(next.length - max) : next
}

export const useLive = create<LiveState>((set, get) => ({
  ready: false,
  connection: 'connecting',
  clock: null,
  clockReceivedAt: 0,
  settings: null,
  slack: { connected: false, channel: null, error: null },
  elements: [],
  sites: [],
  links: [],
  personas: [],
  threads: {},
  incidents: {},
  assertions: {},
  classes: {},
  jobs: [],
  scenarios: [],
  runs: [],
  llmCalls: [],
  log: [],
  lastEventId: 0,
  company: null,
  companyError: false,
  healthFlash: {},

  load: async () => {
    let s: StateSnapshot
    try {
      s = await api.state()
    } catch (e) {
      // VITE_REVIEW_FIXTURES=1: the console works with the backend down, on sample data.
      if (import.meta.env.VITE_REVIEW_FIXTURES !== '1' && !isDemo()) throw e
      s = fixtureSnapshot()
      snapshotIsFixture = true
    }
    if (import.meta.env.VITE_REVIEW_FIXTURES === '1' && !snapshotIsFixture) {
      // Real backend without the review data: add the sample cases next to the real state.
      const fx = fixtureSnapshot()
      const add = <T extends { id: string }>(xs: T[], extra: T[]) => [...xs, ...extra.filter((e) => !xs.some((x) => x.id === e.id))]
      s = { ...s, threads: add(s.threads, fx.threads), jobs: add(s.jobs, fx.jobs), assertions: add(s.assertions, fx.assertions), classes: add(s.classes, fx.classes), elements: add(s.elements, fx.elements), sites: add(s.sites, fx.sites) }
    }
    set({
      ready: true,
      clock: s.clock,
      clockReceivedAt: Date.now(),
      settings: s.settings,
      slack: { ...get().slack, connected: s.settings.slack_connected },
      elements: s.elements,
      sites: s.sites,
      links: s.links,
      personas: s.personas,
      threads: byId(s.threads),
      incidents: byId(s.incidents),
      assertions: byId(s.assertions),
      classes: byId(s.classes),
      jobs: s.jobs,
      scenarios: s.scenarios,
      runs: s.runs,
      llmCalls: s.llm_calls,
    })
  },

  loadCompany: async () => {
    if (isDemo()) {
      if (!get().company) set({ company: emptyDemoCompany() })
      return
    }
    try {
      set({ company: await api.company(), companyError: false })
    } catch {
      // Backend without the company routes or down: keep what we have, the page shows an error if there is nothing.
      set({ companyError: true })
    }
  },

  apply: (e: WbEvent) => {
    const s = get()
    set({ lastEventId: e.id })
    switch (e.type) {
      case 'clock':
        set({ clock: e.data, clockReceivedAt: Date.now() })
        break
      case 'settings.changed':
        set({ settings: e.data })
        break
      case 'message.posted': {
        const t = s.threads[e.data.thread_id]
        if (!t) break
        if (t.messages.some((m) => m.seq === e.data.message.seq)) break
        set({
          threads: {
            ...s.threads,
            [t.id]: { ...t, messages: [...t.messages, e.data.message], last_message_at: e.data.message.sent_at },
          },
        })
        break
      }
      case 'thread.upserted': {
        const old = s.threads[e.data.id]
        // Events carry no messages: keep the ones we have.
        const messages = e.data.messages.length ? e.data.messages : (old?.messages ?? [])
        const threads = { ...s.threads, [e.data.id]: { ...e.data, messages } }
        set({ threads: s.company?.endless ? pruneOldest(threads, MAX_THREADS, (t) => t.last_message_at ?? t.created_at, (t) => t.status === 'active' || t.status === 'processing') : threads })
        break
      }
      case 'thread.deleted': {
        const { [e.data.id]: _gone, ...rest } = s.threads
        void _gone
        set({ threads: rest })
        break
      }
      case 'incident.upserted': {
        const incidents = { ...s.incidents, [e.data.id]: e.data }
        set({ incidents: s.company?.endless ? pruneOldest(incidents, MAX_INCIDENTS, (i) => i.opened_at, (i) => i.status === 'open') : incidents })
        break
      }
      case 'incident.deleted': {
        const { [e.data.id]: _gone, ...rest } = s.incidents
        void _gone
        set({ incidents: rest })
        break
      }
      case 'pipeline.job':
        set({ jobs: upsertList(s.jobs, e.data, MAX_JOBS) })
        break
      case 'assertion.upserted':
        set({ assertions: { ...s.assertions, [e.data.id]: e.data } })
        break
      case 'assertion.deleted': {
        const { [e.data.id]: _gone, ...rest } = s.assertions
        void _gone
        set({ assertions: rest })
        break
      }
      case 'class.upserted':
        set({ classes: { ...s.classes, [e.data.id]: e.data } })
        break
      case 'inventory.changed':
        set({ elements: e.data.elements, sites: e.data.sites, links: e.data.links })
        break
      case 'personas.changed':
        set({ personas: e.data.personas })
        break
      case 'scenarios.changed':
        set({ scenarios: e.data.scenarios, runs: e.data.runs })
        break
      case 'slack.status':
        set({ slack: e.data })
        break
      case 'llm.call':
        set({ llmCalls: upsertList(s.llmCalls, e.data, MAX_LLM_CALLS) })
        break
      case 'company.state': {
        // The event carries no cycles, calls or health: keep ours.
        const old = s.company
        set({ company: { ...e.data, cycles: old?.cycles ?? [], calls: old?.calls ?? [], health: old?.health ?? [] } })
        break
      }
      case 'company.cycle': {
        const c = s.company
        if (!c) break
        const cycles = [...c.cycles.filter((x) => x.n !== e.data.n), e.data].sort((a, b) => a.n - b.n).slice(-MAX_CYCLES)
        set({ company: { ...c, cycles } })
        break
      }
      case 'agent.call': {
        const c = s.company
        if (!c) break
        const calls: AgentCall[] = c.calls.some((x) => x.id === e.data.id)
          ? c.calls.map((x) => (x.id === e.data.id ? e.data : x))
          : [...c.calls, e.data].slice(-MAX_CALLS)
        set({ company: { ...c, calls } })
        break
      }
      case 'network.status': {
        const c = s.company
        if (!c) break
        const i = c.health.findIndex((h) => h.element_id === e.data.element_id)
        const health = i >= 0 ? c.health.map((h, j) => (j === i ? e.data : h)) : [...c.health, e.data]
        set({ company: { ...c, health }, healthFlash: { ...s.healthFlash, [e.data.element_id]: Date.now() } })
        break
      }
      case 'state.reset':
        set({ healthFlash: {} })
        void get().load()
        void get().loadCompany()
        break
      case 'log':
        set({ log: [...s.log, { id: e.id, ts: e.ts, ...e.data }].slice(-MAX_LOG) })
        break
    }
  },
}))

/** Connect once (called from App): load the snapshot, then follow the shared stream. */
export function connectLive(): () => void {
  let stopped = false
  let timer: number | undefined
  let attempt = 0
  let unsub: (() => void) | null = null

  const start = async () => {
    if (stopped) return
    useLive.setState({ connection: 'connecting' })
    try {
      await useLive.getState().load()
    } catch {
      useLive.setState({ connection: 'offline' })
      timer = window.setTimeout(start, backoffDelay(attempt++))
      return
    }
    if (stopped) return
    if (snapshotIsFixture) {
      // Backend down in fixtures mode: stay on the sample snapshot, no stream, no refetch loop.
      useLive.setState({ connection: 'offline' })
      return
    }
    unsub = subscribeStream({
      onStatus: (st) => useLive.setState({ connection: st }),
      onReconnect: () => {
        void useLive.getState().load().catch(() => undefined)
        if (useLive.getState().company) void useLive.getState().loadCompany()
      },
      onMessage: (data) => {
        try {
          useLive.getState().apply(JSON.parse(data) as WbEvent)
        } catch (err) {
          console.error('bad event', err, data)
        }
      },
    })
  }
  void start()
  return () => {
    stopped = true
    window.clearTimeout(timer)
    unsub?.()
  }
}

/** Sim time "now", interpolated between clock events. Re-render with useNow() for a ticking display. */
export function simNow(state: Pick<LiveState, 'clock' | 'clockReceivedAt'>): Date | null {
  if (!state.clock) return null
  const base = new Date(state.clock.sim_now).getTime()
  if (!state.clock.running) return new Date(base)
  return new Date(base + (Date.now() - state.clockReceivedAt) * state.clock.speed)
}
