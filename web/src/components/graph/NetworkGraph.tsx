// Network graph fed from the live store. One cy instance; store changes are diffed into it.
// The view is never moved by hand: it fits its box, and selecting a site or element reshapes it.
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { useEffect, useMemo, useRef } from 'react'
import type { ContextAssertion } from '../../api/types'
import { cn } from '../../lib/cn'
import { useLive } from '../../store/live'
import { buildGraph, type NodeKind } from './graphModel'
import { buildStyle } from './graphStyle'
import { exploreGraph, networkOverview } from './exploreGraph'
import { capacity, fitAll, leafPositions, orient, place, STATIC_VIEW, useBoxSize } from './viewport'

cytoscape.use(fcose)

export interface NetworkGraphProps {
  at: Date
  selectedId?: string | null
  onSelect?: (id: string | null, kind: NodeKind | null) => void
  highlightIds?: string[]
  className?: string
}

const aKey = (n: cytoscape.NodeSingular) => String(n.data('rawId'))

// randomize is off: nodes start from seeded positions, so the drawing is the same on every visit.
const LAYOUT = {
  name: 'fcose',
  animate: false,
  randomize: false,
  fit: false,
  quality: 'proof',
  nodeDimensionsIncludeLabels: true,
  nodeRepulsion: () => 9000,
  idealEdgeLength: (e: cytoscape.EdgeSingular) => (e.hasClass('binding') ? 60 : e.hasClass('member') ? 120 : 110),
  edgeElasticity: (e: cytoscape.EdgeSingular) => (e.hasClass('member') ? 0.15 : 0.45),
  gravity: 0.35,
  nodeSeparation: 70,
  tilingPaddingVertical: 24,
  tilingPaddingHorizontal: 24,
} as unknown as cytoscape.LayoutOptions

/** Add, remove and update elements in place. Returns the ids of new elements. */
function sync(cy: cytoscape.Core, defs: cytoscape.ElementDefinition[]) {
  const wanted = new Map(defs.map((d) => [d.data.id as string, d]))
  const added = new Set<string>()
  cy.batch(() => {
    cy.elements().forEach((e) => {
      if (!e.removed() && !wanted.has(e.id())) cy.remove(e)
    })
    // nodes first (parents before children), then edges
    const fresh = defs.filter((d) => cy.getElementById(d.data.id as string).empty())
    const nodes = fresh.filter((d) => !d.data.source).sort((a, b) => Number(!!a.data.parent) - Number(!!b.data.parent))
    for (const d of nodes) {
      cy.add({ ...d, position: seed(String(d.data.id)) })
      added.add(String(d.data.id))
    }
    cy.add(fresh.filter((d) => d.data.source && cy.getElementById(d.data.source as string).nonempty() && cy.getElementById(d.data.target as string).nonempty()))
    for (const d of defs) {
      const ele = cy.getElementById(d.data.id as string)
      if (ele.empty() || added.has(ele.id())) continue
      const { parent, ...rest } = d.data
      ele.data({ ...rest, faded: rest.faded ?? false })
      if (ele.isNode() && (ele.data('parent') ?? null) !== (parent ?? null)) ele.move({ parent: (parent as string) ?? null })
    }
  })
  return added
}

const hash = (s: string) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

/** Deterministic start position (a hash-based spiral), so fcose is reproducible. */
function seed(id: string) {
  const h = hash(id)
  const ang = ((h % 360) * Math.PI) / 180
  const rad = 60 + (h % 997) / 2
  return { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad }
}

/** Would the free-form drawing need a zoom too small to read in this box? */
function cramped(cy: cytoscape.Core, w: number, h: number) {
  const bb = cy.elements().boundingBox()
  return !!w && !!h && Math.min(w / bb.w, h / bb.h) < 0.6 && cy.nodes(':parent').empty()
}

/** Small boxes: stack the cards in as many columns as fit, busiest first. */
function compact(cy: cytoscape.Core, w: number) {
  const widest = Math.max(...cy.nodes().map((n) => n.outerWidth()))
  cy.layout({
    name: 'grid',
    cols: Math.max(1, Math.floor(w / (widest * 0.75 + 16))),
    fit: false,
    avoidOverlap: true,
    avoidOverlapPadding: 14,
    condense: true,
    sort: (a: cytoscape.NodeSingular, b: cytoscape.NodeSingular) => b.degree(false) - a.degree(false),
  } as cytoscape.GridLayoutOptions).run()
}

/** Free-form layout, compacted for small boxes, turned to the box, then placed. */
function relayout(cy: cytoscape.Core, { w, h }: { w: number; h: number }, before: Map<string, { x: number; y: number }> | null) {
  const layout = cy.layout(LAYOUT)
  layout.one('layoutstop', () => {
    if (cramped(cy, w, h)) compact(cy, w)
    place(cy, orient(leafPositions(cy), w, h), before)
  })
  layout.run()
}

export function NetworkGraph({ at, selectedId, onSelect, highlightIds, className }: NetworkGraphProps) {
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const links = useLive((s) => s.links)
  const classesMap = useLive((s) => s.classes)
  const assertionsMap = useLive((s) => s.assertions)
  const incidentsMap = useLive((s) => s.incidents)

  const host = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const structureRef = useRef<string | null>(null)
  const prevAssertions = useRef<Record<string, ContextAssertion> | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const size = useBoxSize(host)
  const sizeRef = useRef(size)
  sizeRef.current = size
  // Budget of nodes from the box: a phone shows a neighbourhood, a wide screen a region.
  const limit = capacity(size.w, size.h, 15000, 4, 60)

  const raw = useMemo(
    () =>
      buildGraph({
        elements,
        sites,
        links,
        classes: Object.values(classesMap),
        assertions: Object.values(assertionsMap),
        incidents: Object.values(incidentsMap),
        knowledge: true,
        fadeExpired: true,
        at,
      }),
    [elements, sites, links, classesMap, assertionsMap, incidentsMap, Math.floor(at.getTime() / 60000)], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const built = useMemo(() => {
    const selected = raw.defs.find((d) => !d.data.source && d.data.rawId === selectedId)
    // Selecting a site opens it; selecting equipment opens its site.
    const expanded = new Set<string>()
    if (selected?.data.kind === 'site') expanded.add(String(selected.data.id))
    if (selected?.data.parent) expanded.add(String(selected.data.parent))
    // A class or assertion is already a focused query; keep its actual binding endpoints.
    const focusedKnowledge = selected && ['class', 'assertion'].includes(String(selected.data.kind))
    const defs = focusedKnowledge ? raw.defs : networkOverview(raw.defs, expanded)
    const priority = selected ? [String(selected.data.id), ...defs.filter((d) => d.data.parent === selected.data.id).map((d) => String(d.data.id))] : []
    const view = exploreGraph(defs, focusedKnowledge ? String(selected.data.id) : null, limit, 2, priority)
    return { ...view, structure: JSON.stringify(view.defs.map((d) => [d.data.id, d.data.parent, d.data.source, d.data.target])) }
  }, [raw, selectedId, limit])

  // create the instance once; restyle when the theme toggles; pulse open incidents
  useEffect(() => {
    if (!host.current) return
    const cy = cytoscape({ container: host.current, style: buildStyle(), ...STATIC_VIEW })
    cyRef.current = cy
    cy.on('tap', 'node', (ev) => onSelectRef.current?.(aKey(ev.target), ev.target.data('kind')))
    cy.on('tap', (ev) => ev.target === cy && onSelectRef.current?.(null, null))
    // Hover: spotlight the node and its neighbours, softly fade the rest.
    cy.on('mouseover', 'node', (ev) => {
      const n = ev.target
      cy.container()?.style.setProperty('cursor', 'pointer')
      if (n.hasClass('site') && !n.hasClass('collapsed-site')) return
      const hood = n.closedNeighborhood()
      cy.elements().not(hood).not('node.site:parent').addClass('hover-fade')
      hood.addClass('hover-on')
    })
    cy.on('mouseout', 'node', () => {
      cy.elements().removeClass('hover-fade hover-on')
      cy.container()?.style.removeProperty('cursor')
    })
    const mo = new MutationObserver(() => cy.style(buildStyle()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    let on = false
    const pulse = setInterval(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
      on = !on
      cy.nodes('[?incident]').toggleClass('pulse', on)
    }, 900)
    return () => {
      clearInterval(pulse)
      mo.disconnect()
      cy.destroy()
      cyRef.current = null
      structureRef.current = null
      prevAssertions.current = null
    }
  }, [])

  // diff the store into the graph; lay out again only when the structure changes
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const shown = structureRef.current !== null
    const before = shown ? leafPositions(cy) : null
    const added = sync(cy, built.defs)
    const changed = structureRef.current !== built.structure
    structureRef.current = built.structure
    if (changed && cy.nodes().length) relayout(cy, sizeRef.current, before)
    else if (added.size) fitAll(cy)
    // glow newly upserted assertions
    const prev = prevAssertions.current
    prevAssertions.current = assertionsMap
    if (prev) {
      for (const [id, a] of Object.entries(assertionsMap)) {
        if (prev[id] === a) continue
        const n = cy.getElementById(`as:${id}`)
        if (n.empty()) continue
        n.stop(true)
          .animate({ style: { 'overlay-opacity': 0.5, 'overlay-padding': 14 } }, { duration: 350 })
          .animate({ style: { 'overlay-opacity': 0, 'overlay-padding': 4 } }, { duration: 1600 })
      }
    }
  }, [built, assertionsMap])

  // A new box: refit, and turn the drawing if the box changed between wide and tall.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !size.w || !size.h) return
    cy.resize()
    const now = leafPositions(cy)
    const turned = orient(now, size.w, size.h)
    if (cramped(cy, size.w, size.h)) relayout(cy, size, now)
    else if (turned !== now) place(cy, turned, now)
    else fitAll(cy)
  }, [size])

  // selection and highlights
  const hlKey = (highlightIds ?? []).join('|')
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const hl = new Set(highlightIds ?? [])
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        n.toggleClass('sel', selectedId != null && aKey(n) === selectedId)
        n.toggleClass('hl', hl.has(aKey(n)))
      })
    })
  }, [selectedId, hlKey, built]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn('absolute inset-0 flex flex-col overflow-hidden', className)}>
      <div ref={host} role="img" aria-label="Network connections. Use Browse to find equipment and sites." className="min-h-0 w-full flex-1" />
      {!elements.length && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">No network elements yet</div>
      )}
      {built.shown < built.available && (
        <span className="graph-caption" role="status">
          Showing the {built.shown} closest of {built.available} items · the rest are in Browse
        </span>
      )}
    </div>
  )
}
