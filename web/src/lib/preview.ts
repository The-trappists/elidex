// Client-side preview of an operator edit: what changes, who it reaches, whether it closes or
// reopens knowledge. Pure functions, no backend call.
import type { ContextAssertion, ElementClass, OperatorEdit, TrustLevel, WbElement, WbSite } from '../api/types'

export interface Draft {
  summary: string
  action: string
  avoid: string[]
  ends: boolean // validity end is set
  validTo: string // datetime-local value, used when `ends`
  trust: TrustLevel
}

export const toDraft = (a: ContextAssertion): Draft => ({
  summary: a.summary,
  action: a.action ?? '',
  avoid: a.avoid,
  ends: a.valid_to !== null,
  validTo: a.valid_to ? a.valid_to.slice(0, 16) : '',
  trust: a.trust.level,
})

export const FIELD_LABEL: Record<string, string> = {
  summary: 'Summary',
  action: 'Action',
  avoid: 'Avoid',
  conditions: 'Conditions',
  valid_to: 'Valid until',
  trust_level: 'Trust level',
  trust: 'Trust level',
}

export interface FieldChange {
  field: string
  label: string
  before: string
  after: string
}

/** Human text for a value of an edited field. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'none'
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' && x && 'text' in x ? String((x as { text: unknown }).text) : String(x))).join('; ') : 'none'
  if (typeof v === 'object' && v && 'level' in v) return String((v as { level: unknown }).level)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** The edit to send: only what differs from the stored assertion. */
export function toEdit(a: ContextAssertion, d: Draft, note: string): OperatorEdit {
  const e: OperatorEdit = {}
  if (d.summary.trim() !== a.summary) e.summary = d.summary.trim()
  if ((d.action.trim() || null) !== a.action) e.action = d.action.trim()
  const avoid = d.avoid.map((x) => x.trim()).filter(Boolean)
  if (JSON.stringify(avoid) !== JSON.stringify(a.avoid)) e.avoid = avoid
  const to = d.ends && d.validTo ? d.validTo + ':00' : null
  if ((to?.slice(0, 16) ?? null) !== (a.valid_to?.slice(0, 16) ?? null)) e.valid_to = to
  if (d.trust !== a.trust.level) e.trust_level = d.trust
  if (note.trim() && Object.keys(e).length) e.note = note.trim()
  return e
}

export function changesOf(a: ContextAssertion, edit: OperatorEdit): FieldChange[] {
  const before: Record<string, unknown> = { summary: a.summary, action: a.action, avoid: a.avoid, valid_to: a.valid_to, trust_level: a.trust.level }
  const out: FieldChange[] = []
  for (const k of ['summary', 'action', 'avoid', 'valid_to', 'trust_level'] as const) {
    if (!(k in edit)) continue
    const v = edit[k]
    out.push({
      field: k,
      label: FIELD_LABEL[k],
      before: showValue(k === 'valid_to' && a.valid_to ? a.valid_to.replace('T', ' ').slice(0, 16) : before[k]),
      after: showValue(k === 'valid_to' && typeof v === 'string' ? v.replace('T', ' ').slice(0, 16) : v),
    })
  }
  return out
}

export interface Reach {
  direct: WbElement[]
  viaClass: { label: string; elements: WbElement[] }[]
  viaSite: { name: string; elements: WbElement[] }[]
  total: number
}

const inClass = (e: WbElement, c: ElementClass) => {
  const k = c.criteria
  return (!k.type || e.type === k.type) && (!k.model || e.model === k.model) && (k.install_year_min == null || e.install_year >= k.install_year_min) && (k.install_year_max == null || e.install_year <= k.install_year_max)
}

/** Which equipment this knowledge reaches, through direct, class and site bindings. */
export function reachOf(a: ContextAssertion, elements: WbElement[], sites: WbSite[], classes: Record<string, ElementClass>): Reach {
  const direct: WbElement[] = []
  const viaClass: Reach['viaClass'] = []
  const viaSite: Reach['viaSite'] = []
  for (const b of a.bound_to) {
    const cls = classes[b.entity]
    const site = sites.find((s) => s.id === b.entity)
    const el = elements.find((e) => e.id === b.entity)
    if (cls) viaClass.push({ label: cls.label, elements: elements.filter((e) => inClass(e, cls)) })
    else if (site) viaSite.push({ name: site.name, elements: elements.filter((e) => e.site_id === site.id) })
    else if (el) direct.push(el)
  }
  const ids = new Set([...direct, ...viaClass.flatMap((c) => c.elements), ...viaSite.flatMap((s) => s.elements)].map((e) => e.id))
  return { direct, viaClass, viaSite, total: ids.size }
}

export type Lifecycle = 'unchanged' | 'closes' | 'closes_later' | 'reopens' | 'moves_end'

/** Whether the edit closes or reopens the knowledge, judged at `now` (sim time). */
export function lifecycleOf(a: ContextAssertion, edit: OperatorEdit, now: Date | null): { kind: Lifecycle; text: string } {
  if (!('valid_to' in edit)) return { kind: 'unchanged', text: '' }
  const t = now?.getTime() ?? Date.now()
  const wasClosed = a.valid_to !== null && new Date(a.valid_to).getTime() <= t
  const next = edit.valid_to ?? null
  const willClose = next !== null && new Date(next).getTime() <= t
  if (next === null) return wasClosed ? { kind: 'reopens', text: 'Reopens this knowledge: agents will use it again.' } : { kind: 'unchanged', text: 'Removes the planned end date. It stays valid.' }
  if (willClose) return { kind: 'closes', text: 'Closes this knowledge now: agents stop using it, and it stays in the history.' }
  if (wasClosed) return { kind: 'reopens', text: `Reopens this knowledge until ${next.replace('T', ' ').slice(0, 16)}.` }
  return { kind: a.valid_to ? 'moves_end' : 'closes_later', text: `It stops applying on ${next.replace('T', ' ').slice(0, 16)}.` }
}

/** Plain consequences of the other edited fields, for the preview. */
export function effectsOf(edit: OperatorEdit): string[] {
  const out: string[] = []
  if (edit.trust_level === 'verified') out.push('Marked verified: agents treat it as a firm rule.')
  if (edit.trust_level === 'hunch') out.push('Marked as a hunch: agents mention it as unconfirmed.')
  if (edit.trust_level === 'stated') out.push('Marked as stated: one person said it, not yet confirmed.')
  if (edit.action !== undefined) out.push('Agents will suggest the edited action.')
  if (edit.avoid !== undefined) out.push(edit.avoid && edit.avoid.length ? `Agents will be told to avoid: ${edit.avoid.join('; ')}.` : 'Agents will no longer be told to avoid anything for this.')
  if (edit.summary !== undefined) out.push('The summary agents and people read changes.')
  return out
}
