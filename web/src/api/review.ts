// Operator console API: review flags, re-run, assertion edits and their history.
// Every call goes to the real backend. Only with VITE_REVIEW_FIXTURES=1 (design work) are calls served by
// the fixtures in ./fixtures/review.ts, which keep their own in-memory state and update the live store the
// way the SSE events would; the UI then shows a "Sample data" badge.
import { useLive } from '../store/live'
import { ApiError, qs, req } from './client'
import {
  FIXTURE_FLAGS,
  FIXTURE_HISTORY,
  FIXTURE_LIVE_FLAG,
  type FixtureEdit,
} from './fixtures/review'
import type { ContextAssertion, FlagKind, OperatorEdit, PipelineJob, RerunBody, ReviewFlag } from './types'

/** One recorded operator edit. `before` and `after` hold only the fields that changed. */
export interface AssertionEdit {
  id: string
  assertion_id: string
  ts: string
  note: string | null
  before: Record<string, unknown>
  after: Record<string, unknown>
  undone: boolean
}

export const FIXTURES_ENV = import.meta.env.VITE_REVIEW_FIXTURES === '1'

/** True only in fixtures mode (the UI says "Sample data"). */
export const isSample = () => FIXTURES_ENV
export const onSampleChange = (fn: () => void) => { void fn; return () => {} }

async function call<T>(real: () => Promise<T>, fake: () => T | Promise<T>): Promise<T> {
  return FIXTURES_ENV ? fake() : real()
}

// ---------------------------------------------------------------- fixture state
const db = {
  flags: FIXTURE_FLAGS.map((f) => ({ ...f })),
  history: FIXTURE_HISTORY.map((h) => ({ ...h })) as FixtureEdit[],
  liveFlag: { ...FIXTURE_LIVE_FLAG },
}
/** Fixture flags created later (an operator edit). The review store subscribes. */
export const fixtureFlagBus = new Set<(f: ReviewFlag) => void>()
export const fixtureLiveFlag = () => ({ ...db.liveFlag, created_at: new Date().toISOString() })

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const notFound = (what: string) => new ApiError(404, `${what} not found`)

const ASSERTION_FIELDS = ['summary', 'action', 'avoid', 'conditions', 'valid_to'] as const

function currentValues(a: ContextAssertion): Record<string, unknown> {
  return { summary: a.summary, action: a.action, avoid: a.avoid, conditions: a.conditions, valid_to: a.valid_to, trust_level: a.trust.level }
}

function applyValues(a: ContextAssertion, v: Record<string, unknown>): ContextAssertion {
  const next: ContextAssertion = { ...a, trust: { ...a.trust } }
  for (const k of ASSERTION_FIELDS) if (k in v) (next as unknown as Record<string, unknown>)[k] = v[k]
  if ('trust_level' in v) next.trust.level = v.trust_level as ContextAssertion['trust']['level']
  if ('valid_to' in v) next.closed_by = v.valid_to ? (next.closed_by ?? 'operator') : null
  return next
}

function putAssertion(a: ContextAssertion) {
  useLive.setState((s) => ({ assertions: { ...s.assertions, [a.id]: a } }))
}

// ---------------------------------------------------------------- API
export const reviewApi = {
  flags: (f: { dismissed?: boolean; kind?: FlagKind | ''; thread_id?: string } = {}) =>
    call<ReviewFlag[]>(
      () => req('GET', `/review/flags${qs({ dismissed: f.dismissed, kind: f.kind, thread_id: f.thread_id })}`),
      async () => {
        await wait(60)
        return db.flags
          .filter((x) => (f.dismissed === undefined || x.dismissed === f.dismissed) && (!f.kind || x.kind === f.kind) && (!f.thread_id || x.thread_id === f.thread_id))
          .map((x) => ({ ...x }))
      },
    ),

  dismiss: (id: string) =>
    call<ReviewFlag | void>(
      () => req('POST', `/review/flags/${encodeURIComponent(id)}/dismiss`),
      async () => {
        await wait()
        const f = db.flags.find((x) => x.id === id)
        if (f) f.dismissed = true
      },
    ),

  rerun: (jobId: string, body: RerunBody) =>
    call<PipelineJob>(
      () => req('POST', `/jobs/${encodeURIComponent(jobId)}/rerun`, body),
      async () => {
        await wait(500)
        const old = useLive.getState().jobs.find((j) => j.id === jobId)
        if (!old) throw notFound('Job')
        const items = body.items ?? old.items
        const next: PipelineJob = {
          ...old,
          items,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          events: [...old.events, `Re-run from ${body.from_stage ?? 'link'} with operator-edited findings.`],
          stages: old.stages.map((s) => (s.stage === 'link' || s.stage === 'store' || s.stage === 'reconcile' ? { ...s, status: 'done' as const, duration_ms: 60 } : s)),
        }
        // Keep what the job saved in step with the edited findings (matched by topic).
        const assertions = useLive.getState().assertions
        for (const id of old.assertion_ids) {
          const a = assertions[id]
          const it = a && items.find((i) => i.topic === a.topic)
          if (a && it) putAssertion({ ...a, summary: it.summary, action: it.action, avoid: it.avoid, trust: { ...a.trust, level: it.trust_level } })
        }
        useLive.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === jobId ? next : j)) }))
        return next
      },
    ),

  editAssertion: (id: string, edit: OperatorEdit) =>
    call<ContextAssertion>(
      () => req<{ assertion: ContextAssertion }>('PATCH', `/assertions/${encodeURIComponent(id)}`, edit).then((r) => r.assertion),
      async () => {
        await wait()
        const a = useLive.getState().assertions[id]
        if (!a) throw notFound('Knowledge')
        const before = currentValues(a)
        const after: Record<string, unknown> = {}
        const prior: Record<string, unknown> = {}
        for (const k of [...ASSERTION_FIELDS, 'trust_level'] as const) {
          const v = edit[k as keyof OperatorEdit]
          if (v === undefined || (v === null && k !== 'valid_to')) continue
          if (JSON.stringify(v) !== JSON.stringify(before[k])) {
            after[k] = v
            prior[k] = before[k]
          }
        }
        let next = applyValues(a, after)
        if (Object.keys(after).length) {
          if (!next.sources.some((s) => s.source === 'operator')) next = { ...next, sources: [...next.sources, { source: 'operator', file: 'operator', seq: [] }] }
          db.history.unshift({ id: `fxedit-${Date.now()}`, assertion_id: id, ts: new Date().toISOString(), note: edit.note ?? null, before: prior, after, undone: false })
          const flag: ReviewFlag = {
            id: `fxflag-edit-${Date.now()}`, kind: 'operator_edit', thread_id: a.sources[0]?.file ?? 'operator', job_id: '', assertion_id: id, dismissed: false,
            created_at: new Date().toISOString(), message: `An operator changed ${Object.keys(after).map((k) => k.replace('_', ' ')).join(', ')} of "${a.topic.replace(/-/g, ' ')}".`,
            detail: edit.note ?? 'Agents now use the edited version.',
          }
          db.flags.unshift(flag)
          fixtureFlagBus.forEach((f) => f(flag))
        }
        putAssertion(next)
        return next
      },
    ),

  history: (id: string) =>
    call<AssertionEdit[]>(
      () => req('GET', `/assertions/${encodeURIComponent(id)}/history`),
      async () => {
        await wait(60)
        return db.history.filter((h) => h.assertion_id === id).map((h) => ({ ...h }))
      },
    ),

  undo: (id: string, editId?: string) =>
    call<ContextAssertion>(
      () => req<{ assertion: ContextAssertion }>('POST', `/assertions/${encodeURIComponent(id)}/undo`, editId ? { edit_id: editId } : undefined).then((r) => r.assertion),
      async () => {
        await wait()
        const a = useLive.getState().assertions[id]
        if (!a) throw notFound('Knowledge')
        const e = db.history.find((h) => h.assertion_id === id && !h.undone && (!editId || h.id === editId))
        if (!e) throw new ApiError(409, 'Nothing to undo')
        e.undone = true
        const next = applyValues(a, e.before)
        putAssertion(next)
        return next
      },
    ),
}
