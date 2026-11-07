// Cytoscape canvas for the knowledge graph. Elements are diffed in place; the layout re-runs only
// when the set of visible nodes changes, from hash-seeded positions so it looks the same on each visit.
import cytoscape from 'cytoscape'
import { useEffect, useMemo, useRef, useState } from 'react'
import { exploreGraph } from '../graph/exploreGraph'
import { fitReadable } from '../graph/viewport'
import { Button } from '../ui'
import { knowledgeLayout } from './knowledgeLayout'
import { KIND } from './kgStyle'
import type { KgKind } from '../../api/types'
import { kgStyle } from './kgStyle'


const hash = (s: string) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

export interface KgCanvasHandle {
  fit: () => void
  zoom: (factor: number) => void
}

export function KgCanvas({
  defs: allDefs,
  selectedId,
  matchIds,
  targetHighlightId,
  evidenceIds = [],
  onSelect,
  handle,
}: {
  defs: cytoscape.ElementDefinition[]
  selectedId: string | null
  matchIds: string[]
  targetHighlightId?: string | null
  evidenceIds?: string[]
  onSelect: (id: string | null) => void
  handle?: React.MutableRefObject<KgCanvasHandle | null>
}) {
  const host = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const userMoved = useRef(false)
  const [narrow, setNarrow] = useState(false)
  const [page, setPage] = useState({ scope: '', extra: 0 })
  const [depth, setDepth] = useState(1)
  const [layoutError, setLayoutError] = useState(false)
  const focus = selectedId ?? targetHighlightId ?? null
  const scope = focus ?? 'overview'
  const limit = (narrow ? 12 : 30) + (page.scope === scope ? page.extra : 0)
  const projection = useMemo(() => exploreGraph(allDefs, focus, limit, targetHighlightId ? Math.max(depth, 2) : depth, evidenceIds), [allDefs, focus, limit, depth, targetHighlightId, evidenceIds])
  const defs = projection.defs
  const structure = JSON.stringify(defs.map((d) => [d.data.id, d.data.source, d.data.target]))
  const evidenceKey = evidenceIds.join('|')
  const selectionRef = useRef(focus)
  selectionRef.current = focus
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!host.current) return
    const cy = cytoscape({ container: host.current, style: kgStyle(), minZoom: 0.15, maxZoom: 3 })
    cyRef.current = cy
    cy.on('tap', 'node', (ev) => onSelectRef.current(ev.target.id()))
    cy.on('tap', (ev) => ev.target === cy && onSelectRef.current(null))
    cy.on('mouseover', 'node', () => cy.container()?.style.setProperty('cursor', 'pointer'))
    cy.on('mouseout', 'node', () => cy.container()?.style.removeProperty('cursor'))
    const mo = new MutationObserver(() => cy.style(kgStyle()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const markMoved = () => {
      userMoved.current = true
    }
    const el = host.current
    el.addEventListener('wheel', markMoved, { passive: true })
    cy.on('dragpan pinchzoom grab', markMoved)
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        cy.resize()
        if (el.clientWidth > 0 && el.clientHeight > 0) {
          setNarrow(el.clientWidth < 600)
          if (!userMoved.current) fitReadable(cy, selectionRef.current)
        }
      })
    })
    ro.observe(host.current)
    if (handle)
      handle.current = {
        fit: () => {
          userMoved.current = false
          fitReadable(cy, selectionRef.current)
        },
        zoom: (factor) => {
          userMoved.current = true
          cy.zoom({
            level: Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor)),
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
          })
        },
      }
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('wheel', markMoved)
      if (handle) handle.current = null
      mo.disconnect()
      ro.disconnect()
      cy.destroy()
      cyRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // diff elements in
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const evidence = new Set(evidenceKey ? evidenceKey.split('|') : []) // from the stable key: the default [] is a new array each render
    const agentMode = !!targetHighlightId || evidence.size > 0
    const usedNodes = new Set<string>([...evidence, ...(targetHighlightId ? [targetHighlightId] : [])])
    const usedEdges = new Set<string>()
    const scopeEdges = new Map<string, string>()
    for (const d of defs) {
      if (d.group !== 'edges') continue
      const source = String(d.data.source)
      const target = String(d.data.target)
      const edgeId = String(d.data.id)
      const type = String(d.data.type)
      if ((type === 'MEMBER_OF' || type === 'LOCATED_AT') && (source === targetHighlightId || target === targetHighlightId)) {
        const scope = source === targetHighlightId ? target : source
        scopeEdges.set(scope, edgeId)
      }
    }
    for (const d of defs) {
      if (d.group !== 'edges') continue
      const source = String(d.data.source)
      const target = String(d.data.target)
      const edgeId = String(d.data.id)
      const type = String(d.data.type)
      for (const assertionId of evidence) {
        if (type !== 'APPLIES_TO' && type !== 'OBSERVED_ON') continue
        const scope = source === assertionId ? target : target === assertionId ? source : null
        if (!scope) continue
        if (scope === targetHighlightId) {
          usedEdges.add(edgeId)
          continue
        }
        const targetEdge = scopeEdges.get(scope)
        if (targetEdge) {
          usedEdges.add(edgeId)
          usedEdges.add(targetEdge)
          usedNodes.add(scope)
        }
      }
    }
    // Orient the animated dash flow along the shortest highlighted path from the entity
    // toward each evidence assertion, regardless of the knowledge graph's edge direction.
    const edgeById = new Map(defs.filter((d) => d.group === 'edges').map((d) => [String(d.data.id), d]))
    const adjacency = new Map<string, { node: string; edgeId: string }[]>()
    for (const edgeId of usedEdges) {
      const edge = edgeById.get(edgeId)
      if (!edge) continue
      const source = String(edge.data.source)
      const target = String(edge.data.target)
      adjacency.set(source, [...(adjacency.get(source) ?? []), { node: target, edgeId }])
      adjacency.set(target, [...(adjacency.get(target) ?? []), { node: source, edgeId }])
    }
    const distance = new Map<string, number>()
    if (targetHighlightId) {
      const queue = [targetHighlightId]
      distance.set(targetHighlightId, 0)
      for (let i = 0; i < queue.length; i += 1) {
        const node = queue[i]
        for (const next of adjacency.get(node) ?? []) {
          if (distance.has(next.node)) continue
          distance.set(next.node, (distance.get(node) ?? 0) + 1)
          queue.push(next.node)
        }
      }
    }
    const flowDirection = new Map<string, 'forward' | 'reverse'>()
    for (const edgeId of usedEdges) {
      const edge = edgeById.get(edgeId)
      if (!edge) continue
      const source = String(edge.data.source)
      const target = String(edge.data.target)
      flowDirection.set(edgeId, (distance.get(source) ?? 0) <= (distance.get(target) ?? 0) ? 'forward' : 'reverse')
    }
    const wanted = new Map(defs.map((d) => [d.data.id as string, d]))
    cy.batch(() => {
      cy.elements().forEach((e) => {
        if (!e.removed() && !wanted.has(e.id())) cy.remove(e)
      })
      const fresh = defs.filter((d) => cy.getElementById(d.data.id as string).empty())
      const nodes = fresh.filter((d) => d.group === 'nodes')
      for (const d of nodes) {
        const h = hash(d.data.id as string)
        cy.add({ ...d, position: { x: Math.cos(h) * (100 + (h % 400)), y: Math.sin(h) * (100 + (h % 400)) } })
      }
      cy.add(fresh.filter((d) => d.group === 'edges'))
      for (const d of defs) {
        const ele = cy.getElementById(d.data.id as string)
        if (!ele.empty()) {
          ele.data({ ...d.data, displayLabel: d.group === 'nodes' ? `${KIND[d.data.kind as KgKind]?.label ?? d.data.kind}\n${d.data.short || d.data.id}` : undefined })
          if (d.group === 'nodes' && targetHighlightId === d.data.id) ele.addClass('agent-target')
          else ele.removeClass('agent-target')
          if (d.group === 'nodes' && evidence.has(d.data.id as string)) ele.addClass('agent-evidence')
          else ele.removeClass('agent-evidence')
          if (d.group === 'edges' && usedEdges.has(String(d.data.id))) ele.addClass('agent-evidence-edge')
          else ele.removeClass('agent-evidence-edge')
          const direction = d.group === 'edges' ? flowDirection.get(String(d.data.id)) : undefined
          if (direction === 'forward') ele.addClass('agent-flow-forward')
          else ele.removeClass('agent-flow-forward')
          if (direction === 'reverse') ele.addClass('agent-flow-reverse')
          else ele.removeClass('agent-flow-reverse')
          const unused = d.group === 'nodes' ? !usedNodes.has(d.data.id as string) : !usedEdges.has(String(d.data.id))
          if (agentMode && unused) ele.addClass('agent-dim')
          else ele.removeClass('agent-dim')
        }
      }
    })
    const flowEdges = cy.edges('.agent-evidence-edge')
    flowEdges.stop(true)
    flowEdges.style('line-dash-offset', 0)
  }, [defs, targetHighlightId, evidenceKey])

  // A selection is an intentional navigation; routine updates preserve the viewport.
  useEffect(() => { userMoved.current = false }, [focus])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !cy.nodes().length) return
    let cancelled = false
    const task = knowledgeLayout(cy, narrow)
    task.done.then((positions) => {
      if (cancelled || cy.destroyed()) return
      const anchor = selectionRef.current ? cy.getElementById(selectionRef.current) : cy.nodes().first()
      const before = anchor.nonempty() ? { ...anchor.position() } : null
      cy.batch(() => cy.nodes().forEach((n) => { const p = positions.get(n.id()); if (p) n.position(p) }))
      if (userMoved.current && before && anchor.nonempty()) {
        const after = anchor.position(), pan = cy.pan(), z = cy.zoom()
        cy.pan({ x: pan.x + (before.x - after.x) * z, y: pan.y + (before.y - after.y) * z })
      } else fitReadable(cy, selectionRef.current)
      setLayoutError(false)
    }).catch(() => {
      if (cancelled || cy.destroyed()) return
      cy.layout({ name: 'grid', fit: false, avoidOverlap: true, spacingFactor: 1.3 }).run()
      if (!userMoved.current) fitReadable(cy, selectionRef.current)
      setLayoutError(true)
    }).finally(() => task.cancel())
    return () => { cancelled = true; task.cancel() }
  }, [structure, narrow])

  // focus on the selection and its neighbourhood
  const matchKey = matchIds.join('|')
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass('faded focus match')
      const sel = selectedId ? cy.getElementById(selectedId) : null
      if (sel && sel.nonempty()) {
        const hood = sel.closedNeighborhood()
        cy.elements().not(hood).addClass('faded')
        hood.addClass('focus')
      }
      for (const id of matchIds) cy.getElementById(id).addClass('match')
    })

  }, [selectedId, matchKey, defs]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 text-xs">
        <span className="mr-auto text-muted" role="status">
          {projection.shown} of {projection.available} {focus ? 'nearby items' : 'items'}
          {focus && ` · ${projection.total} in graph`}
        </span>
        {focus && <Button size="sm" onClick={() => setDepth((d) => d + 1)}>Expand connections</Button>}
        {projection.shown < projection.available && <Button size="sm" onClick={() => setPage({ scope, extra: (page.scope === scope ? page.extra : 0) + (narrow ? 12 : 30) })}>Show more</Button>}
        {(focus || page.extra > 0 || depth > 1) && <Button size="sm" onClick={() => { setPage({ scope: '', extra: 0 }); setDepth(1); onSelect(null) }}>Reset view</Button>}
        <span className="w-full text-muted">Sources · Knowledge · Applies to — select an item to follow its evidence.</span>
        {layoutError && <span role="status">Using a simple layout. Connections and details are still available.</span>}
      </div>
      <div ref={host} role="img" aria-label="Knowledge connections. Use Browse to select items with the keyboard." className="min-h-0 w-full flex-1" />
    </div>
  )
}
