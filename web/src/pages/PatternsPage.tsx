// Patterns: unrelated problems that may share a cause, and problems that keep coming back. A short list on the left;
// the selected pattern on the network map on the right (problems in red, the possible common cause in amber).
// Built from captured human knowledge only; every cause is a hypothesis, never a rule for the agent.
import { ChevronDown, ChevronRight, Download, Lightbulb, Radar, RefreshCw } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Pattern, PatternReport } from '../api/types'
import { NetworkGraph } from '../components/graph/NetworkGraph'
import { EmptyState, IconButton, IdChip, Toggle, toast } from '../components/ui'
import { cn } from '../lib/cn'
import { fmtDate } from '../lib/format'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

const seen = (p: Pattern) =>
  p.level === 'resolved' ? 'Resolved' : p.kind === 'recurring' ? `${p.count}×` : p.count > 1 ? `Seen ${p.count}×` : 'Seen once'

const badge = (p: Pattern) =>
  p.level === 'resolved' ? 'bg-ok/15 text-ok' : p.level === 'insight' ? 'bg-bad/12 text-bad' : 'bg-warn/15 text-warn'

export default function PatternsPage() {
  const assertions = useLive((s) => s.assertions)
  const [params, setParams] = useSearchParams()
  const [report, setReport] = useState<PatternReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const nowSec = Math.floor((useSimNow(30_000) ?? new Date()).getTime() / 60_000)
  const now = useMemo(() => new Date(nowSec * 60_000), [nowSec])

  const load = useCallback(() => {
    setLoading(true)
    api.patterns().then(setReport, (e) => toast.error(e)).finally(() => setLoading(false))
  }, [])
  // Patterns are derived from the knowledge: recompute when it changes.
  useEffect(load, [load, assertions])

  const all = report?.patterns ?? []
  const open = all.filter((p) => p.level !== 'resolved')
  const linked = open.filter((p) => p.kind === 'linked')
  const recurring = open.filter((p) => p.kind === 'recurring')
  const resolved = all.filter((p) => p.level === 'resolved')
  const listed = [...linked, ...recurring, ...(showResolved ? resolved : [])]
  const selectedId = params.get('p')
  const selected = listed.find((p) => p.id === selectedId) ?? listed[0] ?? null
  const select = (id: string) => setParams({ p: id }, { replace: true })
  const focus = useMemo(
    () => (selected ? { problem: selected.elements, suspect: selected.suspects, links: selected.links } : null),
    [selected],
  )

  return (
    <div className="flex h-full min-h-0">
      <section className="flex w-[400px] shrink-0 flex-col border-r border-line bg-surface 2xl:w-[460px]">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
          <span className="text-sm font-semibold">{open.length ? `${open.length} open` : 'Nothing open'}</span>
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton title="Recompute" icon={<RefreshCw size={14} className={cn(loading && 'animate-spin')} />} onClick={load} />
            <a href={api.patternsReportUrl()} download title="Download the report (Markdown)">
              <IconButton icon={<Download size={14} />} />
            </a>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {report && !listed.length ? (
            <EmptyState
              icon={<Radar size={22} />}
              title="No pattern right now"
              hint="A pattern appears when elements in separate conversations have trouble at the same time and share a neighbour, a site or a firmware, or when the same problem comes back 3 times."
            />
          ) : (
            <>
              <Group title="Possible common cause" hint="Unrelated problems at the same time" rows={linked} selected={selected} onSelect={select} />
              <Group title="Keeps coming back" hint="The same problem 3 times or more" rows={recurring} selected={selected} onSelect={select} />
              {showResolved && <Group title="Resolved" rows={resolved} selected={selected} onSelect={select} />}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2 text-xs text-muted">
          <Toggle checked={showResolved} onChange={setShowResolved} label={`Show resolved (${resolved.length})`} />
          {report && (
            <span className="ml-auto truncate" title={`Same problem in other words: meaning check ${report.meaning}`}>
              {report.meaning.startsWith('on') ? 'words + meaning' : 'words only'}
            </span>
          )}
        </div>
      </section>

      <section className="relative min-w-0 flex-1 bg-bg">
        <NetworkGraph at={now} layers={{ knowledge: false }} focus={focus} />
        {selected && <MapLegend p={selected} />}
      </section>
    </div>
  )
}

function Group({ title, hint, rows, selected, onSelect }: { title: string; hint?: string; rows: Pattern[]; selected: Pattern | null; onSelect: (id: string) => void }) {
  if (!rows.length) return null
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-baseline gap-2 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((p) => <PatternRow key={p.id} p={p} active={selected?.id === p.id} onSelect={() => onSelect(p.id)} />)}
      </div>
    </div>
  )
}

function PatternRow({ p, active, onSelect }: { p: Pattern; active: boolean; onSelect: () => void }) {
  return (
    <div
      className={cn(
        'cursor-pointer rounded-lg border px-3 py-2.5 transition-colors',
        active ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-surface-2',
        p.level === 'resolved' && !active && 'opacity-70',
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', badge(p))}>{seen(p)}</span>
        <span className="truncate font-mono text-xs">{p.elements.join(' · ')}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted">{fmtDate(p.last_seen)}</span>
      </div>
      <div className="mt-1 text-sm leading-snug">{p.headline}</div>
      {active && <Details p={p} />}
    </div>
  )
}

function Details({ p }: { p: Pattern }) {
  const navigate = useNavigate()
  const [reports, setReports] = useState(false)
  const go = (e: React.MouseEvent, to: string) => {
    e.stopPropagation()
    navigate(to)
  }
  return (
    <div className="mt-2.5 flex flex-col gap-2.5 border-t border-line pt-2.5 text-xs" onClick={(e) => e.stopPropagation()}>
      {p.hypotheses.slice(0, 2).map((h, i) => (
        <div key={i} className="flex gap-1.5">
          <Lightbulb size={13} className="mt-0.5 shrink-0 text-accent" />
          <span>{h.text}</span>
        </div>
      ))}
      {p.fixes.length > 0 && (
        <Line label="Done so far">
          {p.fixes.map((f) => `${f.action.replace(/\.$/, '')} (${f.applied}×)`).join('; ')}
        </Line>
      )}
      {p.people.length > 0 && <Line label="Who to ask">{p.people.join(', ')}</Line>}
      <div className="flex flex-wrap items-center gap-1.5">
        {[...p.elements, ...p.suspects].map((id) => (
          <IdChip key={id} onClick={() => navigate(`/network?select=${encodeURIComponent(id)}`)}>{id}</IdChip>
        ))}
        <button className="ml-auto flex items-center gap-0.5 font-medium text-muted hover:text-text" onClick={() => setReports((v) => !v)}>
          {reports ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {p.occurrences.length} report{p.occurrences.length === 1 ? '' : 's'}
        </button>
      </div>
      {reports && (
        <ul className="flex flex-col gap-1 text-muted">
          {p.occurrences.map((o, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="tabular-nums">{fmtDate(o.at)}</span>
              <span className="font-mono text-text">{o.element}</span>
              <span className="truncate">{o.topic}</span>
              <button className="ml-auto shrink-0 font-mono hover:text-accent" onClick={(e) => go(e, `/knowledge?assertion=${encodeURIComponent(o.assertion_id)}`)}>
                {o.assertion_id}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="text-[11px] text-muted">{p.note}</div>
    </div>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="font-medium text-muted">{label}: </span>
      {children}
    </div>
  )
}

function MapLegend({ p }: { p: Pattern }) {
  return (
    <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-md border border-line bg-surface/95 px-3 py-2 text-xs shadow-sm">
      <span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-bad" /> Problem reported{p.elements.length > 1 ? ` (${p.elements.length})` : ''}</span>
      {p.suspects.length > 0 && (
        <span className="flex items-center gap-2"><span className="size-2.5 rounded-full border-2 border-warn" /> Possible common cause: {p.suspects.join(', ')}</span>
      )}
      {p.links.length > 0 && <span className="flex items-center gap-2"><span className="h-0.5 w-3 bg-bad" /> Link between them</span>}
    </div>
  )
}
