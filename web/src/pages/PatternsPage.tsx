// Patterns: unrelated problems that may share a cause, and problems that keep coming back. The list sits in the
// side panel; the chosen pattern is drawn on the network map (problems in red, the possible common cause in amber).
// Built from captured human knowledge only; every cause is a hypothesis, never a rule for the agent.
import { ChevronDown, ChevronRight, Download, Lightbulb, Radar, RefreshCw } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Pattern, PatternReport } from '../api/types'
import { GraphKey, LineSwatch, Swatch } from '../components/graph/GraphLegend'
import { GraphWorkspace } from '../components/graph/GraphWorkspace'
import { NetworkGraph } from '../components/graph/NetworkGraph'
import { Button, EmptyState, IdChip, Toggle, toast } from '../components/ui'
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
  // The chosen pattern opens its details; with none chosen, the map still shows the first one.
  const chosen = listed.find((p) => p.id === params.get('p')) ?? null
  const shown = chosen ?? listed[0] ?? null
  const select = (id: string | null) => setParams(id ? { p: id } : {}, { replace: true })
  const focus = useMemo(
    () => (shown ? { problem: shown.elements, suspect: shown.suspects, links: shown.links } : null),
    [shown],
  )

  return (
    <GraphWorkspace
      title="Patterns across problems"
      description="Unrelated problems that may share a cause, and problems that keep coming back. Every cause is a hypothesis."
      selected={!!chosen}
      onClear={() => select(null)}
      toolbar={
        <>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-sm font-semibold">{open.length ? `${open.length} open pattern${open.length === 1 ? '' : 's'}` : 'Nothing open'}</div>
            {shown && <div className="mt-0.5 truncate text-xs text-muted">On the map: {shown.headline}</div>}
          </div>
          <Toggle checked={showResolved} onChange={setShowResolved} label={`Show resolved (${resolved.length})`} />
          {report && (
            <span className="text-xs text-muted" title={`Same problem in other words: meaning check ${report.meaning}`}>
              {report.meaning.startsWith('on') ? 'words + meaning' : 'words only'}
            </span>
          )}
          <Button size="sm" icon={<RefreshCw size={14} className={cn(loading && 'animate-spin')} />} onClick={load}>
            Recompute
          </Button>
          <a href={api.patternsReportUrl()} download title="Download the report (Markdown)">
            <Button size="sm" icon={<Download size={14} />}>
              Report
            </Button>
          </a>
        </>
      }
      legend={
        <GraphKey
          items={[
            { label: 'Problem reported', swatch: <Swatch color="var(--bad)" radius={99} /> },
            { label: 'Possible common cause', swatch: <Swatch color="var(--warn)" radius={99} /> },
            { label: 'Link between them', swatch: <LineSwatch color="var(--bad)" /> },
            { label: 'Site', swatch: <Swatch color="var(--g-link)" radius={4} dashed /> },
            { label: 'Other equipment', swatch: <Swatch color="var(--g-element)" radius={99} fill /> },
          ]}
        />
      }
      canvas={<NetworkGraph at={now} knowledge={false} focus={focus} selectedId={null} />}
      browse={
        <div className="p-4">
          {report && !listed.length ? (
            <EmptyState
              icon={<Radar size={22} />}
              title="No pattern right now"
              hint="A pattern appears when elements in separate conversations have trouble at the same time and share a neighbour, a site or a firmware, or when the same problem comes back 3 times."
            />
          ) : (
            <>
              <Group title="Possible common cause" hint="Unrelated problems at the same time" rows={linked} shown={shown} onSelect={select} />
              <Group title="Keeps coming back" hint="The same problem 3 times or more" rows={recurring} shown={shown} onSelect={select} />
              {showResolved && <Group title="Resolved" rows={resolved} shown={shown} onSelect={select} />}
            </>
          )}
        </div>
      }
      details={chosen ? <Details p={chosen} /> : null}
    />
  )
}

function Group({ title, hint, rows, shown, onSelect }: { title: string; hint?: string; rows: Pattern[]; shown: Pattern | null; onSelect: (id: string) => void }) {
  if (!rows.length) return null
  return (
    <div className="mb-5">
      <h3 className="font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-2 divide-y divide-line">
        {rows.map((p) => <PatternRow key={p.id} p={p} active={shown?.id === p.id} onSelect={() => onSelect(p.id)} />)}
      </div>
    </div>
  )
}

function PatternRow({ p, active, onSelect }: { p: Pattern; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      aria-current={active || undefined}
      className={cn(
        'w-full rounded-md px-2 py-3 text-left hover:bg-surface-2',
        active && 'bg-accent-soft/40',
        p.level === 'resolved' && !active && 'opacity-70',
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', badge(p))}>{seen(p)}</span>
        <span className="truncate font-mono text-xs">{p.elements.join(' · ')}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted">{fmtDate(p.last_seen)}</span>
      </span>
      <span className="mt-1 block text-sm leading-relaxed">{p.headline}</span>
    </button>
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
    <div className="flex flex-col gap-3 p-4 text-xs">
      <div>
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', badge(p))}>{seen(p)}</span>
        <h3 className="mt-2 text-base font-semibold leading-snug">{p.headline}</h3>
        <p className="mt-1 text-muted">Last seen {fmtDate(p.last_seen)}</p>
      </div>
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
