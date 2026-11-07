// Cytoscape canvas for the knowledge graph. Elements are diffed in place; the layout re-runs only
// when the visible nodes or the box orientation change. The view always fits the box: no hand zooming.
import cytoscape from 'cytoscape'
import { useEffect, useMemo, useRef, useState } from 'react'
import { exploreGraph } from '../graph/exploreGraph'
import { capacity, fitAll, leafPositions, place, STATIC_VIEW, useBoxSize } from '../graph/viewport'
import { knowledgeLayout } from './knowledgeLayout'
import { KIND } from './kgStyle'
import type { KgKind } from '../../api/types'
import { kgStyle } from './kgStyle'

const hash = (s: string) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

/** Cytoscape wraps only at spaces: give long IDs like `teams/2025-05/s004` places to break. */
const breakable = (label: string) => label.replace(/\S{18,}/g, (word) => word.replace(/([/_])/g, '$1 '))

export function KgCanvas({
  defs: allDefs,
  selectedId,
  matchIds,
  targetHighlightId,
  evidenceIds = [],
  onSelect,
}: {
  defs: cytoscape.ElementDefinition[]
  selectedId: string | null
  matchIds: string[]
  targetHighlightId?: string | null
  evidenceIds?: string[]
  onSelect: (id: string | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const shownRef = useRef(false)
  const [layoutError, setLayoutError] = useState(false)
  const size = useBoxSize(host)
  // Flow left to right on wide boxes, top to bottom on tall or narrow ones.
  const vertical = size.w < 640 || size.h > size.w * 1.1
  // As many items as stay readable in this box; the nearest connections of the focus come first.
  const limit = capacity(size.w, size.h, 20000, 4, 40, 3)
  // Each layout layer holds mostly one kind; keep a layer within the box at a readable zoom.
  const perKind = Math.max(2, Math.floor(vertical ? size.w / 190 : size.h / 100))
  const focus = selectedId ?? targetHighlightId ?? null
  const evidenceKey = evidenceIds.join('|')
  const projection = useMemo(
    () => (size.w ? exploreGraph(allDefs, focus, limit, 2, evidenceKey ? evidenceKey.split('|') : [], perKind) : { defs: [], shown: 0, available: 0, total: 0 }),
    [allDefs, focus, limit, perKind, evidenceKey, size.w],
  )
  const defs = projection.defs
  const structure = JSON.stringify(defs.map((d) => [d.data.id, d.data.source, d.data.target]))
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!host.current) return
    const cy = cytoscape({ container: host.current, style: kgStyle(), ...STATIC_VIEW })
    cyRef.current = cy
    cy.on('tap', 'node', (ev) => onSelectRef.current(ev.target.id()))
    cy.on('tap', (ev) => ev.target === cy && onSelectRef.current(null))
    cy.on('mouseover', 'node', () => cy.container()?.style.setProperty('cursor', 'pointer'))
    cy.on('mouseout', 'node', () => cy.container()?.style.removeProperty('cursor'))
    const mo = new MutationObserver(() => cy.style(kgStyle()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      mo.disconnect()
      cy.destroy()
      cyRef.current = null
      shownRef.current = false
    }
  }, [])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !size.w || !size.h) return
    cy.resize()
    fitAll(cy)
  }, [size])

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
          ele.data({ ...d.data, displayLabel: d.group === 'nodes' ? `${(KIND[d.data.kind as KgKind]?.label ?? String(d.data.kind)).toUpperCase()}\n${breakable(String(d.data.short || d.data.id))}` : undefined })
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

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !cy.nodes().length) return
    let cancelled = false
    const before = shownRef.current ? leafPositions(cy) : null
    const task = knowledgeLayout(cy, vertical)
    task.done.then((positions) => {
      if (cancelled || cy.destroyed()) return
      place(cy, positions, before)
      shownRef.current = true
      setLayoutError(false)
    }).catch(() => {
      if (cancelled || cy.destroyed()) return
      cy.layout({ name: 'grid', fit: false, avoidOverlap: true, spacingFactor: 1.2 }).run()
      fitAll(cy)
      setLayoutError(true)
    }).finally(() => task.cancel())
    return () => { cancelled = true; task.cancel() }
  }, [structure, vertical])

  // focus on the selection and its neighbourhood
  const matchKey = matchIds.join('|')
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass('faded focus match chosen')
      const sel = selectedId ? cy.getElementById(selectedId) : null
      if (sel && sel.nonempty()) {
        const hood = sel.closedNeighborhood()
        cy.elements().not(hood).addClass('faded')
        hood.addClass('focus')
        sel.addClass('chosen')
      }
      for (const id of matchIds) cy.getElementById(id).addClass('match')
    })

  }, [selectedId, matchKey, defs]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div ref={host} role="img" aria-label="Knowledge connections. Use Browse to select items with the keyboard." className="min-h-0 w-full flex-1" />
      {(projection.shown < projection.available || layoutError) && (
        <span className="graph-caption" role="status">
          {layoutError
            ? 'Using a simple layout. Connections and details are still available.'
            : `Showing the ${projection.shown} ${focus ? 'closest' : 'most connected'} of ${projection.available} items`}
        </span>
      )}
    </div>
  )
}
