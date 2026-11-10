// The guided demo: one story, the Elisa case (TRN-042), told as seven steps.
// Nothing here is new product logic: every action calls an API the dashboard already uses,
// and every step is a normal page opened with the right element pre-selected.
import { api } from '../../api/client'
import type { ContextAssertion, Incident, LiveThread, PipelineJob, RuleApplication, ScenarioRun } from '../../api/types'

export const DEMO_ENTITY = 'TRN-042'
export const DEMO_SCENARIO = 'elisa-trn042-chat'
const RULE_TOPIC = 'sfp-swap-forwarding-state'
const SEED_THREAD = 'elisa/teams_chat.json'
const OBSERVATIONS = { sfp_replaced: true, interface_status: 'UP', optical_levels: 'normal', traffic_counters: 0, alarms: 'cleared' }

/** What the steps need to know about the current state of the workbench. */
export interface DemoCtx {
  run: ScenarioRun | null
  thread: LiveThread | null
  incident: Incident | null
  /** The rule extracted from the Elisa chat. */
  rule: ContextAssertion | null
  /** True once a pipeline job has finished on the thread. */
  processed: boolean
  application: RuleApplication | null
}

export interface DemoAction {
  label: string
  /** Label while the action runs. */
  busy: string
  /** A reason the action cannot run now (shown instead of the button), or null. */
  blocked?: (c: DemoCtx) => string | null
  /** True when the action has already had its effect. */
  done?: (c: DemoCtx) => boolean
  doneLabel?: string
  run: (c: DemoCtx) => Promise<void>
}

export interface DemoStep {
  id: string
  title: string
  /** One sentence: what the jury sees on this screen. */
  seen: string
  /** One sentence: why it matters (captured human knowledge, linked to the network). */
  why: string
  path: (c: DemoCtx) => string
  /** True when the step's content exists, shown as a check in the list. Visited steps without a check function count too. */
  ready?: (c: DemoCtx) => boolean
  action?: DemoAction
}

const enc = encodeURIComponent
const threadPath = (c: DemoCtx) => (c.thread ? `/conversations/${enc(c.thread.id)}` : '/conversations')

export const DEMO_STEPS: DemoStep[] = [
  {
    id: 'incident',
    title: 'An incident opens on TRN-042',
    seen: 'A scripted incident: an SFP was replaced, the link is UP, and still no traffic. The network shows symptoms, not the fix.',
    why: 'Today the fix lives in two engineers’ heads. We do not detect faults here; the incident only sets the scene.',
    path: () => '/overview',
    ready: (c) => !!c.incident,
    action: {
      label: 'Start the incident',
      busy: 'Starting…',
      done: (c) => !!c.run || !!c.incident,
      doneLabel: 'Incident started',
      run: async () => {
        await api.simSpeed(60)
        await api.simStart()
        await api.runScenario(DEMO_SCENARIO)
      },
    },
  },
  {
    id: 'conversation',
    title: 'The engineers talk it through',
    seen: 'Veikko (field) and Erkki (expert) chat in Teams, live. The pipeline reads the thread once it goes quiet.',
    why: 'We listen on channels people already use. Nobody fills in a form or tags anything.',
    path: threadPath,
    ready: (c) => !!c.thread,
    action: {
      label: 'Read the conversation now',
      busy: 'Reading…',
      blocked: (c) => (!c.thread ? 'Start the incident first (step 1).' : c.run && !c.run.done ? 'The chat is still playing…' : null),
      done: (c) => c.processed,
      doneLabel: 'Conversation read',
      run: async (c) => {
        if (c.thread) await api.processThread(c.thread.id)
      },
    },
  },
  {
    id: 'knowledge',
    title: 'One sentence of rule, captured and linked',
    seen: 'The rule opens with its source messages, its scope (TRN-042 and older transmission nodes), its validity and its trust.',
    why: 'Human know-how becomes structured, sourced knowledge linked to the network, not a note lost in a chat.',
    path: (c) => (c.rule ? `/knowledge?assertion=${enc(c.rule.id)}` : '/knowledge'),
    ready: (c) => !!c.rule,
  },
  {
    id: 'element',
    title: 'The element now carries what people know',
    seen: 'On TRN-042: the rule in force, who said it, the human activity around it and who to ask.',
    why: 'Anyone, or any agent, who opens an element sees what colleagues learned about it, with provenance.',
    path: () => `/network?select=${DEMO_ENTITY}&section=human`,
    ready: (c) => !!c.rule,
  },
  {
    id: 'agent',
    title: 'The agent uses it, the guard checks it',
    seen: 'Given the symptoms, the agent recommends bouncing the interface and cites the rule. Its plan to replace the SFP again gets a guard answer: adapt.',
    why: 'Human knowledge reaches autonomous operations with its sources, and a wrong move is stopped. A wrong action is worse than none.',
    path: () => '/knowledge?tab=agent&autorun=guard',
    ready: (c) => !!c.rule,
  },
  {
    id: 'field',
    title: 'The field answers, trust grows',
    seen: 'The ops agent says what it applied. Veikko’s reply, “traffic is back”, is read as evidence on the rule.',
    why: 'Trust comes from people already talking. No survey, no thumbs up.',
    path: threadPath,
    ready: (c) => !!c.application,
    action: {
      label: 'Play Veikko’s reply',
      busy: 'Posting…',
      blocked: (c) => (!c.rule ? 'Capture the rule first (steps 1 to 3).' : null),
      done: (c) => !!c.application && c.application.outcome !== 'pending',
      doneLabel: 'Reply read',
      run: async (c) => {
        let threadId = c.application?.thread_id ?? c.thread?.id ?? null
        if (!c.application) {
          const r = await api.agentRun({ entity_id: DEMO_ENTITY, description: 'An SFP was replaced on TRN-042, the interface is UP, but traffic counters stay at zero.', observations: OBSERVATIONS })
          threadId = r.thread_id ?? threadId
        }
        if (!threadId) throw new Error('The agent did not post in a conversation. Is the outcome loop on in Settings?')
        await api.postMessage(threadId, { persona_id: 'veikko', text: `Bounced the interface, traffic is back on ${DEMO_ENTITY}. Thanks!` })
        await api.processThread(threadId)
      },
    },
  },
  {
    id: 'trust',
    title: 'Confirmed in the field',
    seen: 'A “Confirmed in the field” note quotes Veikko, and his reply is now a source of the rule. Everything stays correctable.',
    why: 'The loop is closed: captured, linked, used, validated. Humans keep the last word, but nobody had to ask them.',
    path: (c) => (c.application ? `/review?thread=${enc(c.application.thread_id)}` : '/review'),
    ready: (c) => !!c.application && c.application.outcome !== 'pending',
  },
]

/** Where a deep link `?demo=<id or number>` points, or null. */
export function stepIndex(key: string): number | null {
  const byId = DEMO_STEPS.findIndex((s) => s.id === key)
  if (byId >= 0) return byId
  const n = Number(key)
  return Number.isInteger(n) && n >= 1 && n <= DEMO_STEPS.length ? n - 1 : null
}

/** A relative URL for step `i`, for links and the docs: `/overview?demo=incident`. */
export const stepLink = (i: number) => `/overview?demo=${DEMO_STEPS[i].id}`

export function buildCtx(s: {
  runs: ScenarioRun[]
  threads: Record<string, LiveThread>
  incidents: Record<string, Incident>
  assertions: Record<string, ContextAssertion>
  jobs: PipelineJob[]
  applications: Record<string, RuleApplication>
}): DemoCtx {
  const run = [...s.runs].reverse().find((r) => r.scenario_id === DEMO_SCENARIO) ?? null
  const thread = (run && s.threads[run.thread_id]) || s.threads[SEED_THREAD] || null
  const incident = Object.values(s.incidents).filter((i) => i.entity_id === DEMO_ENTITY).sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0] ?? null
  const rules = Object.values(s.assertions).filter((a) => a.topic === RULE_TOPIC)
  const rule = (thread && rules.find((a) => a.sources.some((x) => x.file === thread.id))) || rules[rules.length - 1] || null
  const processed = !!thread && s.jobs.some((j) => j.thread_id === thread.id && j.finished_at)
  const application = Object.values(s.applications).filter((a) => a.entity_id === DEMO_ENTITY).sort((a, b) => b.applied_at.localeCompare(a.applied_at))[0] ?? null
  return { run, thread, incident, rule, processed, application }
}
