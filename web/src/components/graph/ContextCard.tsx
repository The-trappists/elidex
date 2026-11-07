import { ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ContextAssertion, ContextHit } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtDate } from '../../lib/format'
import { SOURCE_STYLE, TRUST_STYLE, TYPE_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { Badge, IdChip } from '../ui'
import { validAt } from './graphModel'

const DAY = 86_400_000

/** Validity as a bar on a small time axis: the span of the assertion and a marker for the chosen time. */
function ValidityBar({ a, at }: { a: ContextAssertion; at: Date }) {
  const from = new Date(a.valid_from).getTime()
  const to = a.valid_to ? new Date(a.valid_to).getTime() : null
  const t = at.getTime()
  const pad = 7 * DAY
  const lo = Math.min(from, t) - pad
  const hi = Math.max(to ?? from, t) + pad * 2
  const pct = (x: number) => `${(((x - lo) / (hi - lo)) * 100).toFixed(2)}%`
  const color = TYPE_STYLE[a.type].hex
  return (
    <div>
      <div className="relative h-2 rounded-full bg-line/70">
        <div
          className="absolute inset-y-0 rounded-full"
          style={{
            left: pct(from),
            right: to ? `calc(100% - ${pct(to)})` : 0,
            background: to ? color : `linear-gradient(90deg, ${color}, transparent)`,
          }}
        />
        <div className="absolute -top-1 h-4 w-0.5 rounded bg-text" style={{ left: pct(t) }} title="chosen time" />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{fmtDate(a.valid_from)}</span>
        <span>{a.valid_to ? fmtDate(a.valid_to) : 'still believed true'}</span>
      </div>
    </div>
  )
}

/** Rich card for one assertion: bindings, validity bar, trust and sources. */
export function ContextCard({ a, at }: { a: ContextAssertion | ContextHit; at: Date }) {
  const nav = useNavigate()
  const live = validAt(a, at)
  const via = 'matched_via' in a ? a.matched_via : null
  const threads = useLive((s) => s.threads)
  return (
    <div className={cn('rounded-lg border border-line bg-surface p-3 text-xs', !live && 'opacity-60')} style={{ borderLeft: `3px solid ${TYPE_STYLE[a.type].hex}` }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className={TYPE_STYLE[a.type].cls}>{TYPE_STYLE[a.type].label}</Badge>
        <span className="text-[13px] font-semibold">{a.topic}</span>
        {!live && <Badge className="bg-surface-2 text-muted">not valid at t</Badge>}
        <Badge className={cn(TRUST_STYLE[a.trust.level].cls, 'ml-auto')}>{TRUST_STYLE[a.trust.level].label}</Badge>
      </div>
      <p className="mt-1.5 leading-snug">{a.summary}</p>
      {a.action && <p className="mt-1 text-muted"><b className="font-medium text-text">Action:</b> {a.action}</p>}
      {a.avoid.length > 0 && <p className="mt-1 text-muted"><b className="font-medium text-bad">Avoid:</b> {a.avoid.join('; ')}</p>}
      {a.conditions.length > 0 && <p className="mt-1 text-muted"><b className="font-medium text-text">When:</b> {a.conditions.map((c) => c.text).join('; ')}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {via && <span className="rounded bg-accent-soft px-1 py-0.5 font-mono text-[10px] text-accent">via {via}</span>}
        {a.bound_to.map((b, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[10px] text-muted">
            {b.role.replace('_', ' ')} <IdChip>{b.entity}</IdChip>
          </span>
        ))}
      </div>

      <div className="mt-2.5"><ValidityBar a={a} at={at} /></div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted">
        <span>by <b className="font-medium text-text">{a.trust.stated_by}</b>{a.trust.role ? `, ${a.trust.role}` : ''}</span>
        {a.sources.map((s, i) => (
          <button key={i} className="inline-flex items-center gap-1 hover:text-accent" onClick={() => nav(`/conversations/${encodeURIComponent(s.file)}`)} title={s.file}>
            <Badge className={SOURCE_STYLE[s.source].cls}>{SOURCE_STYLE[s.source].label}</Badge>
            <span className="max-w-32 truncate">{threads[s.file]?.subject ?? s.file}</span>
          </button>
        ))}
        <button className="ml-auto inline-flex items-center gap-1 text-accent hover:underline" onClick={() => nav(`/knowledge?assertion=${encodeURIComponent(a.id)}`)}>
          <ExternalLink size={11} /> {a.id}
        </button>
      </div>
    </div>
  )
}
