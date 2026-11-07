import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { KgElement, KgKind } from '../../api/types'
import { ForceCanvas, GraphLoading } from '../force/ForceCanvas'
import { agentEmphasis, knowledgeModel } from '../force/models'
import { useGraphQuery } from '../graph/useGraphQuery'
import { KgDetails } from '../kg/KgDetails'
import { Drawer } from '../ui'

const DEFAULT_KINDS: KgKind[] = ['Assertion', 'Person', 'Element', 'Class', 'Event', 'Thread']
type Data = KgElement['data']

/** Same graph data and default node visibility as the Graph page, embedded in Agent tester. */
/** `panelWidth`: room taken by the panel laid over the right of the graph, kept clear when framing. */
export function AgentGraph({ targetId, evidenceIds, panelWidth = 0 }: { targetId: string; evidenceIds: string[]; panelWidth?: number }) {
  const { data, error } = useGraphQuery(() => api.knowledgeGraph(), 'kg-agent-tester')
  const [selected, setSelected] = useState<string | null>(null)

  const { nodes, edges } = useMemo(() => {
    const nodes = new Map<string, Data>()
    const edges: Data[] = []
    for (const el of data?.elements ?? []) {
      if (el.group === 'nodes') nodes.set(el.data.id, el.data)
      else edges.push(el.data)
    }
    return { nodes, edges }
  }, [data])

  const { fNodes, fLinks } = useMemo(
    () => knowledgeModel(nodes, edges, (d) => !!d && DEFAULT_KINDS.includes(d.kind as KgKind), false, targetId),
    [nodes, edges, targetId],
  )
  const evidenceKey = evidenceIds.join('|')
  const emphasis = useMemo(
    () => agentEmphasis(fLinks, targetId, evidenceKey ? evidenceKey.split('|') : []),
    [fLinks, targetId, evidenceKey],
  )

  if (error && !data) return <div className="p-4 text-[13px] text-bad">Could not load graph: {error}</div>
  const node = selected ? nodes.get(selected) : undefined

  return (
    <div className="relative h-full min-h-[16rem] overflow-hidden rounded-lg border border-line bg-bg">
      {!data ? (
        <GraphLoading />
      ) : (
        <ForceCanvas
          mode="knowledge"
          nodes={fNodes}
          links={fLinks}
          selectedId={selected}
          emphasis={emphasis}
          insets={{ right: panelWidth }}
          onSelect={setSelected}
          ariaLabel="Knowledge graph: the entity and the knowledge the agent used are highlighted in amber."
        />
      )}
      <Drawer open={!!node} onClose={() => setSelected(null)} title="Why this context matters">
        {node && <KgDetails node={node} nodes={nodes} edges={edges} onSelect={setSelected} />}
      </Drawer>
    </div>
  )
}
