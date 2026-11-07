import type cytoscape from 'cytoscape'
import { Maximize2, Search, Waypoints, SlidersHorizontal, Plus, Minus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { KgElement, KgKind } from '../api/types'
import { useGraphQuery } from '../components/graph/useGraphQuery'
import { KgCanvas, type KgCanvasHandle } from '../components/kg/KgCanvas'
import { KgDetails } from '../components/kg/KgDetails'
import { EDGE_LABEL, KIND, KIND_ORDER, title } from '../components/kg/kgStyle'
import { Button, EmptyState, Input, Toggle } from '../components/ui'
import { GraphWorkspace } from '../components/graph/GraphWorkspace'
import { cn } from '../lib/cn'

type Data = KgElement['data']

const DEFAULT_KINDS: KgKind[] = ['Assertion', 'Person', 'Element', 'Class', 'Event', 'Thread']
const short = (s: string, n = 26) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export default function GraphPage() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('node')
  const select = (id: string | null) => setParams(id ? { node: id } : {}, { replace: true })
  const [kinds, setKinds] = useState<Set<KgKind>>(new Set(DEFAULT_KINDS))
  const [showOutdated, setShowOutdated] = useState(false)
  const [q, setQ] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const canvas = useRef<KgCanvasHandle | null>(null)

  const { data, error } = useGraphQuery(() => api.knowledgeGraph(), `kg-${retry}`)

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

  // What is drawn: the chosen kinds; when messages are hidden, their edges are moved onto their conversation.
  const { defs, hidden } = useMemo(() => {
    const visible = (d: Data | undefined) =>
      !!d && kinds.has(d.kind as KgKind) && (showOutdated || d.kind !== 'Assertion' || d.valid !== false)
    const threadOf = new Map(edges.filter((e) => e.type === 'PART_OF').map((e) => [String(e.source), String(e.target)]))
    const out: cytoscape.ElementDefinition[] = []
    const linked = new Set<string>()
    const edgeDefs: cytoscape.ElementDefinition[] = []
    const seen = new Set<string>()
    for (const e of edges) {
      let s = String(e.source)
      let t = String(e.target)
      if (!kinds.has('Message')) {
        if (e.type === 'PART_OF') continue
        if (nodes.get(s)?.kind === 'Message') s = threadOf.get(s) ?? s
        if (nodes.get(t)?.kind === 'Message') t = threadOf.get(t) ?? t
      }
      if (s === t || !visible(nodes.get(s)) || !visible(nodes.get(t))) continue
      const id = `${s}|${e.type}|${t}`
      if (seen.has(id)) continue
      seen.add(id)
      edgeDefs.push({ group: 'edges', data: { id, source: s, target: t, type: e.type, name: EDGE_LABEL[String(e.type)] ?? e.type } })
      linked.add(s).add(t)
    }
    // A node with no visible connection is noise (e.g. equipment once sites are hidden); keep it only when selected.
    let hidden = 0
    for (const d of nodes.values()) {
      if (!visible(d)) continue
      if (!linked.has(d.id) && d.id !== selectedId) {
        hidden++
        continue
      }
      out.push({
        group: 'nodes',
        data: {
          id: d.id,
          kind: d.kind,
          color: KIND[d.kind as KgKind]?.color ?? '#999',
          short: d.kind === 'Message' ? '' : short(title(d), 54),
          expired: d.kind === 'Assertion' && d.valid === false,
        },
      })
    }
    return { defs: [...out, ...edgeDefs], hidden }
  }, [nodes, edges, kinds, showOutdated, selectedId])

  const matches = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (!ql) return []
    return [...nodes.values()]
      .filter((d) => kinds.has(d.kind as KgKind) && (showOutdated || d.kind !== 'Assertion' || d.valid !== false) && `${d.id} ${title(d)}`.toLowerCase().includes(ql))
      .map((d) => d.id)
  }, [q, nodes, kinds, showOutdated])

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

  const selected = selectedId ? nodes.get(selectedId) : undefined

  const browseNodes = [...nodes.values()].filter(
    (d) =>
      kinds.has(d.kind as KgKind) &&
      (showOutdated || d.kind !== 'Assertion' || d.valid !== false) &&
      (!q || `${title(d)} ${d.id}`.toLowerCase().includes(q.toLowerCase())),
  )
  return (
    <GraphWorkspace
      title="Follow the knowledge"
      description="See where a piece of knowledge came from, who shared it, and where it applies."
      selected={!!selected}
      onClear={() => select(null)}
      toolbar={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Search size={17} className="shrink-0 text-muted" />
            <Input
              className="min-w-0"
              placeholder="Search knowledge, people or equipment"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && matches[0] && selectNode(matches[0])}
              aria-label="Search graph items"
            />
          </div>
          <Button icon={<SlidersHorizontal size={15} />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
            Filters
          </Button>
          {filtersOpen && (
            <div className="w-full space-y-3 border-t border-line pt-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Show item types">
                {KIND_ORDER.map((k) => (
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
              </div>
              <Toggle checked={showOutdated} onChange={setShowOutdated} label="Include knowledge that no longer applies" />
            </div>
          )}
        </>
      }
      canvas={
        <>
          {error && !data ? (
            <EmptyState
              icon={<Waypoints size={28} />}
              title="The knowledge map is unavailable"
              hint="Check the workbench connection, then try again."
              action={<Button onClick={() => setRetry(retry + 1)}>Try again</Button>}
            />
          ) : !data ? (
            <div role="status" className="flex h-full items-center justify-center text-sm text-muted">
              Connecting the knowledge…
            </div>
          ) : defs.length === 0 ? (
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
            <KgCanvas defs={defs} selectedId={selectedId} matchIds={matches} onSelect={selectNode} handle={canvas} />
          )}
          <div className="graph-zoom" role="group" aria-label="Graph zoom">
            <Button aria-label="Zoom in" icon={<Plus size={16} />} onClick={() => canvas.current?.zoom(1.3)} />
            <Button aria-label="Zoom out" icon={<Minus size={16} />} onClick={() => canvas.current?.zoom(1 / 1.3)} />
            <Button icon={<Maximize2 size={15} />} onClick={() => canvas.current?.fit()}>
              Fit
            </Button>
          </div>
          {hidden > 0 && <span className="graph-caption">{hidden} items without visible connections · available in Browse</span>}
        </>
      }
      browse={
        <div className="p-4">
          <h3 className="font-semibold">Browse connections</h3>
          <Input className="mt-3" aria-label="Search the item list" placeholder="Search knowledge, people or equipment" value={q} onChange={(e) => setQ(e.target.value)} />
          <p className="mb-4 mt-1 text-xs leading-relaxed text-muted">Choose an item to read its context and follow related knowledge.</p>
          <p className="mb-2 text-xs text-muted">
            {browseNodes.length} items{q && ' matching your search'}
          </p>
          <div className="divide-y divide-line">
            {browseNodes.map((d) => (
              <button key={d.id} onClick={() => selectNode(d.id)} className="w-full rounded-md py-3 text-left hover:bg-surface-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">{KIND[d.kind as KgKind]?.label}</span>
                <span className="mt-1 block break-words text-sm leading-relaxed">{title(d)}</span>
              </button>
            ))}
          </div>
          {!browseNodes.length && (
            <p className="py-6 text-sm text-muted">No matching items. Try a different search or adjust the filters.</p>
          )}
        </div>
      }
      details={selected ? <KgDetails node={selected} nodes={nodes} edges={edges} onSelect={selectNode} /> : null}
    />
  )
}
