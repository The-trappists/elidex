import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LiveThread, Pattern } from '../../api/types'
import { fmtDateTime } from '../../lib/format'
import { ForceCanvas, type ForceLink, type ForceNode } from '../force/ForceCanvas'
import { cn } from '../../lib/cn'

const FACTOR_LABEL = {
  dependency: 'Shared neighbour', link: 'Direct link', site: 'Same site', firmware: 'Same firmware', model: 'Same model',
}

type EvidenceNode = ForceNode & { detail: string; href?: string; action?: string }

function evidenceModel(pattern: Pattern, threads: Record<string, LiveThread>) {
  const nodes: EvidenceNode[] = []
  const links: ForceLink[] = []
  const equipment = new Set(pattern.elements)
  for (const occurrence of pattern.occurrences) equipment.add(occurrence.element)
  for (const id of equipment) {
    nodes.push({ id: `equipment:${id}`, label: id, shape: 'square', radius: 18, color: '--k-equipment',
      detail: 'Equipment named in the supporting human reports. A reported problem is not a confirmed cause.',
      href: `/network?select=${encodeURIComponent(id)}`, action: 'Open equipment' })
  }
  pattern.occurrences.forEach((occurrence, index) => {
    const id = `report:${index}`
    const source = occurrence.sources[0]
    const subject = source ? threads[source]?.subject ?? source : 'Captured knowledge'
    nodes.push({ id, label: `${fmtDateTime(occurrence.at)} · ${occurrence.by ?? 'Report'}`, shape: 'circle', radius: 14, color: '--k-conversation',
      detail: `${occurrence.kind === 'applied' ? 'Applied action' : 'Human report'} on ${occurrence.element}: ${occurrence.action ?? occurrence.topic}. Source: ${subject}.`,
      href: source ? `/conversations/${encodeURIComponent(source)}` : `/knowledge?assertion=${encodeURIComponent(occurrence.assertion_id)}`,
      action: source ? 'Read conversation' : 'Read captured knowledge' })
    links.push({ id: `reported:${index}`, source: id, target: `equipment:${occurrence.element}`, kind: 'edge', label: 'reported on' })
  })
  pattern.factors.forEach((factor, index) => {
    const id = `factor:${index}`
    nodes.push({ id, label: `${FACTOR_LABEL[factor.kind]}: ${factor.entity}`, shape: 'hexagon', radius: 22, color: '--warn', correlation: 'suspect',
      detail: `${factor.detail} Evidence strength: ${factor.strength}. ${factor.reported === false ? 'Nobody reported a fault on this neighbour. ' : ''}This connection is a hypothesis to check, not a confirmed cause.` })
    for (const element of factor.covers) {
      if (equipment.has(element)) links.push({ id: `${id}:${element}`, source: `equipment:${element}`, target: id, kind: 'edge', label: FACTOR_LABEL[factor.kind].toLowerCase(), correlation: true, color: '--warn', dash: [5, 4] })
    }
  })
  if (pattern.kind === 'recurring') {
    nodes.push({ id: 'recurrence', label: 'Same reported problem', shape: 'hexagon', radius: 22, color: '--accent',
      detail: `${pattern.count} occurrences were grouped as the same problem. ${pattern.grouped.join(' ')} Repetition does not prove a common cause.` })
    pattern.occurrences.forEach((_, index) => links.push({ id: `recurrence:${index}`, source: `report:${index}`, target: 'recurrence', kind: 'edge', label: 'same problem', color: '--accent' }))
  }
  return { nodes, links }
}

/** A focused view of the recorded evidence, never a causal network inferred by the UI. */
export function CorrelationGraph({ pattern, threads }: { pattern: Pattern; threads: Record<string, LiveThread> }) {
  const model = useMemo(() => evidenceModel(pattern, threads), [pattern, threads])
  const [selected, setSelected] = useState<string | null>(null)
  const node = model.nodes.find((item) => item.id === selected)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="shrink-0 border-b border-line bg-surface px-4 py-2">
        <p className="text-sm font-medium">Why these reports are connected</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">Reports name equipment; dashed links show recorded shared factors. Correlation is not proof of a cause.</p>
      </div>
      <div className="relative min-h-40 flex-1">
        <ForceCanvas mode="knowledge" nodes={model.nodes} links={model.links} selectedId={node?.id ?? null} onSelect={setSelected}
          ariaLabel="Correlation evidence graph: reports, affected equipment and shared factors. Use Browse evidence below for keyboard access." />
      </div>
      {node && <div className="shrink-0 border-t border-line bg-surface px-4 py-2 text-sm" aria-live="polite">
        <div className="flex items-start justify-between gap-2"><h3 className="font-medium">{node.label}</h3><button className="min-h-8 px-2 text-xs text-muted hover:text-text" onClick={() => setSelected(null)} aria-label="Close evidence detail">Close</button></div>
        <p className="mt-1 leading-relaxed text-muted">{node.detail}</p>
        {node.href && <Link className="mt-1 inline-flex min-h-8 items-center text-accent hover:underline" to={node.href}>{node.action}</Link>}
      </div>}
      <details className="max-h-44 shrink-0 overflow-auto border-t border-line bg-surface px-4 py-1 text-xs">
        <summary className="cursor-pointer font-medium">Browse evidence ({model.nodes.length})</summary>
        <div className="flex flex-wrap gap-2 py-2">{model.nodes.map((item) => <button key={item.id} onClick={() => setSelected(item.id)} aria-pressed={node?.id === item.id}
          className={cn('min-h-8 max-w-full rounded-md border px-2 py-1 text-left', node?.id === item.id ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-surface-2')}>{item.label}</button>)}</div>
      </details>
    </div>
  )
}
