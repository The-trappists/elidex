import { useMemo, useRef } from 'react'
import type cytoscape from 'cytoscape'
import { Maximize2 } from 'lucide-react'
import { api } from '../../api/client'
import type { KgElement, KgKind } from '../../api/types'
import { useGraphQuery } from '../graph/useGraphQuery'
import { KgCanvas, type KgCanvasHandle } from '../kg/KgCanvas'
import { EDGE_LABEL, KIND, title } from '../kg/kgStyle'
import { Button } from '../ui'

const DEFAULT_KINDS: KgKind[] = ['Assertion', 'Person', 'Element', 'Class', 'Event', 'Thread']
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
type Data = KgElement['data']

/** Same graph data and default node visibility as the Graph page, embedded in Agent tester. */
export function AgentGraph({ targetId, evidenceIds }: { targetId: string; evidenceIds: string[] }) {
  const { data, error } = useGraphQuery(() => api.knowledgeGraph(), 'kg-agent-tester')
  const canvas = useRef<KgCanvasHandle | null>(null)

  const defs = useMemo(() => {
    const nodes = new Map<string, Data>()
    const edges: Data[] = []
    for (const el of data?.elements ?? []) {
      if (el.group === 'nodes') nodes.set(el.data.id, el.data)
      else edges.push(el.data)
    }

    const visible = (d: Data | undefined) => !!d && DEFAULT_KINDS.includes(d.kind as KgKind)
    const threadOf = new Map(edges.filter((e) => e.type === 'PART_OF').map((e) => [String(e.source), String(e.target)]))
    const out: cytoscape.ElementDefinition[] = []
    const linked = new Set<string>()
    const edgeDefs: cytoscape.ElementDefinition[] = []
    const seen = new Set<string>()

    for (const e of edges) {
      let source = String(e.source)
      let target = String(e.target)
      if (nodes.get(source)?.kind === 'Message') source = threadOf.get(source) ?? source
      if (nodes.get(target)?.kind === 'Message') target = threadOf.get(target) ?? target
      if (source === target || !visible(nodes.get(source)) || !visible(nodes.get(target))) continue
      const id = `${source}|${e.type}|${target}`
      if (seen.has(id)) continue
      seen.add(id)
      edgeDefs.push({ group: 'edges', data: { id, source, target, type: e.type, name: EDGE_LABEL[String(e.type)] ?? String(e.type) } })
      linked.add(source).add(target)
    }

    for (const d of nodes.values()) {
      if (!visible(d) || !linked.has(d.id)) continue
      const kind = d.kind as KgKind
      out.push({
        group: 'nodes',
        data: {
          id: d.id,
          kind,
          color: KIND[kind]?.color ?? '#999',
          short: kind === 'Message' ? '' : short(title(d)),
          expired: kind === 'Assertion' && d.valid === false,
        },
      })
    }
    return [...out, ...edgeDefs]
  }, [data])

  if (error && !data) return <div className="p-4 text-xs text-bad">Could not load graph: {error}</div>
  if (!data) return <div className="p-4 text-xs text-muted">Loading graph…</div>

  return (
    <div className="relative h-[32rem] overflow-hidden rounded-lg border border-line bg-bg">
      <KgCanvas defs={defs} selectedId={null} matchIds={[]} targetHighlightId={targetId} evidenceIds={evidenceIds} onSelect={() => {}} handle={canvas} />
      <Button size="sm" variant="ghost" icon={<Maximize2 size={13} />} className="absolute right-2 top-2 bg-surface/90" onClick={() => canvas.current?.fit()}>
        Fit
      </Button>
    </div>
  )
}
