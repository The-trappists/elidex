// Live state: GET /api/state once, then every SSE event is applied by `apply()`.
// Pages read from this store with selectors, e.g. `const threads = useLive(s => s.threads)`.
import { create } from 'zustand'
import { api } from '../api/client'
import { fixtureSnapshot } from '../api/fixtures/review'
import type {
  ClockState,
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

  load: () => Promise<void>
  apply: (e: WbEvent) => void
}

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

  load: async () => {
    let s: StateSnapshot
    try {
      s = await api.state()
    } catch (e) {
      // VITE_REVIEW_FIXTURES=1: the console works with the backend down, on sample data.
      if (import.meta.env.VITE_REVIEW_FIXTURES !== '1') throw e
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
        set({ threads: { ...s.threads, [e.data.id]: { ...e.data, messages } } })
        break
      }
      case 'thread.deleted': {
        const { [e.data.id]: _gone, ...rest } = s.threads
        void _gone
        set({ threads: rest })
        break
      }
      case 'incident.upserted':
        set({ incidents: { ...s.incidents, [e.data.id]: e.data } })
        break
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
      case 'state.reset':
        void get().load()
        break
      case 'log':
        set({ log: [...s.log, { id: e.id, ts: e.ts, ...e.data }].slice(-MAX_LOG) })
        break
    }
  },
}))

/** Connect once (called from App). Reconnects with backoff and refetches the snapshot. */
export function connectLive(): () => void {
  let es: EventSource | null = null
  let stopped = false
  let retry = 1000

  const open = async () => {
    if (stopped) return
    useLive.setState({ connection: 'connecting' })
    try {
      await useLive.getState().load()
    } catch {
      useLive.setState({ connection: 'offline' })
      setTimeout(open, retry)
      retry = Math.min(retry * 2, 15000)
      return
    }
    if (snapshotIsFixture) {
      // Backend down in fixtures mode: stay on the sample snapshot, no stream, no refetch loop.
      useLive.setState({ connection: 'offline' })
      return
    }
    es = new EventSource(api.streamUrl)
    es.onopen = () => {
      retry = 1000
      useLive.setState({ connection: 'live' })
    }
    es.onmessage = (msg) => {
      try {
        useLive.getState().apply(JSON.parse(msg.data) as WbEvent)
      } catch (err) {
        console.error('bad event', err, msg.data)
      }
    }
    es.onerror = () => {
      es?.close()
      useLive.setState({ connection: 'offline' })
      setTimeout(open, retry)
      retry = Math.min(retry * 2, 15000)
    }
  }
  void open()
  return () => {
    stopped = true
    es?.close()
  }
}

/** Sim time "now", interpolated between clock events. Re-render with useNow() for a ticking display. */
export function simNow(state: Pick<LiveState, 'clock' | 'clockReceivedAt'>): Date | null {
  if (!state.clock) return null
  const base = new Date(state.clock.sim_now).getTime()
  if (!state.clock.running) return new Date(base)
  return new Date(base + (Date.now() - state.clockReceivedAt) * state.clock.speed)
}
