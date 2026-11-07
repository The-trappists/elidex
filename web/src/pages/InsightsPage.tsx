// Insights: what the captured human knowledge reveals across conversations. Two kinds, one on each side of the map:
//   left  - Shared root cause: separate problems at the same time that may come from one thing (multi-factor);
//   right - Recurring issues: the same problem on the same equipment, again and again.
// The chosen insight is drawn on the map in the middle (problems red, possible cause amber, the links between them lit).
// Every cause is a hypothesis built from human reports, never a rule for the agent.
import { ChevronDown, ChevronRight, Download, GitMerge, Lightbulb, RefreshCw, Repeat } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Pattern, PatternReport } from '../api/types'
import { GraphKey, LineSwatch, Swatch } from '../components/graph/GraphLegend'
import { NetworkGraph } from '../components/graph/NetworkGraph'
import { Button, IdChip, Toggle, toast } from '../components/ui'
import { cn } from '../lib/cn'
import { fmtDate } from '../lib/format'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

const seen = (p: Pattern) =>
  p.level === 'resolved' ? 'Resolved' : p.kind === 'recurring' ? `${p.count}×` : p.count > 1 ? `Seen ${p.count}×` : 'Seen once'

const badge = (p: Pattern) =>
  p.level === 'resolved' ? 'bg-ok/15 text-ok' : p.level === 'insight' ? 'bg-bad/12 text-bad' : 'bg-warn/15 text-warn'

// Open first, newest first; resolved ones (when shown) at the end.
const order = (rows: Pattern[]) =>
  [...rows].sort((a, b) => Number(a.level === 'resolved') - Number(b.level === 'resolved') || b.last_seen.localeCompare(a.last_seen))

export default function InsightsPage() {
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
  // Insights are derived from the knowledge: recompute when it changes.
  useEffect(load, [load, assertions])

  const all = useMemo(() => (report?.patterns ?? []).filter((p) => showResolved || p.level !== 'resolved'), [report, showResolved])
  const shared = useMemo(() => order(all.filter((p) => p.kind === 'linked')), [all])
  const recurring = useMemo(() => order(all.filter((p) => p.kind === 'recurring')), [all])
  const openCount = (report?.patterns ?? []).filter((p) => p.level !== 'resolved').length
  const resolvedCount = (report?.patterns ?? []).length - openCount
  // The chosen insight; with none chosen, the map shows the first open one.
  const shown = all.find((p) => p.id === params.get('p')) ?? shared[0] ?? recurring[0] ?? null
  const select = (id: string) => setParams({ p: id }, { replace: true })
  const focus = useMemo(
    () => (shown ? { problem: shown.elements, suspect: shown.suspects, links: shown.links } : null),
    [shown],
  )

  return (
    <div className="diagram-workspace overflow-auto lg:overflow-hidden">
      <div className="diagram-heading flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-medium tracking-tight">Insights from the field</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            What the team's reports reveal together: problems that may share one cause, and problems that keep coming back.
            Every cause is a hypothesis to check.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">{openCount ? `${openCount} open` : 'Nothing open'}</span>
          <Toggle checked={showResolved} onChange={setShowResolved} label={`Show resolved (${resolvedCount})`} />
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
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface md:grid-cols-2 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,320px)]">
        <Column
          className="lg:border-r"
          icon={<GitMerge size={16} className="text-warn" />}
          title="Shared root cause"
          hint="Separate problems at the same time, on equipment that shares a link, a site or a firmware. One thing may be behind all of them."
          empty="No simultaneous problems with something in common right now."
          rows={shared}
          shown={shown}
          onSelect={select}
        />

        <section className="order-first flex min-h-[380px] flex-col border-b border-line md:col-span-2 lg:order-none lg:col-span-1 lg:min-h-0 lg:border-b-0" aria-label="Network map">
          <div className="min-w-0 border-b border-line px-3 py-2 text-xs text-muted">
            {shown ? (
              <>
                On the map: <span className="font-medium text-text">{shown.headline}</span>
              </>
            ) : (
              'Choose an insight to see it on the network.'
            )}
          </div>
          <div className="diagram-canvas">
            <NetworkGraph at={now} knowledge={false} focus={focus} selectedId={null} />
          </div>
          <div className="diagram-key">
            <GraphKey
              items={[
                { label: 'Problem reported', swatch: <Swatch color="var(--bad)" radius={99} /> },
                { label: 'Possible common cause', swatch: <Swatch color="var(--warn)" radius={99} /> },
                { label: 'Link between them', swatch: <LineSwatch color="var(--bad)" /> },
                { label: 'Site', swatch: <Swatch color="var(--g-link)" radius={4} dashed /> },
                { label: 'Other equipment', swatch: <Swatch color="var(--g-element)" radius={99} fill /> },
              ]}
            />
          </div>
        </section>

        <Column
          className="border-t border-line md:border-l md:border-t-0"
          icon={<Repeat size={16} className="text-bad" />}
          title="Recurring issues"
          hint="The same problem on the same equipment, reported 3 times or more. A quick fix that does not hold."
          empty="No problem has come back 3 times."
          rows={recurring}
          shown={shown}
          onSelect={select}
        />
      </div>
    </div>
  )
}

function Column(props: {
  className?: string
  icon: ReactNode
  title: string
  hint: string
  empty: string
  rows: Pattern[]
  shown: Pattern | null
  onSelect: (id: string) => void
}) {
  const { className, icon, title, hint, empty, rows, shown, onSelect } = props
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col border-line', className)} aria-label={title}>
      <div className="border-b border-line p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
          <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">{rows.length}</span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-line overflow-auto px-2">
        {rows.map((p) => (
          <Row key={p.id} p={p} active={shown?.id === p.id} onSelect={() => onSelect(p.id)} />
        ))}
        {!rows.length && <p className="px-2 py-6 text-sm text-muted">{empty}</p>}
      </div>
    </section>
  )
}

function Row({ p, active, onSelect }: { p: Pattern; active: boolean; onSelect: () => void }) {
  return (
    <div className={cn('my-1 rounded-md', active && 'bg-accent-soft/40 ring-1 ring-accent/40', p.level === 'resolved' && !active && 'opacity-70')}>
      <button onClick={onSelect} aria-expanded={active} className="w-full rounded-md px-2 py-3 text-left hover:bg-surface-2">
        <span className="flex items-center gap-2">
          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', badge(p))}>{seen(p)}</span>
          <span className="truncate font-mono text-xs">{p.elements.join(' · ')}</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted">{fmtDate(p.last_seen)}</span>
        </span>
        <span className="mt-1 block text-sm leading-relaxed">{p.headline}</span>
      </button>
      {active && <Details p={p} />}
    </div>
  )
}

function Details({ p }: { p: Pattern }) {
  const navigate = useNavigate()
  const [reports, setReports] = useState(false)
  return (
    <div className="flex flex-col gap-2.5 border-t border-line px-2 pb-3 pt-2.5 text-xs">
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
              <button className="ml-auto shrink-0 font-mono hover:text-accent" onClick={() => navigate(`/knowledge?assertion=${encodeURIComponent(o.assertion_id)}`)}>
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
