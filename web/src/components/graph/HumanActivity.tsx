// "Human activity" section of the element Inspector: who talked about the element, when they last did, and which
// known knowledge looks similar. Read on demand from the dataset sources (files, Atlas, Tiger Data), never from
// the Dashboard's own threads. Each of the three blocks loads, fails and falls back on its own.
import { AlertTriangle, ChevronDown, Info, RotateCw, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { SourceAnswer, SourceFreshness, SourceSimilar, SourceThread, SourceThreads } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtDate } from '../../lib/format'
import { Badge, Button, Skeleton, SkeletonLines } from '../ui'

type Q<T> = { data: T | null; error: string | null; loading: boolean }

/** One request that can be repeated; the answer of a stale call is dropped. */
function useRequest<T>(fetcher: () => Promise<T>, key: string): Q<T> & { retry: () => void } {
  const [state, setState] = useState<Q<T>>({ data: null, error: null, loading: true })
  const [n, setN] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, [key])
  useEffect(() => {
    let stale = false
    setState((s) => ({ data: s.data, error: null, loading: true }))
    run().then(
      (data) => !stale && setState({ data, error: null, loading: false }),
      (e) => !stale && setState({ data: null, error: e instanceof Error ? e.message : 'request failed', loading: false }),
    )
    return () => {
      stale = true
    }
  }, [run, n])
  return { ...state, retry: () => setN((x) => x + 1) }
}

const SOURCE_LABEL = { files: 'dataset files', atlas: 'MongoDB Atlas', tiger: 'Tiger Data', dashboard: 'this dashboard' } as const

function SourceTag({ a }: { a: SourceAnswer }) {
  return <Badge title={a.detail ?? undefined}>{SOURCE_LABEL[a.source]}</Badge>
}

/** What to show when the source did not give data: not configured (calm) or failed (with retry). */
function Unavailable({ a, error, onRetry }: { a?: SourceAnswer; error?: string | null; onRetry: () => void }) {
  const failed = !!error || a?.status === 'error' || a?.status === 'timeout'
  return (
    <div role="status" className={cn('flex items-start gap-2 rounded-md border p-2.5 text-xs animate-fade-in', failed ? 'border-bad/30 bg-bad/10 text-bad' : 'border-line bg-surface-2 text-muted')}>
      {failed ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <Info size={14} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{failed ? (a?.status === 'timeout' ? 'Source too slow' : 'Source unavailable') : 'Source not configured'}</div>
        <p className="mt-0.5 break-words opacity-90">{error ?? a?.detail}</p>
      </div>
      {failed && (
        <Button size="sm" icon={<RotateCw size={12} />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

const Fallback = ({ a }: { a: SourceAnswer }) =>
  a.fallback_from ? (
    <p className="mb-1.5 text-xs text-warn" title={a.fallback_from.detail}>
      {SOURCE_LABEL[a.fallback_from.source]} is not available ({a.fallback_from.status}), answered from {SOURCE_LABEL[a.source]}.
    </p>
  ) : null

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

function ago(days: number | null) {
  if (days == null) return null
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** Messages per month, as small bars. Every bar has its number in a tooltip and the list is readable by screen readers. */
function Months({ rows }: { rows: SourceFreshness['by_month'] }) {
  const last = rows.slice(-12)
  const max = Math.max(1, ...last.map((r) => r.messages))
  return (
    <div className="mt-2">
      <div className="flex h-10 items-end gap-0.5" role="img" aria-label={`Messages per month: ${last.map((r) => `${r.month} ${r.messages}`).join(', ')}`}>
        {last.map((r, i) => (
          <div
            key={r.month}
            title={`${r.month}: ${plural(r.messages, 'message')}, ${plural(r.people, 'person')}`}
            style={{ height: `${Math.max(8, (r.messages / max) * 100)}%`, ['--i' as string]: i }}
            className="max-w-8 flex-1 origin-bottom rounded-sm bg-accent/70 animate-item-in hover:bg-accent"
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted">
        <span>{last[0]?.month}</span>
        <span>{last[last.length - 1]?.month}</span>
      </div>
    </div>
  )
}

function Summary({ id, fresh, threads }: { id: string; fresh: ReturnType<typeof useRequest<SourceFreshness>>; threads: SourceThreads | null }) {
  if (fresh.loading && !fresh.data) return <SkeletonLines lines={2} />
  const f = fresh.data
  if (fresh.error || !f || f.status !== 'ok') return <Unavailable a={f ?? undefined} error={fresh.error} onRetry={fresh.retry} />
  const n = threads?.status === 'ok' ? threads.total : f.threads
  if (!f.messages)
    return <p className="text-xs text-muted animate-fade-in">Nobody talked about {id} in the dataset. <SourceTag a={f} /></p>
  return (
    <div className="animate-fade-in">
      <Fallback a={f} />
      <p className="text-sm leading-snug">
        {n != null && <><b>{plural(n, 'thread')}</b> {n === 1 ? 'talks' : 'talk'} about {id}. </>}
        Last exchange <b>{ago(f.days_since)}</b> ({fmtDate(f.last_discussed)}).
      </p>
      <p className="mt-0.5 text-xs text-muted">
        {plural(f.messages, 'message')} over {plural(f.active_days, 'active day')} <SourceTag a={f} />
      </p>
      <Months rows={f.by_month} />
    </div>
  )
}

function ThreadRow({ t, i, onOpen }: { t: SourceThread; i: number; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="animate-item-in rounded-md border border-line text-xs" style={{ ['--i' as string]: i }}>
      <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-2" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={13} className={cn('shrink-0 text-muted transition-transform', open ? '' : '-rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{t.subject ?? t.id}</span>
          <span className="block truncate text-muted">
            {fmtDate(t.started_at)} · {t.source} · {plural(t.n_messages, 'message')} · {t.authors.slice(0, 2).join(', ')}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-line px-2 py-2 animate-fade-in">
          {t.preview.map((m, k) => (
            <p key={k} className="leading-snug">
              <b className="font-medium">{m.author}</b> <span className="text-muted">{fmtDate(m.sent_at)}</span>
              <span className="block whitespace-pre-wrap text-text/90">{m.text}</span>
            </p>
          ))}
          {t.n_messages > t.preview.length && <p className="text-muted">… {t.n_messages - t.preview.length} more messages</p>}
          {t.in_dashboard && (
            <Button size="sm" onClick={onOpen}>
              Open conversation
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function ThreadList({ id, first }: { id: string; first: ReturnType<typeof useRequest<SourceThreads>> }) {
  const nav = useNavigate()
  const [more, setMore] = useState<SourceThread[]>([])
  const [moreBusy, setMoreBusy] = useState(false)
  useEffect(() => setMore([]), [id])
  const d = first.data
  if (first.loading && !d) return <div className="space-y-1.5"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
  if (first.error || !d || d.status !== 'ok') return <Unavailable a={d ?? undefined} error={first.error} onRetry={first.retry} />
  const items = [...d.items, ...more]
  if (!items.length) return <p className="text-xs text-muted">No conversation in the dataset names {id}.</p>
  const loadMore = async () => {
    setMoreBusy(true)
    try {
      const r = await api.sourceThreads(id, items.length)
      setMore((m) => [...m, ...r.items])
    } finally {
      setMoreBusy(false)
    }
  }
  return (
    <div>
      <Fallback a={d} />
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <ThreadRow key={t.id} t={t} i={i % 8} onOpen={() => nav(`/conversations/${encodeURIComponent(t.id)}`)} />
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span>{items.length} of {d.total} <SourceTag a={d} /></span>
        {items.length < d.total && <Button size="sm" className="ml-auto" loading={moreBusy} onClick={loadMore}>Show more</Button>}
      </div>
    </div>
  )
}

function Similar({ id, defaultQuery, onSelect }: { id: string; defaultQuery: string; onSelect: (id: string) => void }) {
  const [q, setQ] = useState(defaultQuery)
  const [asked, setAsked] = useState(defaultQuery)
  useEffect(() => { setQ(defaultQuery); setAsked(defaultQuery) }, [defaultQuery])
  const r = useRequest<SourceSimilar>(() => api.sourceSimilar(asked, id), `${id}|${asked}`)
  const d = r.data
  return (
    <div>
      <form className="mb-2 flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (q.trim()) setAsked(q.trim()) }}>
        <div className="relative flex-1">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input aria-label="Describe a situation" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-full rounded-md border border-line bg-surface pl-7 pr-2 text-xs outline-none focus:border-accent" placeholder="Describe a situation…" />
        </div>
        <Button size="sm" type="submit">Search</Button>
      </form>
      {r.loading && !d ? (
        <SkeletonLines lines={3} />
      ) : r.error || !d || d.status !== 'ok' ? (
        <Unavailable a={d ?? undefined} error={r.error} onRetry={r.retry} />
      ) : (
        <div className={cn('transition-opacity', r.loading && 'opacity-50')}>
          <Fallback a={d} />
          {d.items.length ? (
            <ul className="space-y-1.5">
              {d.items.map((s, i) => (
                <li key={s.id} className="animate-item-in" style={{ ['--i' as string]: i }}>
                  <button className="w-full rounded-md border border-line p-2 text-left text-xs hover:bg-surface-2" onClick={() => onSelect(s.id)}>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{s.topic ?? s.id}</span>
                      {s.bound_here && <Badge className="bg-accent-soft text-accent">this element</Badge>}
                      <span className="ml-auto text-muted tabular-nums">{Math.round(s.score * 100)}%</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-muted">{s.summary}</p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No similar knowledge yet.</p>
          )}
          <p className="mt-1.5 text-[11px] leading-snug text-muted">
            <SourceTag a={d} /> {d.detail ?? (d.mode.startsWith('hash') ? 'Matches shared words.' : `Embeddings: ${d.mode}.`)}
          </p>
        </div>
      )}
    </div>
  )
}

const Sub = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mt-3 first:mt-0">
    <h5 className="mb-1.5 text-xs font-medium text-muted">{title}</h5>
    {children}
  </div>
)

export function HumanActivity({ id, defaultQuery, onSelectKnowledge }: { id: string; defaultQuery: string; onSelectKnowledge: (assertionId: string) => void }) {
  const fresh = useRequest(() => api.sourceFreshness(id), id)
  const threads = useRequest(() => api.sourceThreads(id, 0), id)
  return (
    <div>
      <Summary id={id} fresh={fresh} threads={threads.data} />
      <Sub title="Conversations about it">
        <ThreadList id={id} first={threads} />
      </Sub>
      <Sub title="Similar knowledge">
        <Similar id={id} defaultQuery={defaultQuery} onSelect={onSelectKnowledge} />
      </Sub>
    </div>
  )
}
