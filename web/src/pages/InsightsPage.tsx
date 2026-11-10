// Insights: what the captured human knowledge reveals across conversations, in two kinds:
//   Shared root cause - separate problems at the same time that may come from one thing (multi-factor);
//   Recurring issues  - the same problem on the same equipment, again and again.
// One map, one list beside it (a tab per kind). The chosen insight is drawn on the map: problems red,
// possible cause amber, the links between them lit. Every cause is a hypothesis built from human reports.
// The public demo gets a simplified variant: the six newest open correlations, no export or filters.
import { Download, GitMerge, Lightbulb, RefreshCw, Repeat, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Pattern, PatternLevel } from '../api/types'
import { TopologyGraph } from '../components/force/TopologyGraph'
import { GraphKey, LineSwatch, ShapeSwatch, Swatch } from '../components/graph/GraphLegend'
import { PatternRow } from '../components/insights/PatternRow'
import { buildPatternsExport, LEVEL_CLS, LEVEL_HELP, LEVEL_LABEL, LEVEL_ORDER, patternText } from '../components/insights/meta'
import { CorrelationGraph } from '../components/insights/CorrelationGraph'
import { SimTimeline, TimeChip } from '../components/timeline/SimTimeline'
import { useTimelineEvents } from '../components/timeline/useTimeline'
import { useCompanyDay } from '../lib/useCompanyDay'
import { toNaiveIso } from '../lib/format'
import { usePatterns } from '../components/insights/usePatterns'
import { MergesBadge } from '../components/knowledge/MergesDrawer'
import { ExportListMenu } from '../components/review/ExportListMenu'
import { Button, EmptyState, Input, Select, Tabs } from '../components/ui'
import { cn } from '../lib/cn'
import { useSimNow } from '../lib/useNow'
import { useDemo } from '../store/demo'
import { useLive } from '../store/live'

const PAGE = 25
const PUBLIC_ROWS = 6
type Sort = 'newest' | 'reports'

// Open first; resolved ones (when shown) at the end.
const order = (rows: Pattern[], sort: Sort) =>
  [...rows].sort(
    (a, b) => Number(a.level === 'resolved') - Number(b.level === 'resolved') || (sort === 'reports' ? b.count - a.count : 0) || b.last_seen.localeCompare(a.last_seen),
  )

export default function InsightsPage() {
  const threads = useLive((s) => s.threads)
  const publicDemo = useDemo((s) => s.status?.enabled ?? false)
  const [params, setParams] = useSearchParams()
  const [reloadKey, setReloadKey] = useState(0)
  const [t, setT] = useState<Date | null>(null)
  const [view, setView] = useState<'evidence' | 'network'>('evidence')
  const { report, patterns, error, loading, refreshing } = usePatterns(reloadKey, t ? toNaiveIso(t) : null)
  const events = useTimelineEvents()
  const company = useCompanyDay()
  const [levels, setLevels] = useState<Set<PatternLevel>>(new Set(['insight', 'watch']))
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [limit, setLimit] = useState(PAGE)
  const known = useRef<Set<string> | null>(null)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const nowSec = Math.floor((useSimNow(30_000) ?? new Date()).getTime() / 60_000)
  const now = useMemo(() => new Date(nowSec * 60_000), [nowSec])
  const at = t ?? now

  // Patterns that were not there on the previous report are marked New until the page is left.
  useEffect(() => {
    if (!report || t) return
    const ids = new Set(report.patterns.map((p) => p.id))
    if (known.current) {
      const added = report.patterns.filter((p) => !known.current!.has(p.id)).map((p) => p.id)
      if (added.length) setNewIds((old) => new Set([...old, ...added]))
    }
    known.current = ids
  }, [report, t])

  const computedAt = report ? new Date(report.at) : null
  const needle = q.trim().toLowerCase()
  const everything = patterns
  const searched = useMemo(() => (needle ? everything.filter((p) => patternText(p).includes(needle)) : everything), [everything, needle])
  const levelCount = (l: PatternLevel) => searched.filter((p) => p.level === l).length
  const all = useMemo(() => searched.filter((p) => levels.has(p.level)), [searched, levels])
  const shared = useMemo(() => order(all.filter((p) => p.kind === 'linked'), sort), [all, sort])
  const recurring = useMemo(() => order(all.filter((p) => p.kind === 'recurring'), sort), [all, sort])
  const openCount = everything.filter((p) => p.level !== 'resolved').length

  // Public: open patterns only, newest first, six per tab; `?p=` still reaches any of them.
  const open = useMemo(() => everything.filter((p) => p.level !== 'resolved').sort((a, b) => b.last_seen.localeCompare(a.last_seen)), [everything])
  const publicShared = useMemo(() => open.filter((p) => p.kind === 'linked').slice(0, PUBLIC_ROWS), [open])
  const publicRecurring = useMemo(() => open.filter((p) => p.kind === 'recurring').slice(0, PUBLIC_ROWS), [open])
  const publicLinkedCount = open.filter((p) => p.kind === 'linked').length
  const publicRecurringCount = open.filter((p) => p.kind === 'recurring').length

  // The chosen insight; with none chosen, the map shows the first open one.
  const shown = publicDemo
    ? open.find((p) => p.id === params.get('p')) ?? publicShared[0] ?? publicRecurring[0] ?? null
    : all.find((p) => p.id === params.get('p')) ?? shared[0] ?? recurring[0] ?? null
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
  const rows = publicDemo ? (tab === 'linked' ? publicShared : publicRecurring) : tab === 'linked' ? shared : recurring
  const toggleLevel = (l: PatternLevel) => {
    const next = new Set(levels)
    if (next.has(l)) next.delete(l)
    else next.add(l)
    setLevels(next)
    setLimit(PAGE)
  }
  const nothingYet = !!report && everything.length === 0
  const retry = () => setReloadKey((k) => k + 1)

  const map = (
    <section className="diagram-main" aria-label="Correlation explorer">
      <div className="diagram-toolbar" role="group" aria-label="Correlation view">
        <Button size="sm" variant={view === 'evidence' ? 'primary' : 'secondary'} aria-pressed={view === 'evidence'} onClick={() => setView('evidence')}>Evidence graph</Button>
        <Button size="sm" variant={view === 'network' ? 'primary' : 'secondary'} aria-pressed={view === 'network'} onClick={() => setView('network')}>Network map</Button>
      </div>
      <div className="diagram-canvas" aria-busy={loading}>
        {loading ? <div className="flex h-full items-center justify-center p-4 text-sm text-muted" role="status">Loading correlations at the selected time…</div>
          : error ? <EmptyState icon={<Lightbulb size={26} />} title="Could not load correlations" hint={error} action={<Button size="sm" onClick={retry}>Try again</Button>} />
          : view === 'evidence' ? shown ? <CorrelationGraph key={shown.id} pattern={shown} threads={threads} /> : <EmptyState icon={<Lightbulb size={26} />} title="No correlation at this time" hint="Move the slider forward or run the company day to collect more reports." />
          : <TopologyGraph at={at} insight={focus} selectedId={picked} onSelect={setPicked} showKnowledge={false} />}
      </div>
      <SimTimeline events={events} at={at} now={now} follow={t === null} onChange={setT} onReset={() => setT(null)} company={company} />
      <div className="diagram-key">
        <GraphKey items={view === 'evidence' ? [
          { label: 'Human report', swatch: <ShapeSwatch shape="circle" color="var(--k-conversation)" /> },
          { label: 'Equipment', swatch: <ShapeSwatch shape="square" color="var(--k-equipment)" /> },
          { label: 'Shared factor · hypothesis', swatch: <ShapeSwatch shape="hexagon" color="var(--warn)" dashed /> },
          ...(shown?.kind === 'recurring' ? [{ label: 'Same reported problem', swatch: <ShapeSwatch shape="hexagon" color="var(--accent)" /> }] : []),
        ] : [
          { label: 'Problem reported', swatch: <ShapeSwatch shape="circle" color="var(--bad)" dot /> },
          { label: 'Possible common cause', swatch: <ShapeSwatch shape="circle" color="var(--warn)" dot /> },
          { label: 'Link between them', swatch: <LineSwatch color="var(--bad)" /> },
          { label: 'Site', swatch: <Swatch color="var(--g-site-line)" radius={4} dashed /> },
        ]} />
      </div>
    </section>
  )

  if (publicDemo) {
    return (
      <div className="diagram-workspace correlation-workspace is-public-insights">
        <div className="diagram-heading flex-wrap">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-medium tracking-tight">Correlations</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">Problems that repeat, and what they share.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{openCount ? `${openCount} open` : 'Nothing open'}</span><TimeChip at={at} now={now} follow={t === null} onReset={() => setT(null)} /></div>
        </div>
        <div className="diagram-body">
          {map}
          <aside className="diagram-details insights-list flex flex-col" aria-label="Correlations">
            <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 pt-2">
              <Tabs<'linked' | 'recurring'>
                className="border-b-0"
                value={tab}
                onChange={setTab}
                items={[
                  { id: 'linked', label: 'Linked', count: publicLinkedCount },
                  { id: 'recurring', label: 'Recurring', count: publicRecurringCount },
                ]}
              />
            </div>
            <div className="px-2 pb-2 pt-1">
              {!report && loading && (
                <div className="space-y-3 p-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-md" />)}</div>
              )}
              {!report && error && (
                <div className="m-2 rounded-md border border-bad/30 bg-bad/8 p-3 text-[13px]" role="alert">
                  <b className="font-semibold text-bad">Could not load correlations.</b>
                  <Button size="sm" className="mt-2" onClick={retry}>Try again</Button>
                </div>
              )}
              {nothingYet ? (
                <EmptyState icon={<Lightbulb size={26} />} title="No correlations at this time." hint="Move the slider forward or run a company day to collect more human reports." />
              ) : (
                report &&
                !rows.length && <p className="px-2 py-6 text-sm text-muted">Nothing open here.</p>
              )}
              {rows.length > 0 && (
                <ul className="divide-y divide-line">
                  {rows.map((p) => (
                    <li key={p.id}>
                      <PatternRow p={p} active={shown?.id === p.id} isNew={false} threads={threads} onSelect={() => select(p.id)} publicDemo compact />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <div className="diagram-workspace correlation-workspace">
      <div className="diagram-heading flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-medium tracking-tight">Insights from the field</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Problems that may share one cause, and problems that keep coming back. Every cause is a hypothesis to check.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{openCount ? `${openCount} open` : 'Nothing open'}</span>
          <TimeChip at={at} now={now} follow={t === null} onReset={() => setT(null)} />
          <MergesBadge />
          <span className="text-xs text-muted" aria-live="polite">{loading ? 'Updating…' : computedAt ? `Updated ${computedAt.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</span>
          <Button size="sm" icon={<RefreshCw size={14} className={cn((loading || refreshing) && 'animate-spin')} />} onClick={retry} disabled={loading || refreshing}>
            Refresh
          </Button>
          <ExportListMenu filename="insights" disabled={!all.length} build={(f) => buildPatternsExport(all, threads, f)} />
          <a href={api.patternsReportUrl(t ? toNaiveIso(t) : null)} download title="Download the full report (Markdown)">
            <Button size="sm" icon={<Download size={14} />}>
              Report
            </Button>
          </a>
        </div>
      </div>

      <div className="diagram-body">
        {map}

        <aside className="diagram-details insights-list flex flex-col" aria-label="Insights">
          <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 pt-2">
            <Tabs<'linked' | 'recurring'>
              className="border-b-0"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'linked', label: 'Linked problems', count: shared.length },
                { id: 'recurring', label: 'Recurring', count: recurring.length },
              ]}
            />
          </div>
          <div className="space-y-2 px-4 pt-2.5">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <Input className="pl-8" type="search" aria-label="Search insights" placeholder="Search equipment, topic…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} />
              </div>
              <Select className="w-28 shrink-0" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="newest">Newest</option>
                <option value="reports">Most reports</option>
              </Select>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="How sure are we">
              {LEVEL_ORDER.map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={levels.has(l)}
                  title={LEVEL_HELP[l]}
                  onClick={() => toggleLevel(l)}
                  className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs', levels.has(l) ? `border-transparent ${LEVEL_CLS[l]}` : 'border-line text-muted hover:text-text')}
                >
                  {LEVEL_LABEL[l]} <span className="tabular-nums">{levelCount(l)}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="flex gap-2 px-4 pt-3 text-xs leading-relaxed text-muted">
            {tab === 'linked' ? <GitMerge size={14} className="mt-0.5 shrink-0 text-warn" /> : <Repeat size={14} className="mt-0.5 shrink-0 text-bad" />}
            {tab === 'linked'
              ? 'Separate problems at the same time, on equipment that shares a link, a site or a firmware version.'
              : 'The same problem on the same equipment, reported 3 times or more.'}
          </p>
          <p className="px-4 pt-1.5 text-[11px] leading-relaxed text-muted">
            <b className="font-semibold">Insight</b>: several reports. <b className="font-semibold">Possible link</b>: seen once, worth watching. <b className="font-semibold">Resolved</b>: a lasting fix was reported.
          </p>
          <div className="px-2 pb-2 pt-1">
            {!report && loading && (
              <div className="space-y-3 p-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-md" />)}</div>
            )}
            {!report && error && (
              <div className="m-2 rounded-md border border-bad/30 bg-bad/8 p-3 text-[13px]" role="alert">
                <b className="font-semibold text-bad">Could not compute the insights.</b>
                <p className="mt-0.5 break-words text-muted">{error}</p>
                <Button size="sm" className="mt-2" onClick={retry}>Retry</Button>
              </div>
            )}
            {nothingYet ? (
              <EmptyState
                icon={<Lightbulb size={26} />}
                title="No insights yet"
                hint="They appear when the same problem is reported 3 times on the same equipment, or when separate problems at the same time share a link, a site or a firmware version. Run a few conversations or a Company day, then refresh."
                action={<Button size="sm" onClick={retry}>Refresh</Button>}
              />
            ) : (
              report &&
              !rows.length && (
                <p className="px-2 py-6 text-sm text-muted">
                  {needle || levels.size < 3
                    ? 'Nothing matches the search and the levels chosen.'
                    : tab === 'linked' ? 'No simultaneous problems with something in common right now.' : 'No problem has come back 3 times.'}
                </p>
              )
            )}
            {rows.length > 0 && (
              <ul className="divide-y divide-line">
                {rows.slice(0, limit).map((p) => (
                  <li key={p.id}>
                    <PatternRow p={p} active={shown?.id === p.id} isNew={newIds.has(p.id)} threads={threads} onSelect={() => select(p.id)} />
                  </li>
                ))}
              </ul>
            )}
            {rows.length > limit && (
              <div className="p-2 text-center"><Button size="sm" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more of {rows.length - limit}</Button></div>
            )}
            {report?.meaning && <p className="px-2 pt-3 text-[11px] text-muted">Topics compared by: {report.meaning}</p>}
          </div>
        </aside>
      </div>
    </div>
  )
}
