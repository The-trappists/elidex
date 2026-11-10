import { addDays } from 'date-fns'
import { Search, Waypoints, SlidersHorizontal } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { demoKnowledgeGraph, isDemo } from '../api/fixtures/company'
import { useLive } from '../store/live'
import type { KgElement, KgKind, Pattern } from '../api/types'
import { useGraphQuery } from '../components/graph/useGraphQuery'
import { validAt } from '../components/graph/graphModel'
import { ForceCanvas, GraphLoading, type Emphasis } from '../components/force/ForceCanvas'
import { KG_SHAPE, knowledgeModel } from '../components/force/models'
import { KgDetails } from '../components/kg/KgDetails'
import { KIND, KIND_ORDER, title } from '../components/kg/kgStyle'
import { ExportMenu } from '../components/knowledge/ExportMenu'
import { CorrelationsChip } from '../components/insights/CorrelationsChip'
import { PatternDrawer } from '../components/insights/PatternDrawer'
import { patternIndex } from '../components/insights/patternIndex'
import { usePatterns } from '../components/insights/usePatterns'
import { SimTimeline, TimeChip } from '../components/timeline/SimTimeline'
import { threadAssertionIndex, type TimelineEvent } from '../components/timeline/timelineModel'
import { useTimelineEvents } from '../components/timeline/useTimeline'
import { Button, EmptyState, Input, Toggle } from '../components/ui'
import { GraphWorkspace } from '../components/graph/GraphWorkspace'
import { GraphKey, ShapeSwatch } from '../components/graph/GraphLegend'
import { useCompanyDay } from '../lib/useCompanyDay'
import { useSimNow } from '../lib/useNow'
import { useDemo } from '../store/demo'
import { cn } from '../lib/cn'

type Data = KgElement['data']

const DEFAULT_KINDS: KgKind[] = ['Assertion', 'Person', 'Element', 'Class', 'Event', 'Thread']
const PUBLIC_KINDS: KgKind[] = ['Assertion', 'Person', 'Element', 'Thread']
const HOUR = 3_600_000

/** Knowledge first, then the other kinds in a stable order; alphabetical inside each group. */
function groupBrowseNodes(items: Data[]) {
  const order = new Map(KIND_ORDER.map((kind, index) => [kind, index]))
  const sorted = [...items].sort((a, b) => {
    const ak = a.kind as KgKind
    const bk = b.kind as KgKind
    const byKind = (order.get(ak) ?? KIND_ORDER.length) - (order.get(bk) ?? KIND_ORDER.length)
    if (byKind) return byKind
    return title(a).localeCompare(title(b), undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id)
  })
  const groups: { kind: KgKind; items: Data[] }[] = []
  for (const d of sorted) {
    const kind = d.kind as KgKind
    const last = groups[groups.length - 1]
    if (last?.kind === kind) last.items.push(d)
    else groups.push({ kind, items: [d] })
  }
  return groups
}

export default function GraphPage() {
  const [params, setParams] = useSearchParams()
  // ?focus=<id> is the deep link from the Knowledge page; it selects that node like ?node does.
  const selectedId = params.get('node') ?? params.get('focus')
  const select = (id: string | null) => setParams(id ? { node: id } : {}, { replace: true })
  const publicDemo = useDemo((s) => s.status?.enabled ?? false)
  const [kinds, setKinds] = useState<Set<KgKind>>(() => new Set(publicDemo ? PUBLIC_KINDS : DEFAULT_KINDS))
  const [moreTypes, setMoreTypes] = useState(false)
  const [showOutdated, setShowOutdated] = useState(false)
  const [q, setQ] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const [t, setT] = useState<Date | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [focusPattern, setFocusPattern] = useState<Pattern | null>(null)

  const nowSec = Math.floor((useSimNow(5000) ?? new Date()).getTime() / 1000)
  const now = useMemo(() => new Date(nowSec * 1000), [nowSec])
  const at = t ?? now
  const atMs = at.getTime()
  const assertions = useLive((s) => s.assertions)
  const threads = useLive((s) => s.threads)
  const company = useCompanyDay()
  const events = useTimelineEvents()
  const { patterns } = usePatterns()
  const correlations = useMemo(() => patternIndex(patterns), [patterns])

  const { data, error } = useGraphQuery(() => (isDemo() ? Promise.resolve(demoKnowledgeGraph(useLive)) : api.knowledgeGraph()), `kg-${retry}`)

  const { nodes, edges, counts } = useMemo(() => {
    const nodes = new Map<string, Data>()
    const edges: Data[] = []
    const counts: Record<string, number> = {}
    for (const el of data?.elements ?? []) {
      if (el.group === 'nodes') {
        nodes.set(el.data.id, el.data)
        counts[el.data.kind ?? ''] = (counts[el.data.kind ?? ''] ?? 0) + 1
      } else edges.push(el.data)
    }
    return { nodes, edges, counts }
  }, [data])

  // In force at `at`: the store assertion first, the payload flag as a fallback.
  const inForce = useCallback(
    (d: Data) => {
      if (d.kind !== 'Assertion') return true
      const a = assertions[d.id]
      return a ? validAt(a, new Date(atMs)) : d.valid !== false
    },
    [assertions, atMs],
  )

  // What is drawn: the chosen kinds; when messages are hidden, their edges are moved onto their conversation.
  const { fNodes, fLinks } = useMemo(
    () =>
      knowledgeModel(
        nodes,
        edges,
        (d) => !!d && kinds.has(d.kind as KgKind) && (showOutdated || inForce(d)),
        kinds.has('Message'),
        selectedId,
        correlations,
        focusPattern,
      ),
    [nodes, edges, kinds, showOutdated, selectedId, inForce, correlations, focusPattern],
  )

  const matches = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (!ql) return []
    return [...nodes.values()]
      .filter((d) => kinds.has(d.kind as KgKind) && (showOutdated || inForce(d)) && `${d.id} ${title(d)}`.toLowerCase().includes(ql))
      .map((d) => d.id)
  }, [q, nodes, kinds, showOutdated, inForce])

  const toggleKind = (k: KgKind) =>
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  // Selecting a node of a hidden kind (from the connections list) shows that kind.
  const selectNode = (id: string | null) => {
    const k = id ? (nodes.get(id)?.kind as KgKind | undefined) : undefined
    if (k && !kinds.has(k)) setKinds((prev) => new Set(prev).add(k))
    select(id)
  }

  const threadAssertion = useMemo(() => threadAssertionIndex(assertions), [assertions])
  // A marker sets the time it happened; a closed rule is selected one second before it closed so it is still in force.
  const onTimelineSelect = (e: TimelineEvent) => {
    if (e.kind === 'closed' && e.assertionId) {
      const a = assertions[e.assertionId]
      const to = a?.valid_to ? new Date(a.valid_to).getTime() : e.at
      setT(new Date(to - 1000))
      setShowOutdated(true)
      selectNode(e.assertionId)
      return
    }
    const id =
      e.kind === 'conversation'
        ? (e.threadId && nodes.has(e.threadId) ? e.threadId : e.threadId ? threadAssertion.get(e.threadId) : undefined)
        : (e.assertionId ?? e.entityId)
    if (id) selectNode(id)
  }

  const emphasis = useMemo<Emphasis | null>(() => {
    if (!focusPattern) return null
    const tone: Emphasis['nodes'] = {}
    for (const o of focusPattern.occurrences) tone[o.assertion_id] = 'warn'
    for (const s of focusPattern.suspects) tone[s] = 'warn'
    const ids = focusPattern.occurrences.map((o) => o.assertion_id)
    const links: string[] = []
    for (let i = 0; i < ids.length - 1; i++) if (ids[i] !== ids[i + 1]) links.push(`pattern:${ids[i]}|${ids[i + 1]}`)
    return { nodes: tone, links, linkTone: 'warn' }
  }, [focusPattern])

  const min = useMemo(() => Math.min(...Object.values(assertions).map((a) => new Date(a.valid_from).getTime()), now.getTime() - 30 * 24 * HOUR), [assertions, now])
  const max = addDays(now, 30).getTime()

  const selected = selectedId ? nodes.get(selectedId) : undefined

  const metaCounts = useMemo(() => {
    const c: Partial<Record<KgKind, number>> = {}
    for (const d of nodes.values()) {
      const k = d.kind as KgKind
      if (!kinds.has(k) || (!showOutdated && !inForce(d))) continue
      c[k] = (c[k] ?? 0) + 1
    }
    return c
  }, [nodes, kinds, showOutdated, inForce])

  const browseNodes = [...nodes.values()].filter(
    (d) => kinds.has(d.kind as KgKind) && (showOutdated || inForce(d)) && (!q || `${title(d)} ${d.id}`.toLowerCase().includes(q.toLowerCase())),
  )
  const browseGroups = groupBrowseNodes(browseNodes)
  return (
    <>
      <GraphWorkspace
        title="Knowledge graph"
        description="What we know, and what it touches."
        variant="compact"
        meta={`${metaCounts.Assertion ?? 0} knowledge · ${metaCounts.Person ?? 0} people · ${metaCounts.Element ?? 0} equipment`}
        actions={
          <>
            <CorrelationsChip patterns={patterns} onOpen={() => setDrawer(true)} />
            <TimeChip at={at} now={now} follow={t === null} onReset={() => setT(null)} />
          </>
        }
        selected={!!selected}
        onClear={() => select(null)}
        toolbar={
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Search size={17} className="shrink-0 text-muted" />
              <Input
                className="min-w-0"
                placeholder="Search knowledge, people, equipment"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && matches[0] && selectNode(matches[0])}
                aria-label="Search graph items"
              />
            </div>
            <Button icon={<SlidersHorizontal size={15} />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
              Filters
            </Button>
            {!publicDemo && <ExportMenu />}
            {filtersOpen && (
              <div className="w-full space-y-3 border-t border-line pt-3">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Show item types">
                  {(publicDemo && !moreTypes ? PUBLIC_KINDS : KIND_ORDER).map((k) => (
                    <button
                      key={k}
                      aria-pressed={kinds.has(k)}
                      onClick={() => toggleKind(k)}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-xs',
                        kinds.has(k) ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line text-muted',
                      )}
                    >
                      {KIND[k].plural} · {counts[k] ?? 0}
                    </button>
                  ))}
                  {publicDemo && !moreTypes && (
                    <button type="button" className="rounded-lg border border-line px-3 py-2 text-xs text-muted" onClick={() => setMoreTypes(true)}>
                      More types
                    </button>
                  )}
                </div>
                <Toggle checked={showOutdated} onChange={setShowOutdated} label="Show knowledge not in force" />
              </div>
            )}
          </>
        }
        timeline={
          <SimTimeline
            events={events}
            at={at}
            now={now}
            follow={t === null}
            onChange={setT}
            onReset={() => setT(null)}
            onSelect={onTimelineSelect}
            selectedId={selectedId}
            bounds={{ min, max }}
            company={company}
          />
        }
        legend={
          <GraphKey
            moreAfter={4}
            items={[
              ...KIND_ORDER.filter((k) => kinds.has(k)).map((k) => ({
                label: KIND[k].plural,
                swatch: <ShapeSwatch color={KIND[k].color} shape={KG_SHAPE[k].shape} />,
              })),
              { label: 'Correlation', swatch: <ShapeSwatch color="var(--warn)" shape="circle" dashed /> },
            ]}
          />
        }
        canvas={
          <>
            {error && !data ? (
              <EmptyState
                icon={<Waypoints size={28} />}
                title="The knowledge map is unavailable"
                hint="Check the dashboard connection, then try again."
                action={<Button onClick={() => setRetry(retry + 1)}>Try again</Button>}
              />
            ) : !data ? (
              <GraphLoading label="Connecting the knowledge…" />
            ) : fNodes.length === 0 ? (
              <EmptyState
                icon={<Waypoints size={28} />}
                title={nodes.size ? 'No connections match these filters' : 'Your knowledge map starts with a conversation'}
                hint={
                  nodes.size
                    ? 'Try including more item types or outdated knowledge.'
                    : 'Run a scenario or add a conversation to start capturing knowledge.'
                }
              />
            ) : (
              <ForceCanvas
                mode="knowledge"
                nodes={fNodes}
                links={fLinks}
                selectedId={selectedId}
                matchIds={matches}
                emphasis={emphasis}
                onSelect={selectNode}
                ariaLabel="Knowledge connections. Use Browse to select items with the keyboard."
              />
            )}
          </>
        }
        browse={
          <div className="p-4">
            <h3 className="font-semibold">Browse the map</h3>
            <p className="mt-1 text-xs text-muted">Knowledge first, then the objects it touches.</p>
            <Input className="mt-3" aria-label="Search the item list" placeholder="Search knowledge, people, equipment" value={q} onChange={(e) => setQ(e.target.value)} />
            <p className="mb-2 mt-3 text-xs text-muted">
              {browseNodes.length} items{q && ' matching your search'}
            </p>
            {browseGroups.map((group) => (
              <section key={group.kind} className="mt-4" aria-label={KIND[group.kind].plural}>
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {KIND[group.kind].plural} <span className="font-normal">({group.items.length})</span>
                </h4>
                <div className="divide-y divide-line">
                  {group.items.map((d) => (
                    <button key={d.id} onClick={() => selectNode(d.id)} className="min-h-11 w-full rounded-md py-3 text-left hover:bg-surface-2">
                      <span className="block break-words text-sm leading-relaxed">{title(d)}</span>
                      {title(d) !== d.id && <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">{d.id}</span>}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {!browseNodes.length && (
              <p className="py-6 text-sm text-muted">No items match these filters.</p>
            )}
          </div>
        }
        details={
          selected ? (
            <KgDetails
              node={selected}
              nodes={nodes}
              edges={edges}
              onSelect={selectNode}
              at={at}
              compact={publicDemo}
              patterns={patterns}
              onOpenPattern={(p) => {
                setFocusPattern(p)
                setDrawer(true)
              }}
            />
          ) : null
        }
      />
      <PatternDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        patterns={patterns}
        threads={threads}
        selectedId={focusPattern?.id}
        onFocus={setFocusPattern}
        publicDemo={publicDemo}
      />
    </>
  )
}
