import type cytoscape from 'cytoscape'
import { Maximize2, Search, Waypoints } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { KgElement, KgKind } from '../api/types'
import { useGraphQuery } from '../components/graph/useGraphQuery'
import { KgCanvas, type KgCanvasHandle } from '../components/kg/KgCanvas'
import { KgDetails, KgOverview } from '../components/kg/KgDetails'
import { EDGE_LABEL, KIND, KIND_ORDER, title } from '../components/kg/kgStyle'
import { Button, EmptyState, Input, Toggle } from '../components/ui'
import { cn } from '../lib/cn'

type Data = KgElement['data']

const DEFAULT_KINDS: KgKind[] = ['Assertion', 'Person', 'Element', 'Class', 'Event', 'Thread']
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
  const defs = useMemo(() => {
    const visible = (d: Data | undefined) => !!d && kinds.has(d.kind as KgKind) && (showOutdated || d.kind !== 'Assertion' || d.valid !== false)
    const threadOf = new Map(edges.filter((e) => e.type === 'PART_OF').map((e) => [String(e.source), String(e.target)]))
    const out: cytoscape.ElementDefinition[] = []
    for (const d of nodes.values()) {
      if (!visible(d)) continue
      out.push({
        group: 'nodes',
        data: { id: d.id, kind: d.kind, color: KIND[d.kind as KgKind]?.color ?? '#999', short: d.kind === 'Message' ? '' : short(title(d)), expired: d.kind === 'Assertion' && d.valid === false },
      })
    }
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
      out.push({ group: 'edges', data: { id, source: s, target: t, type: e.type, name: EDGE_LABEL[String(e.type)] ?? e.type } })
    }
    return out
  }, [nodes, edges, kinds, showOutdated])

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
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
          <div className="relative w-56">
            <Search size={14} className="absolute left-2.5 top-2 text-muted" />
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
              const on = kinds.has(k)
              return (
                <button
                  key={k}
                  onClick={() => toggleKind(k)}
                  aria-pressed={on}
                  title={KIND[k].help}
                  className={cn('flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors', on ? 'border-line bg-surface text-text' : 'border-transparent text-muted/70 hover:text-text')}
                >
                  <span className={cn('size-2 rounded-full', !on && 'opacity-40')} style={{ background: KIND[k].color }} />
                  {KIND[k].plural}
                  <span className="tabular-nums text-muted">{counts[k] ?? 0}</span>
                </button>
              )
            })}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Toggle checked={showOutdated} onChange={setShowOutdated} label={<span className="text-xs text-muted">Outdated knowledge</span>} />
            <Button size="sm" variant="ghost" icon={<Maximize2 size={13} />} onClick={() => canvas.current?.fit()}>
              Fit
            </Button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-bg">
          {error && !data ? (
            <EmptyState icon={<Waypoints size={28} />} title="Could not load the graph" hint={error} />
          ) : (
            <KgCanvas defs={defs} selectedId={selectedId} matchIds={matches} onSelect={selectNode} handle={canvas} />
          )}
          {q && <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted">{matches.length ? `${matches.length} found · Enter to select the first` : 'No match'}</div>}
        </div>
      </section>
      <aside className="w-80 shrink-0 overflow-auto border-l border-line bg-surface 2xl:w-96">
        {selected ? <KgDetails node={selected} nodes={nodes} edges={edges} onSelect={selectNode} /> : <KgOverview counts={counts} />}
      </aside>
    </div>
  )
}
