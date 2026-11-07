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
  onSelect,
  handle,
}: {
  defs: cytoscape.ElementDefinition[]
  selectedId: string | null
  matchIds: string[]
  onSelect: (id: string | null) => void
  handle?: React.MutableRefObject<KgCanvasHandle | null>
}) {
  const host = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const nodeKey = useRef('')
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
        if (!ele.empty()) ele.data(d.data)
      }
    })
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
  }, [defs])

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
