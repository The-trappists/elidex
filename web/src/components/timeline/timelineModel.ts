// The simulation timeline: point events derived from the live store, the visible window, and the tick marks.
// Everything here is pure so the page only has to render what it returns.
import { format } from 'date-fns'
import type { AgentCall, CompanyState, ContextAssertion, Incident, LiveThread } from '../../api/types'

export type TimelineKind = 'knowledge' | 'closed' | 'incident' | 'resolved' | 'conversation' | 'agent'

export const TIMELINE_KINDS: TimelineKind[] = ['knowledge', 'closed', 'incident', 'resolved', 'conversation', 'agent']

export interface TimelineEvent {
  id: string
  kind: TimelineKind
  /** Epoch ms, simulated time. */
  at: number
  title: string
  detail?: string
  source?: string
  entityId?: string
  assertionId?: string
  threadId?: string
  incidentId?: string
}

export interface TimelineInput {
  assertions: Record<string, ContextAssertion>
  incidents: Record<string, Incident>
  threads: Record<string, LiveThread>
  calls: AgentCall[]
}

export interface Domain {
  start: number
  end: number
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const MIN_SPAN = 30 * MINUTE

const epoch = (iso: string | null | undefined): number => {
  if (!iso) return NaN
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : NaN
}

/** Point events from the store, ascending. Invalid dates are skipped; ids are stable per source and time. */
export function buildTimelineEvents(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const push = (e: Omit<TimelineEvent, 'id'> & { sourceId: string }) => {
    const { sourceId, ...rest } = e
    events.push({ ...rest, id: `${rest.kind}:${sourceId}:${rest.at}` })
  }

  for (const a of Object.values(input.assertions)) {
    const from = epoch(a.valid_from)
    const source = [a.trust.stated_by, a.sources[0]?.source].filter(Boolean).join(' · ')
    if (Number.isFinite(from)) {
      push({
        kind: 'knowledge',
        at: from,
        title: a.topic,
        detail: a.summary,
        source,
        assertionId: a.id,
        entityId: a.bound_to.find((b) => b.role !== 'trigger')?.entity,
        sourceId: a.id,
      })
    }
    const to = epoch(a.valid_to)
    // The closure marker sits at `valid_to`, the first instant the rule is out. The graph pages select one second
    // before it, so a clicked closure still shows the rule in force.
    if (Number.isFinite(to) && to !== from) {
      push({
        kind: 'closed',
        at: to,
        title: a.topic,
        detail: a.closed_by ?? 'Replaced',
        source,
        assertionId: a.id,
        entityId: a.bound_to.find((b) => b.role !== 'trigger')?.entity,
        sourceId: a.id,
      })
    }
  }

  for (const i of Object.values(input.incidents)) {
    const opened = epoch(i.opened_at)
    if (Number.isFinite(opened)) {
      push({
        kind: 'incident',
        at: opened,
        title: `${i.entity_id} · ${i.kind}`,
        detail: i.summary,
        source: i.severity,
        entityId: i.entity_id,
        incidentId: i.id,
        sourceId: i.id,
      })
    }
    const resolved = epoch(i.resolved_at)
    if (Number.isFinite(resolved)) {
      push({
        kind: 'resolved',
        at: resolved,
        title: `${i.entity_id} resolved`,
        detail: i.summary,
        source: `${format(new Date(opened), 'HH:mm')} → ${format(new Date(resolved), 'HH:mm')}`,
        entityId: i.entity_id,
        incidentId: i.id,
        sourceId: i.id,
      })
    }
  }

  for (const t of Object.values(input.threads)) {
    const at = epoch(t.created_at) || epoch(t.messages[0]?.sent_at)
    if (!Number.isFinite(at)) continue
    push({
      kind: 'conversation',
      at,
      title: t.subject ?? t.id,
      detail: `${t.messages.length} message${t.messages.length === 1 ? '' : 's'}`,
      source: t.source,
      threadId: t.id,
      entityId: t.incident_id ? input.incidents[t.incident_id]?.entity_id : undefined,
      incidentId: t.incident_id ?? undefined,
      sourceId: t.id,
    })
  }

  for (const c of input.calls) {
    const at = epoch(c.at)
    if (!Number.isFinite(at)) continue
    const cited = c.cited_assertion_ids[0]
    push({
      kind: 'agent',
      at,
      title: c.recommendation.length > 64 ? c.recommendation.slice(0, 63) + '…' : c.recommendation,
      detail: c.verdict ?? c.status_after,
      source: cited ? input.assertions[cited]?.topic : undefined,
      assertionId: cited,
      entityId: c.entity_id,
      sourceId: c.id,
    })
  }

  return events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}

/** For every conversation, the newest assertion captured from it; used to select a node when a conversation marker is clicked. */
export function threadAssertionIndex(assertions: Record<string, ContextAssertion>): Map<string, string> {
  const out = new Map<string, string>()
  const best = new Map<string, number>()
  for (const a of Object.values(assertions)) {
    const at = epoch(a.valid_from)
    for (const s of a.sources) {
      const prev = best.get(s.file)
      if (prev === undefined || at > prev) {
        best.set(s.file, at)
        out.set(s.file, a.id)
      }
    }
  }
  return out
}

/** Conversation id -> the element its incident is about. */
export function threadEntityIndex(threads: Record<string, LiveThread>, incidents: Record<string, Incident>): Map<string, string> {
  const out = new Map<string, string>()
  for (const t of Object.values(threads)) {
    const entity = t.incident_id ? incidents[t.incident_id]?.entity_id : undefined
    if (entity) out.set(t.id, entity)
  }
  return out
}

/** An incident is open at `at` when it had opened and had not been resolved yet. At `at = now` this equals the
 * stored `status`, because an incident is opened at the current sim time and resolved by setting both fields. */
export function incidentOpenAt(i: Pick<Incident, 'opened_at' | 'resolved_at'>, at: Date): boolean {
  const t = at.getTime()
  const opened = epoch(i.opened_at)
  if (!Number.isFinite(opened) || opened > t) return false
  const resolved = epoch(i.resolved_at)
  return !Number.isFinite(resolved) || resolved > t
}

/** The company day (default window), padded a little so the first and last markers are not on the edge. */
export function dayDomain(now: number, company: Pick<CompanyState, 'started_at' | 'ends_at'> | null): Domain {
  const started = company?.started_at ? epoch(company.started_at) : NaN
  let start: number
  let end: number
  if (Number.isFinite(started)) {
    start = started
    const ends = company?.ends_at ? epoch(company.ends_at) : NaN
    end = Number.isFinite(ends) ? ends : Math.max(now + 15 * MINUTE, start + HOUR)
  } else {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    start = d.getTime()
    end = start + 24 * HOUR
  }
  if (end - start < MIN_SPAN) end = start + MIN_SPAN
  const pad = (end - start) * 0.02
  return { start: start - pad, end: end + pad }
}

/** Everything the store still holds, plus now. Used by the `All` preset and the off-window chips. */
export function allDomain(events: TimelineEvent[], now: number): Domain {
  let start = now
  let end = now
  for (const e of events) {
    if (e.at < start) start = e.at
    if (e.at > end) end = e.at
  }
  if (end - start < MIN_SPAN) {
    const mid = (start + end) / 2
    start = mid - MIN_SPAN / 2
    end = mid + MIN_SPAN / 2
  }
  const pad = (end - start) * 0.04
  return { start: start - pad, end: end + pad }
}

/** Keep a window inside the allowed bounds, preserving its span where possible. */
export function clampDomain(d: Domain, bounds: Domain): Domain {
  const maxSpan = Math.max(MIN_SPAN, bounds.end - bounds.start)
  const span = Math.min(Math.max(d.end - d.start, MIN_SPAN), maxSpan)
  let start = d.start
  if (start < bounds.start) start = bounds.start
  if (start + span > bounds.end) start = bounds.end - span
  if (start < bounds.start) start = bounds.start
  return { start, end: start + span }
}

const STEPS = [1, 5, 15, 30, 60, 180, 360, 720, 1440, 10080, 20160, 43200]

/** Axis ticks: the smallest step that yields 3–8 ticks, or the largest step when none does (a 60-day window). */
export function timelineTicks(d: Domain, width: number): { at: number; label: string; major: boolean }[] {
  const span = Math.max(1, d.end - d.start)
  const spanMin = span / MINUTE
  let step = STEPS[STEPS.length - 1]
  for (const s of STEPS) {
    if (spanMin / s >= 3 && spanMin / s <= 8) {
      step = s
      break
    }
  }
  const stepMs = step * MINUTE
  const label = span <= 24 * HOUR ? (t: number) => format(t, 'HH:mm') : span <= 7 * 24 * HOUR ? (t: number) => format(t, 'EEE HH:mm') : (t: number) => format(t, 'd MMM')
  const out: { at: number; label: string; major: boolean }[] = []
  for (let t = Math.ceil(d.start / stepMs) * stepMs; t <= d.end && out.length < 24; t += stepMs) {
    const day = new Date(t)
    const major = day.getHours() === 0 && day.getMinutes() === 0
    out.push({ at: t, label: label(t), major })
  }
  // Too narrow for even one label: keep the axis readable by dropping every other tick.
  const room = Math.max(1, Math.floor(width / 64))
  if (out.length > room) return out.filter((_, i) => i % Math.ceil(out.length / room) === 0)
  return out
}

export interface TimelineCluster {
  kind: TimelineKind
  /** Mean time, used for the card. */
  at: number
  first: number
  last: number
  events: TimelineEvent[]
}

/** Markers closer than `minGapPx` on screen merge into one cluster with a count. */
export function clusterEvents(events: TimelineEvent[], domain: Domain, width: number, minGapPx: number): TimelineCluster[] {
  const span = Math.max(1, domain.end - domain.start)
  const pxPerMs = width / span
  const out: TimelineCluster[] = []
  for (const kind of TIMELINE_KINDS) {
    const lane = events.filter((e) => e.kind === kind && e.at >= domain.start && e.at <= domain.end)
    let current: TimelineEvent[] = []
    const flush = () => {
      if (!current.length) return
      out.push({
        kind,
        at: current.reduce((n, e) => n + e.at, 0) / current.length,
        first: current[0].at,
        last: current[current.length - 1].at,
        events: current,
      })
      current = []
    }
    for (const e of lane) {
      if (current.length && (e.at - current[current.length - 1].at) * pxPerMs < minGapPx) current.push(e)
      else {
        flush()
        current = [e]
      }
    }
    flush()
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Events outside the visible window, for the `‹ N earlier` / `N later ›` chips. */
export function offWindow(events: TimelineEvent[], domain: Domain): { earlier: number; later: number } {
  let earlier = 0
  let later = 0
  for (const e of events) {
    if (e.at < domain.start) earlier += 1
    else if (e.at > domain.end) later += 1
  }
  return { earlier, later }
}
