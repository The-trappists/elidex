// Small shared pieces for assertions: badges, validity text, binding chips.
import { AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AssertionType, Binding, ContextAssertion, TrustLevel } from '../../api/types'
import { fmtDate } from '../../lib/format'
import { TRUST_STYLE, TYPE_STYLE } from '../../lib/semantic'
import { Badge, IdChip } from '../ui'

export const TypeBadge = ({ type }: { type: AssertionType }) => <Badge className={TYPE_STYLE[type].cls}>{TYPE_STYLE[type].label}</Badge>
export const TrustBadge = ({ level }: { level: TrustLevel }) => <Badge className={TRUST_STYLE[level].cls}>{TRUST_STYLE[level].label}</Badge>

export const ASSERTION_TYPES: AssertionType[] = ['workaround', 'access', 'fact', 'invalidation']
export const TRUST_LEVELS: TrustLevel[] = ['hunch', 'stated', 'verified']

export function isValidAt(a: ContextAssertion, at: Date | null): boolean {
  if (!at) return a.valid_to === null
  const t = at.getTime()
  return new Date(a.valid_from).getTime() <= t && (a.valid_to === null || new Date(a.valid_to).getTime() > t)
}

export function Validity({ a }: { a: ContextAssertion }) {
  return (
    <span className="text-xs text-muted">
      {a.valid_to ? `${fmtDate(a.valid_from)} → ${fmtDate(a.valid_to)}` : `since ${fmtDate(a.valid_from)}`}
      {a.valid_to && a.closed_by && (
        <>
          {' '}
          (closed by{' '}
          <Link className="font-mono text-accent hover:underline" to={`/knowledge?assertion=${encodeURIComponent(a.closed_by)}`} onClick={(e) => e.stopPropagation()}>
            {a.closed_by}
          </Link>
          )
        </>
      )}
    </span>
  )
}

export function BindingChips({ bound }: { bound: Binding[] }) {
  if (!bound.length) return <span className="text-xs text-muted">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {bound.map((b, i) => (
        <IdChip key={i}>
          {b.entity}
          <span className="ml-1 text-[11px] text-muted">{b.role.replace('_', ' ')}</span>
        </IdChip>
      ))}
    </div>
  )
}

export const ConflictIcon = ({ a }: { a: ContextAssertion }) =>
  a.conflicts_with.length ? (
    <span title={`Conflicts with ${a.conflicts_with.join(', ')}`} className="text-warn">
      <AlertTriangle size={14} />
    </span>
  ) : null

export const assertionHref = (id: string) => `/knowledge?assertion=${encodeURIComponent(id)}`
export const threadHref = (id: string) => `/conversations/${encodeURIComponent(id)}`
