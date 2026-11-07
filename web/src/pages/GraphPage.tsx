import type cytoscape from 'cytoscape'
import { Maximize2, Search, Waypoints } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { KgElement, KgKind } from '../api/types'
import { useGraphQuery } from '../components/graph/useGraphQuery'
import { KgCanvas, type KgCanvasHandle } from '../components/kg/KgCanvas'
import { KgDetails, KgOverview } from '../components/kg/KgDetails'
import { EDGE_LABEL, KIND, KIND_ORDER, title } from '../components/kg/kgStyle'
import { Button, Chip, EmptyState, Input, LoadingState, Toggle, Toolbar } from '../components/ui'

type Data = KgElement['data']

const DEFAULT_KINDS: KgKind[] = ['Assertion', 'Person', 'Element', 'Class', 'Event', 'Thread']
// With a company-sized dataset (hundreds of conversations) people and threads bury the knowledge: start on what the rules reach.
const LARGE_GRAPH = 400
const LARGE_KINDS: KgKind[] = ['Assertion', 'Element', 'Class', 'Event']
const short = (s: string, n = 26) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export default function GraphPage() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('node')
  const select = (id: string | null) => setParams(id ? { node: id } : {}, { replace: true })
  const [kinds, setKinds] = useState<Set<KgKind>>(new Set(DEFAULT_KINDS))
  const [showOutdated, setShowOutdated] = useState(true)
  const [q, setQ] = useState('')
  const canvas = useRef<KgCanvasHandle | null>(null)

  const { data, error } = useGraphQuery(() => api.knowledgeGraph(), 'kg')
  const sizedFor = useRef(false)
  useEffect(() => {
    if (!data || sizedFor.current) return
    sizedFor.current = true
    if (data.elements.filter((e) => e.group === 'nodes').length > LARGE_GRAPH) setKinds(new Set(LARGE_KINDS))
  }, [data])

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
    const visible = (d: Data | undefined) => !!d && kinds.has(d.kind as KgKind) && (showOutdated || d.kind !== 'Assertion' || d.valid !== false)
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
        data: { id: d.id, kind: d.kind, color: KIND[d.kind as KgKind]?.color ?? '#999', short: d.kind === 'Message' ? '' : short(title(d)), expired: d.kind === 'Assertion' && d.valid === false },
      })
    }
    return { defs: [...out, ...edgeDefs], hidden }
  }, [nodes, edges, kinds, showOutdated, selectedId])

  const matches = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (!ql) return []
    return [...nodes.values()].filter((d) => kinds.has(d.kind as KgKind) && `${d.id} ${title(d)}`.toLowerCase().includes(ql)).map((d) => d.id)
  }, [q, nodes, kinds])

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

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <Toolbar className="gap-x-4">
          <div className="relative w-56">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <Input
              className="pl-8"
              placeholder="Find a node"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && matches[0] && selectNode(matches[0])}
              aria-label="Find a node"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Node types shown">
            {KIND_ORDER.map((k) => {
              return (
                <Chip key={k} selected={kinds.has(k)} onClick={() => toggleKind(k)} dot={KIND[k].color} count={counts[k] ?? 0} title={KIND[k].help}>
                  {KIND[k].plural}
                </Chip>
              )
            })}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Toggle checked={showOutdated} onChange={setShowOutdated} label={<span className="text-xs text-muted">Outdated knowledge</span>} />
            <Button size="sm" variant="ghost" icon={<Maximize2 size={13} />} onClick={() => canvas.current?.fit()}>
              Fit
            </Button>
          </div>
        </Toolbar>
        <div className="relative min-h-0 flex-1 bg-bg">
          {error && !data ? (
            <EmptyState icon={<Waypoints size={28} />} title="Could not load the graph" hint={error} />
          ) : !data ? (
            <LoadingState label="Building the knowledge graph…" />
          ) : nodes.size === 0 ? (
            <EmptyState icon={<Waypoints size={28} />} title="The graph is empty" hint="It fills in as conversations are read and knowledge is linked to equipment. Run a scenario from the top bar." />
          ) : (
            <KgCanvas defs={defs} selectedId={selectedId} matchIds={matches} onSelect={selectNode} handle={canvas} />
          )}
          {hidden > 0 && !q && <div className="pointer-events-none absolute bottom-3 left-3 text-xs text-muted">{hidden} unconnected {hidden === 1 ? 'node' : 'nodes'} hidden</div>}
          {q && <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted">{matches.length ? `${matches.length} found · Enter to select the first` : 'No match'}</div>}
        </div>
      </section>
      <aside className="w-80 shrink-0 overflow-auto border-l border-line bg-surface 2xl:w-96">
        {selected ? <KgDetails node={selected} nodes={nodes} edges={edges} onSelect={selectNode} /> : <KgOverview counts={counts} />}
      </aside>
    </div>
  )
}
