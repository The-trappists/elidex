// Cytoscape canvas for the knowledge graph. Elements are diffed in place; the layout re-runs only
// when the set of visible nodes changes, from hash-seeded positions so it looks the same on each visit.
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { useEffect, useRef } from 'react'
import { kgStyle } from './kgStyle'

cytoscape.use(fcose)

const hash = (s: string) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

export interface KgCanvasHandle {
  fit: () => void
}

export function KgCanvas({
  defs,
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
  const nodeKey = useRef('')
  const evidenceKey = evidenceIds.join('|')
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
    const ro = new ResizeObserver(() => cy.resize())
    ro.observe(host.current)
    if (handle) handle.current = { fit: () => cy.animate({ fit: { eles: cy.elements(), padding: 40 } }, { duration: 250 }) }
    return () => {
      mo.disconnect()
      ro.disconnect()
      cy.destroy()
      cyRef.current = null
      nodeKey.current = ''
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // diff elements in
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const evidence = new Set(evidenceIds)
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
          ele.data(d.data)
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
    // Keep the graph responsive while the retrieval animation is being reworked. The
    // Cytoscape animation completion callbacks were recursively scheduling work on every
    // edge and could starve the page after the agent populated a larger result graph.
    const key = cy
      .nodes()
      .map((n) => n.id())
      .sort()
      .join('|')
    if (key !== nodeKey.current && cy.nodes().length) {
      const first = nodeKey.current === ''
      nodeKey.current = key
      cy.layout({
        name: 'fcose',
        animate: !first,
        animationDuration: 400,
        randomize: false,
        fit: true,
        padding: 40,
        nodeDimensionsIncludeLabels: true,
        nodeRepulsion: () => 7000,
        idealEdgeLength: () => 70,
        gravity: 0.25,
      } as unknown as cytoscape.LayoutOptions).run()
    }
  }, [defs, targetHighlightId, evidenceKey])

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
    if (selectedId) {
      const n = cy.getElementById(selectedId)
      if (n.nonempty() && !n.renderedBoundingBox().w) return
      if (n.nonempty()) {
        const bb = n.renderedPosition()
        const { w, h } = { w: cy.width(), h: cy.height() }
        if (bb.x < 40 || bb.y < 40 || bb.x > w - 40 || bb.y > h - 40) cy.animate({ center: { eles: n } }, { duration: 250 })
      }
    }
  }, [selectedId, matchKey, defs]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className="h-full w-full" />
}
