import { Bot, BrainCircuit, Check, MessageSquare, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Incident } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtAgo, fmtDateTime } from '../../lib/format'
import { SEVERITY_STYLE } from '../../lib/semantic'
import { Badge, Button, IdChip } from '../ui'
import { HitRow } from './HitRow'
import { useContextHits } from './useContextHits'

const fmtVal = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

export function IncidentCard({
  incident,
  now,
  onAsk,
  onResolve,
  onDelete,
}: {
  incident: Incident
  now: Date
  onAsk: () => void
  onResolve: () => void
  onDelete: () => void
}) {
  const nav = useNavigate()
  const open = incident.status === 'open'
  const { hits, loading } = useContextHits(open ? incident.entity_id : null, null)
  const sev = SEVERITY_STYLE[incident.severity]

  return (
    <div
      className={cn(
        'animate-slide-in rounded-xl border bg-surface shadow-sm',
        open ? 'border-bad/40 border-l-4 border-l-bad' : 'border-line opacity-60 hover:opacity-100',
      )}
    >
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={sev.cls}>{sev.label}</Badge>
          <IdChip onClick={() => nav(`/network?select=${encodeURIComponent(incident.entity_id)}`)}>{incident.entity_id}</IdChip>
          <span className="text-xs font-medium text-muted">{incident.kind}</span>
          {!open && <Badge className="ml-auto bg-ok/15 text-ok">Resolved</Badge>}
        </div>
        <p className="mt-1.5 text-[13px] font-medium leading-snug">{incident.summary}</p>

        {Object.keys(incident.observations).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(incident.observations).map(([k, v]) => (
              <span key={k} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">
                {k}: <b className="font-semibold">{fmtVal(v)}</b>
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
          <span>{fmtDateTime(incident.opened_at)}</span>
          <span>· {fmtAgo(incident.opened_at, now)}</span>
          {incident.thread_id && (
            <button className="ml-auto inline-flex items-center gap-1 text-accent hover:underline" onClick={() => nav(`/conversations/${encodeURIComponent(incident.thread_id!)}`)}>
              <MessageSquare size={12} /> Thread
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-accent-soft/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-accent">
            <BrainCircuit size={14} /> What the context layer knows
            {hits && <span className="rounded bg-accent/15 px-1.5 text-[11.5px]">{hits.length}</span>}
          </div>
          {hits === null || (loading && !hits.length) ? (
            <div className="h-10 animate-pulse rounded-md bg-surface/70" />
          ) : hits.length ? (
            <div className="space-y-1.5">
              {hits.slice(0, 3).map((h) => (
                <HitRow key={h.id} hit={h} onClick={() => nav(`/knowledge?assertion=${encodeURIComponent(h.id)}`)} />
              ))}
              {hits.length > 3 && <div className="text-center text-[12.5px] text-muted">+{hits.length - 3} more in the agent run</div>}
            </div>
          ) : (
            <p className="text-xs text-muted">Nothing known about {incident.entity_id} yet. Once colleagues talk about it, it shows up here.</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 border-t border-line px-3 py-2">
        <Button size="sm" variant="primary" icon={<Bot size={13} />} onClick={onAsk}>
          Ask agent
        </Button>
        {open && (
          <Button size="sm" icon={<Check size={13} />} onClick={onResolve}>
            Resolve
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" icon={<Trash2 size={13} />} onClick={onDelete} aria-label="Delete incident" />
      </div>
    </div>
  )
}
