// Network page canvas: sites as surfaces holding their equipment, fed from the live store.
import { useMemo } from 'react'
import { useLive } from '../../store/live'
import { GraphKey, LineSwatch, ShapeSwatch, Swatch } from '../graph/GraphLegend'
import { ForceCanvas, type Emphasis } from './ForceCanvas'
import { EQUIPMENT, insightEmphasis, topologyModel } from './models'

export interface TopologyGraphProps {
  at: Date
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Equipment to light up, e.g. what a piece of knowledge applies to. */
  highlightIds?: string[]
  /** Insights: problems in red, possible common cause in amber, the links between them. */
  insight?: { problem: string[]; suspect: string[]; links: string[] } | null
  /** Show where knowledge is attached (counts on sites, dots on equipment). Default true. */
  showKnowledge?: boolean
}

export function TopologyGraph({ at, selectedId, onSelect, highlightIds, insight, showKnowledge = true }: TopologyGraphProps) {
  const ready = useLive((s) => s.ready)
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const links = useLive((s) => s.links)
  const classes = useLive((s) => s.classes)
  const assertions = useLive((s) => s.assertions)
  const incidents = useLive((s) => s.incidents)
  const minute = Math.floor(at.getTime() / 60000)

  const model = useMemo(() => {
    const m = topologyModel({
        elements,
        sites,
        links,
        classes: Object.values(classes),
        assertions: Object.values(assertions),
        incidents: Object.values(incidents),
      at: new Date(minute * 60000),
    })
    return showKnowledge ? m : { ...m, nodes: m.nodes.map((n) => ({ ...n, badge: false, knowledge: undefined })) }
  }, [elements, sites, links, classes, assertions, incidents, minute, showKnowledge])

  const hlKey = (highlightIds ?? []).join('|')
  const emphasis = useMemo<Emphasis | null>(
    () => insightEmphasis(model.links, insight ?? null) ?? (hlKey ? { nodes: Object.fromEntries(hlKey.split('|').map((id) => [id, 'accent' as const])) } : null),
    [model.links, insight, hlKey],
  )

  return (
    <>
      <ForceCanvas
        loading={!ready}
        mode="topology"
        nodes={model.nodes}
        links={model.links}
        selectedId={selectedId}
        emphasis={emphasis}
        onSelect={onSelect}
        ariaLabel="Network topology: sites with their equipment. Use Browse to find equipment and sites with the keyboard."
      />
      {ready && !elements.length && !sites.length && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">No network elements yet</div>
      )}
    </>
  )
}

export function TopologyKey() {
  return (
    <GraphKey
      items={[
        { label: 'Site', swatch: <Swatch color="var(--g-link)" radius={4} dashed /> },
        ...EQUIPMENT.map((e) => ({ label: e.label, swatch: <ShapeSwatch shape={e.shape} color={`var(${e.color})`} /> })),
        { label: 'Knowledge attached', swatch: <ShapeSwatch shape="circle" color="var(--g-assertion)" dot /> },
        { label: 'Open incident', swatch: <ShapeSwatch shape="circle" color="var(--bad)" /> },
        { label: 'Fibre', swatch: <LineSwatch /> },
        { label: 'Microwave', swatch: <LineSwatch dash="4 3" /> },
        { label: 'Backhaul', swatch: <LineSwatch dash="1 3" /> },
      ]}
    />
  )
}
