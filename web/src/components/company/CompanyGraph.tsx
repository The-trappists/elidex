import { Waypoints } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { demoKnowledgeGraph, isDemo } from '../../api/fixtures/company'
import type { KgElement, KgKind } from '../../api/types'
import { cn } from '../../lib/cn'
import { useLive } from '../../store/live'
import { ForceCanvas, GraphLoading, type ForceNode } from '../force/ForceCanvas'
import { knowledgeModel } from '../force/models'
import { useGraphQuery } from '../graph/useGraphQuery'
import { title } from '../kg/kgStyle'
import { Badge, EmptyState, Toggle } from '../ui'

type Data = KgElement['data']
const KINDS = new Set<KgKind>(['Assertion', 'Person', 'Element', 'Class', 'Event', 'Thread'])
const FRESH_MS = 7000

const fetchGraph = () => (isDemo() ? Promise.resolve(demoKnowledgeGraph(useLive)) : api.knowledgeGraph())

export function CompanyGraph({ since, onlyNew, onOnlyNew }: { since: Set<string>; onlyNew: boolean; onOnlyNew: (v: boolean) => void }) {
  const { data, error } = useGraphQuery(fetchGraph, 'company-kg', 1200, 4000)
  const [selected, setSelected] = useState<string | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const known = useRef<Set<string> | null>(null)
  const timers = useRef<number[]>([])
  const hasKnowledge = useLive((s) => Object.keys(s.assertions).length > 0)

  // Same nodes and links as the last answer: keep the old objects so the layout is not touched.
  const last = useRef<{ sig: string; value: { nodes: Map<string, Data>; edges: Data[] } } | null>(null)
  const { nodes, edges } = useMemo(() => {
    const sig = (data?.elements ?? []).map((el) => `${el.data.id}${el.data.valid === false ? '!' : ''}`).join('|')
    if (last.current?.sig === sig) return last.current.value
    const nodes = new Map<string, Data>()
    const edges: Data[] = []
    for (const el of data?.elements ?? []) {
      if (el.group === 'nodes') nodes.set(el.data.id, el.data)
      else edges.push(el.data)
    }
    last.current = { sig, value: { nodes, edges } }
    return last.current.value
  }, [data])

  // New knowledge nodes glow for a few seconds. The first load is not "new".
  useEffect(() => {
    if (!data) return
    const seen = known.current
    const now = new Set<string>()
    for (const d of nodes.values()) if (d.kind === 'Assertion') now.add(d.id)
    known.current = now
    if (!seen) return
    const added = [...now].filter((id) => !seen.has(id))
    if (!added.length) return
    setFresh((f) => new Set([...f, ...added]))
    // Not cleared when the effect re-runs, or a refresh within 7 s would leave these glowing forever.
    timers.current.push(window.setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !added.includes(id)))), FRESH_MS))
  }, [data, nodes])
  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])

  const model = useMemo(
    () => knowledgeModel(nodes, edges, (d) => !!d && KINDS.has(d.kind as KgKind) && (d.kind !== 'Assertion' || (d.valid !== false && (!onlyNew || since.has(d.id)))), false, selected),
    [nodes, edges, onlyNew, since, selected],
  )
  const fNodes: ForceNode[] = useMemo(() => model.fNodes.map((n) => (fresh.has(n.id) ? { ...n, fresh: true } : n)), [model.fNodes, fresh])
  const sel = selected ? nodes.get(selected) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 bg-bg">
        {error && !data ? (
          <EmptyState icon={<Waypoints size={24} />} title="The knowledge map is unavailable" hint="Check the workbench connection." />
        ) : !data && hasKnowledge ? (
          <GraphLoading label="Connecting the knowledge…" />
        ) : fNodes.length === 0 ? (
          <EmptyState
            icon={<Waypoints size={24} />}
            title={onlyNew ? 'Nothing new since the last sync' : 'The graph is empty'}
            hint={onlyNew ? 'Turn the filter off to see all knowledge.' : 'It grows as conversations are turned into knowledge.'}
          />
        ) : (
          <ForceCanvas mode="knowledge" nodes={fNodes} links={model.fLinks} selectedId={selected} onSelect={setSelected} ariaLabel="Knowledge graph that grows during the company day" />
        )}
      </div>
      <div className={cn('flex min-h-9 shrink-0 items-center gap-3 border-t border-line px-3 py-1.5 text-xs')}>
        <Toggle checked={onlyNew} onChange={onOnlyNew} label={<span className="text-xs">Only since last sync</span>} />
        {sel ? (
          <span className="ml-auto flex min-w-0 items-center gap-2">
            <span className="truncate text-muted">{title(sel)}</span>
            <Link to={`/graph?node=${encodeURIComponent(sel.id)}`} className="shrink-0 text-accent hover:underline">Open in graph</Link>
          </span>
        ) : (
          <Badge className="ml-auto bg-surface-2 text-muted">{fresh.size ? `${fresh.size} just added` : `${model.fNodes.length} items`}</Badge>
        )}
      </div>
    </div>
  )
}
