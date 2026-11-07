// Content of the Inspector sections that come from the knowledge graph (see docs/knowledge-graph.md):
// where a rule comes from, what it reaches, who to ask about a node and how advice changed over time.
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { GraphTimelineRow } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtDate, fmtDateTime, toNaiveIso } from '../../lib/format'
import { SOURCE_STYLE, TRUST_STYLE, TYPE_STYLE } from '../../lib/semantic'
import { Badge, IdChip } from '../ui'
import { useGraphQuery } from './useGraphQuery'

const Loading = () => <div className="h-12 animate-pulse rounded-xl bg-surface-2" />
const Note = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-muted">{children}</p>
const Failed = ({ msg }: { msg: string }) => <p className="text-xs text-bad">Could not load: {msg}</p>

/** Verbatim messages an assertion was extracted from: who said it, where, when. */
export function Provenance({ assertionId }: { assertionId: string }) {
  const nav = useNavigate()
  const { data, error } = useGraphQuery(() => api.provenance(assertionId), assertionId)
  if (error) return <Failed msg={error} />
  if (!data) return <Loading />
  if (!data.length) return <Note>No source message is linked to this knowledge.</Note>
  return (
    <ul className="space-y-2">
      {data.map((p, i) => (
        <li key={p.message ?? i} className="rounded-lg border border-line p-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {p.source && <Badge className={SOURCE_STYLE[p.source].cls}>{SOURCE_STYLE[p.source].label}</Badge>}
            <b className="font-medium">{p.author ?? 'Unknown author'}</b>
            {p.role && <span className="text-muted">{p.role}</span>}
            <span className="ml-auto text-muted">{p.sent_at ? fmtDateTime(p.sent_at) : ''}</span>
          </div>
          {p.text ? (
            <blockquote className="mt-1.5 whitespace-pre-wrap border-l-2 border-line pl-2 leading-snug text-text/90">{p.text}</blockquote>
          ) : (
            <p className="mt-1.5 text-muted">The thread is known but this message is not loaded.</p>
          )}
          {p.file && (
            <button className="mt-1.5 text-accent hover:underline" onClick={() => nav(`/conversations/${encodeURIComponent(p.file!)}`)}>
              Open conversation{p.seq != null ? ` (message ${p.seq})` : ''}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Elements an assertion reaches, with how each one is reached: the over-linking check. */
export function Reach({ assertionId, onSelect }: { assertionId: string; onSelect: (id: string) => void }) {
  const { data, error } = useGraphQuery(() => api.reach(assertionId), assertionId)
  if (error) return <Failed msg={error} />
  if (!data) return <Loading />
  const rows = Object.entries(data.elements)
  if (!rows.length) return <Note>This knowledge does not reach any element yet.</Note>
  return (
    <div>
      <ul className="space-y-1">
        {rows.map(([el, via]) => (
          <li key={el} className="flex items-center gap-2 text-xs">
            <IdChip onClick={() => onSelect(el)}>{el}</IdChip>
            <span className="text-muted">via {via}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">If an element here should not follow this advice, the binding is too wide: a wrong link is worse than none.</p>
    </div>
  )
}

/** People who stated knowledge about a node (or its class or site), most verified first. */
export function Experts({ entityId, at }: { entityId: string; at: Date }) {
  const iso = toNaiveIso(at)
  const { data, error } = useGraphQuery(() => api.experts(entityId, iso), `${entityId}|${Math.floor(at.getTime() / 60000)}`)
  if (error) return <Failed msg={error} />
  if (!data) return <Loading />
  if (!data.length) return <Note>Nobody has stated knowledge about {entityId} that is valid at this time.</Note>
  return (
    <ul className="space-y-1">
      {data.map((p) => (
        <li key={p.person} className="flex items-center gap-2 text-xs">
          <b className="font-medium">{p.person}</b>
          {p.role && <span className="text-muted">{p.role}</span>}
          <span className="ml-auto text-muted">
            {p.assertions.length} {p.assertions.length === 1 ? 'statement' : 'statements'}
            {p.verified > 0 && `, ${p.verified} verified`}
          </span>
        </li>
      ))}
    </ul>
  )
}

const STATUS: Record<GraphTimelineRow['status'], { label: string; cls: string }> = {
  valid: { label: 'Valid at t', cls: 'bg-ok/15 text-ok' },
  closed: { label: 'Closed', cls: 'bg-surface-2 text-muted' },
  future: { label: 'Not yet valid', cls: 'bg-info/15 text-info' },
}

/** Every piece of advice that ever covered a node, oldest first, with what closed or contradicts it. */
export function Timeline({ entityId, at, onSelect }: { entityId: string; at: Date; onSelect: (assertionId: string) => void }) {
  const iso = toNaiveIso(at)
  const { data, error } = useGraphQuery(() => api.timeline(entityId, iso), `${entityId}|${Math.floor(at.getTime() / 60000)}`)
  if (error) return <Failed msg={error} />
  if (!data) return <Loading />
  if (!data.length) return <Note>No advice has ever covered {entityId}.</Note>
  return (
    <ol className="space-y-2 border-l border-line pl-3">
      {data.map((r) => (
        <li key={r.id} className={cn('relative text-xs', r.status === 'closed' && 'opacity-70')}>
          <span className="absolute -left-[17px] top-1 size-2 rounded-full" style={{ background: TYPE_STYLE[r.type].hex }} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge>
            <button className="font-semibold hover:text-accent" onClick={() => onSelect(r.id)}>{r.topic}</button>
            <Badge className={cn(TRUST_STYLE[r.trust].cls, 'ml-auto')}>{TRUST_STYLE[r.trust].label}</Badge>
          </div>
          <div className="mt-0.5 text-muted">
            {fmtDate(r.valid_from)} → {r.valid_to ? fmtDate(r.valid_to) : 'open'} · by {r.stated_by} · via {r.matched_via}
          </div>
          <p className="mt-0.5 leading-snug">{r.summary}</p>
          {r.closed_by && <p className="mt-0.5 text-muted">Closed by <IdChip onClick={() => onSelect(r.closed_by!)}>{r.closed_by}</IdChip></p>}
          {r.conflicts_with.length > 0 && (
            <p className="mt-0.5 text-bad">Disagrees with {r.conflicts_with.map((c) => <IdChip key={c} onClick={() => onSelect(c)}>{c}</IdChip>)}</p>
          )}
        </li>
      ))}
    </ol>
  )
}
