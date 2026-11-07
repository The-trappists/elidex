import { useMemo, useState } from 'react'
import type cytoscape from 'cytoscape'
import { api } from '../../api/client'
import type { KgElement, KgKind } from '../../api/types'
import { useGraphQuery } from '../graph/useGraphQuery'
import { KgCanvas } from '../kg/KgCanvas'
import { EDGE_LABEL, KIND, title } from '../kg/kgStyle'
import { KgDetails } from '../kg/KgDetails'
import { Drawer } from '../ui'

const DEFAULT_KINDS: KgKind[] = ['Assertion', 'Person', 'Element', 'Class', 'Event', 'Thread']
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
type Data = KgElement['data']

/** Same graph data and default node visibility as the Graph page, embedded in Agent tester. */
export function AgentGraph({ targetId, evidenceIds }: { targetId: string; evidenceIds: string[] }) {
  const { data, error } = useGraphQuery(() => api.knowledgeGraph(), 'kg-agent-tester')
  const [selected, setSelected] = useState<string | null>(null)

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
          short: kind === 'Message' ? '' : short(title(d), 54),
          expired: kind === 'Assertion' && d.valid === false,
        },
      })
    }
    return [...out, ...edgeDefs]
  }, [data])

  if (error && !data) return <div className="p-4 text-[13px] text-bad">Could not load graph: {error}</div>
  if (!data) return <div className="p-4 text-[13px] text-muted">Loading graph…</div>

  const nodes = new Map((data.elements ?? []).filter((e) => e.group === 'nodes').map((e) => [e.data.id, e.data]))
  const edges = (data.elements ?? []).filter((e) => e.group === 'edges').map((e) => e.data)
  const node = selected ? nodes.get(selected) : undefined

  return (
    <div className="relative h-[min(65vh,40rem)] min-h-[20rem] overflow-hidden rounded-lg border border-line bg-bg">
      <KgCanvas
        defs={defs}
        selectedId={selected}
        matchIds={[]}
        targetHighlightId={targetId}
        evidenceIds={evidenceIds}
        onSelect={setSelected}
      />
      <Drawer open={!!node} onClose={() => setSelected(null)} title="Why this context matters">
        {node && <KgDetails node={node} nodes={nodes} edges={edges} onSelect={setSelected} />}
      </Drawer>
    </div>
  )
}
