// Insights: what the captured human knowledge reveals across conversations, in two kinds:
//   Shared root cause - separate problems at the same time that may come from one thing (multi-factor);
//   Recurring issues  - the same problem on the same equipment, again and again.
// One map, one list beside it (a tab per kind). The chosen insight is drawn on the map: problems red,
// possible cause amber, the links between them lit. Every cause is a hypothesis built from human reports.
import { ChevronDown, ChevronRight, Download, GitMerge, Lightbulb, RefreshCw, Repeat } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Pattern, PatternReport } from '../api/types'
import { GraphKey, LineSwatch, ShapeSwatch, Swatch } from '../components/graph/GraphLegend'
import { TopologyGraph } from '../components/force/TopologyGraph'
import { Button, IdChip, Tabs, Toggle, toast } from '../components/ui'
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
  // A node clicked on the map, to look at its neighbourhood; choosing another insight clears it.
  const [picked, setPicked] = useState<string | null>(null)
  const [pickedFor, setPickedFor] = useState(shown?.id)
  if (pickedFor !== shown?.id) {
    setPickedFor(shown?.id)
    setPicked(null)
  }
  const focus = useMemo(
    () => (shown ? { problem: shown.elements, suspect: shown.suspects, links: shown.links } : null),
    [shown],
  )

  // The list shows one kind at a time; it follows the chosen insight.
  const [tab, setTab] = useState<'linked' | 'recurring'>(shown?.kind === 'recurring' ? 'recurring' : 'linked')
  const [tabFor, setTabFor] = useState(shown?.id)
  if (tabFor !== shown?.id) {
    setTabFor(shown?.id)
    if (shown) setTab(shown.kind === 'recurring' ? 'recurring' : 'linked')
  }
  const rows = tab === 'linked' ? shared : recurring

  return (
    <div className="diagram-workspace">
      <div className="diagram-heading flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-medium tracking-tight">Insights from the field</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Problems that may share one cause, and problems that keep coming back. Every cause is a hypothesis to check.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">{openCount ? `${openCount} open` : 'Nothing open'}</span>
          <Toggle checked={showResolved} onChange={setShowResolved} label={`Show resolved (${resolvedCount})`} />
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

      <div className="diagram-body">
        <section className="diagram-main" aria-label="Network map">
          <div className="diagram-canvas">
            <TopologyGraph at={now} insight={focus} selectedId={picked} onSelect={setPicked} showKnowledge={false} />
            {shown && (
              <div className="pointer-events-none absolute left-3 top-3 z-[5] max-w-[min(28rem,calc(100%-5rem))] rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-sm">
                <span className="text-muted">{shown.kind === 'recurring' ? 'Recurring issue' : 'Shared root cause'}</span>
                <span className="mt-0.5 block font-medium leading-snug">{shown.headline}</span>
              </div>
            )}
          </div>
          <div className="diagram-key">
            <GraphKey
              items={[
                { label: 'Problem reported', swatch: <ShapeSwatch shape="circle" color="var(--bad)" dot /> },
                { label: 'Possible common cause', swatch: <ShapeSwatch shape="circle" color="var(--warn)" dot /> },
                { label: 'Link between them', swatch: <LineSwatch color="var(--bad)" /> },
                { label: 'Site', swatch: <Swatch color="var(--g-link)" radius={4} dashed /> },
              ]}
            />
          </div>
        </section>

        <aside className="diagram-details insights-list flex flex-col" aria-label="Insights">
          <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 pt-2">
            <Tabs<'linked' | 'recurring'>
              className="border-b-0"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'linked', label: 'Shared root cause', count: shared.length },
                { id: 'recurring', label: 'Recurring', count: recurring.length },
              ]}
            />
          </div>
          <p className="flex gap-2 px-4 pt-3 text-xs leading-relaxed text-muted">
            {tab === 'linked' ? <GitMerge size={14} className="mt-0.5 shrink-0 text-warn" /> : <Repeat size={14} className="mt-0.5 shrink-0 text-bad" />}
            {tab === 'linked'
              ? 'Separate problems at the same time, on equipment that shares a link, a site or a firmware.'
              : 'The same problem on the same equipment, reported 3 times or more.'}
          </p>
          <div className="divide-y divide-line px-2 pb-2">
            {rows.map((p) => (
              <Row key={p.id} p={p} active={shown?.id === p.id} onSelect={() => select(p.id)} />
            ))}
            {!rows.length && (
              <p className="px-2 py-6 text-sm text-muted">
                {tab === 'linked' ? 'No simultaneous problems with something in common right now.' : 'No problem has come back 3 times.'}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
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
