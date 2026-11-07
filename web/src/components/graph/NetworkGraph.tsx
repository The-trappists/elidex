// Reusable Cytoscape graph fed from the live store. One cy instance; store changes are diffed into it,
// and the layout only re-runs when elements, sites or classes are added or removed.
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { BookOpen, Eye, EyeOff, Maximize2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContextAssertion } from '../../api/types'
import { cn } from '../../lib/cn'
import { useLive } from '../../store/live'
import { Button } from '../ui'
import { buildGraph, type NodeKind } from './graphModel'
import { buildStyle } from './graphStyle'
import { GraphLegend } from './GraphLegend'

cytoscape.use(fcose)

export interface NetworkGraphProps {
  at: Date
  layers: { knowledge: boolean }
  onLayersChange?: (l: { knowledge: boolean }) => void
  selectedId?: string | null
  onSelect?: (id: string | null, kind: NodeKind | null) => void
  highlightIds?: string[]
  className?: string
}

const aKey = (n: cytoscape.NodeSingular) => String(n.data('rawId'))

function layoutOptions(animate: boolean) {
  return {
    name: 'fcose',
    animate,
    animationDuration: 600,
    randomize: !animate,
    fit: !animate,
    padding: 30,
    quality: 'default',
    nodeDimensionsIncludeLabels: true,
    nodeRepulsion: () => 9000,
    idealEdgeLength: (e: cytoscape.EdgeSingular) => (e.hasClass('binding') ? 55 : e.hasClass('member') ? 130 : 95),
    edgeElasticity: (e: cytoscape.EdgeSingular) => (e.hasClass('member') ? 0.15 : 0.45),
    gravity: 0.3,
    nodeSeparation: 80,
  } as unknown as cytoscape.LayoutOptions
}

/** Add, remove and update elements in place. Returns what changed. */
function sync(cy: cytoscape.Core, defs: cytoscape.ElementDefinition[]) {
  const wanted = new Map(defs.map((d) => [d.data.id as string, d]))
  const added: cytoscape.NodeSingular[] = []
  cy.batch(() => {
    cy.elements().forEach((e) => {
      if (!e.removed() && !wanted.has(e.id())) cy.remove(e)
    })
    // nodes first (parents before children), then edges
    const fresh = defs.filter((d) => !cy.getElementById(d.data.id as string).nonempty())
    const nodes = fresh.filter((d) => !d.data.source).sort((a, b) => Number(!!a.data.parent) - Number(!!b.data.parent))
    const edges = fresh.filter((d) => d.data.source)
    for (const d of nodes) added.push(cy.add(d) as unknown as cytoscape.NodeSingular)
    cy.add(edges.filter((d) => !cy.getElementById(d.data.source as string).empty() && !cy.getElementById(d.data.target as string).empty()))
    for (const d of defs) {
      const ele = cy.getElementById(d.data.id as string)
      if (ele.empty() || added.includes(ele as unknown as cytoscape.NodeSingular)) continue
      const { parent, ...rest } = d.data
      ele.data({ ...rest, faded: rest.faded ?? false })
      if (ele.isNode() && (ele.data('parent') ?? null) !== (parent ?? null)) ele.move({ parent: (parent as string) ?? null })
    }
  })
  return added
}

/** Put new assertion nodes next to the first thing they are bound to (no layout needed). */
function placeNear(cy: cytoscape.Core, nodes: cytoscape.NodeSingular[]) {
  for (const n of nodes) {
    if (n.data('kind') !== 'assertion') continue
    const other = n.connectedEdges().targets().filter((t) => t.id() !== n.id()).first() as cytoscape.NodeSingular
    if (other.empty()) continue
    const p = other.position()
    let h = 0
    for (const ch of n.id()) h = (h * 31 + ch.charCodeAt(0)) % 360
    const ang = (h * Math.PI) / 180
    n.position({ x: p.x + Math.cos(ang) * 55, y: p.y + Math.sin(ang) * 55 })
  }
  void cy
}

export function NetworkGraph({ at, layers, onLayersChange, selectedId, onSelect, highlightIds, className }: NetworkGraphProps) {
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const links = useLive((s) => s.links)
  const classesMap = useLive((s) => s.classes)
  const assertionsMap = useLive((s) => s.assertions)
  const incidentsMap = useLive((s) => s.incidents)
  const [fadeExpired, setFadeExpired] = useState(true)

  const host = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const structureRef = useRef<string | null>(null)
  const prevAssertions = useRef<Record<string, ContextAssertion> | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const built = useMemo(
    () =>
      buildGraph({
        elements,
        sites,
        links,
        classes: Object.values(classesMap),
        assertions: Object.values(assertionsMap),
        incidents: Object.values(incidentsMap),
        knowledge: layers.knowledge,
        fadeExpired,
        at,
      }),
    [elements, sites, links, classesMap, assertionsMap, incidentsMap, layers.knowledge, fadeExpired, Math.floor(at.getTime() / 60000)], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // create the instance once; restyle when the theme toggles; pulse open incidents
  useEffect(() => {
    if (!host.current) return
    const cy = cytoscape({ container: host.current, style: buildStyle(), minZoom: 0.2, maxZoom: 3, wheelSensitivity: 0.25 })
    cyRef.current = cy
    cy.on('tap', 'node', (ev) => onSelectRef.current?.(aKey(ev.target), ev.target.data('kind')))
    cy.on('tap', (ev) => ev.target === cy && onSelectRef.current?.(null, null))
    // Hover: spotlight the node and its neighbours, softly fade the rest.
    cy.on('mouseover', 'node', (ev) => {
      const n = ev.target
      if (n.hasClass('site')) return
      const hood = n.closedNeighborhood()
      cy.elements().not(hood).not('node.site').addClass('hover-fade')
      hood.addClass('hover-on')
      cy.container()?.style.setProperty('cursor', 'pointer')
    })
    cy.on('mouseout', 'node', () => {
      cy.elements().removeClass('hover-fade hover-on')
      cy.container()?.style.removeProperty('cursor')
    })
    const mo = new MutationObserver(() => cy.style(buildStyle()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    // Fit once the container has a real size (the first layout may run while it is 0 px tall).
    let fitted = false
    const ro = new ResizeObserver(() => {
      cy.resize()
      if (!fitted && host.current && host.current.clientHeight > 0 && cy.nodes().length) {
        fitted = true
        cy.fit(undefined, 30)
      }
    })
    ro.observe(host.current)
    let on = false
    const pulse = setInterval(() => {
      on = !on
      cy.nodes('[?incident]').toggleClass('pulse', on)
    }, 700)
    return () => {
      clearInterval(pulse)
      mo.disconnect()
      ro.disconnect()
      cy.destroy()
      cyRef.current = null
      structureRef.current = null
      prevAssertions.current = null
    }
  }, [])

  // diff the store into the graph
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const added = sync(cy, built.defs)
    const first = structureRef.current === null
    const changed = structureRef.current !== built.structure
    structureRef.current = built.structure
    if (changed && cy.nodes().length) {
      const layout = cy.layout(layoutOptions(!first))
      if (first) layout.one('layoutstop', () => cy.height() > 0 && cy.fit(undefined, 30))
      layout.run()
    } else {
      placeNear(cy, added)
    }
    // glow newly upserted assertions
    const prev = prevAssertions.current
    prevAssertions.current = assertionsMap
    if (prev) {
      for (const [id, a] of Object.entries(assertionsMap)) {
        if (prev[id] === a) continue
        const n = cy.getElementById(`as:${id}`)
        if (n.empty()) continue
        n.stop(true).animate({ style: { 'overlay-opacity': 0.6, 'overlay-padding': 16 } }, { duration: 350 }).animate({ style: { 'overlay-opacity': 0, 'overlay-padding': 4 } }, { duration: 1600 })
      }
    }
  }, [built, assertionsMap])

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

  const fit = () => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 30 } }, { duration: 300 })

  return (
    <div className={cn('absolute inset-0 overflow-hidden', className)}>
      <div ref={host} className="h-full w-full" />
      {!elements.length && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">No network elements yet</div>
      )}
      <div className="absolute right-2 top-2 flex gap-1.5">
        <Button
          size="sm"
          variant={layers.knowledge ? 'primary' : 'secondary'}
          icon={<BookOpen size={13} />}
          onClick={() => onLayersChange?.({ ...layers, knowledge: !layers.knowledge })}
          title="Show equipment groups and knowledge on the graph"
        >
          Knowledge
        </Button>
        {layers.knowledge && (
          <Button
            size="sm"
            icon={fadeExpired ? <Eye size={13} /> : <EyeOff size={13} />}
            onClick={() => setFadeExpired(!fadeExpired)}
            title="Knowledge not valid at the chosen time: fade them or hide them"
          >
            {fadeExpired ? 'Fade expired' : 'Hide expired'}
          </Button>
        )}
        <Button size="sm" icon={<Maximize2 size={13} />} onClick={fit} title="Zoom to fit">
          Fit
        </Button>
      </div>
      <GraphLegend knowledge={layers.knowledge} />
    </div>
  )
}
