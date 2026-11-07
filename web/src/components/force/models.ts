// Turn the live store (topology) and the knowledge graph into ForceCanvas nodes and links.
import type { ContextAssertion, ElementClass, Incident, KgElement, KgKind, TopologyLink, WbElement, WbSite } from '../../api/types'
import { EDGE_LABEL, KIND, title } from '../kg/kgStyle'
import { classMembers, validAt } from '../graph/graphModel'
import type { Emphasis, ForceLink, ForceNode, Shape } from './ForceCanvas'

/** One shape and theme hue per equipment family; anything else is a plain circle. */
export const EQUIPMENT: { key: string; label: string; shape: Shape; color: string; radius: number; test: (t: string) => boolean }[] = [
  { key: 'router', label: 'Router', shape: 'hexagon', color: '--k-knowledge', radius: 15, test: (t) => t.includes('router') },
  { key: 'switch', label: 'Switch', shape: 'square', color: '--k-person', radius: 13, test: (t) => t.includes('switch') },
  { key: 'transmission', label: 'Transmission node', shape: 'diamond', color: '--k-group', radius: 13, test: (t) => t.includes('transmission') },
  { key: 'radio', label: 'Radio unit', shape: 'triangle', color: '--k-event', radius: 12, test: (t) => t.includes('radio') },
  { key: 'other', label: 'Other equipment', shape: 'circle', color: '--k-equipment', radius: 11, test: () => true },
]
export const equipmentStyle = (type: string) => EQUIPMENT.find((e) => e.test(type.toLowerCase()))!

export const LINK_DASH: Record<string, number[] | undefined> = { fiber: undefined, microwave: [6, 4], backhaul: [1.5, 4] }

export function topologyModel(g: {
  elements: WbElement[]
  sites: WbSite[]
  links: TopologyLink[]
  classes: ElementClass[]
  assertions: ContextAssertion[]
  incidents: Incident[]
  at: Date
}) {
  const open = new Set(g.incidents.filter((i) => i.status === 'open').map((i) => i.entity_id))
  const siteIds = new Set(g.sites.map((s) => s.id))
  const classById = new Map(g.classes.map((c) => [c.id, c]))
  // Knowledge in force at `at`, per equipment or site it applies to.
  const known = new Map<string, Set<string>>()
  const note = (entity: string, aid: string) => known.set(entity, (known.get(entity) ?? new Set()).add(aid))
  for (const a of g.assertions) {
    if (!validAt(a, g.at)) continue
    for (const b of a.bound_to) {
      if (b.role === 'trigger') continue
      const cls = classById.get(b.entity)
      if (cls) for (const m of classMembers(cls, g.elements)) note(m.id, a.id)
      else note(b.entity, a.id)
    }
  }
  const siteKnowledge = (siteId: string) => {
    const all = new Set(known.get(siteId) ?? [])
    for (const e of g.elements) if (e.site_id === siteId) for (const aid of known.get(e.id) ?? []) all.add(aid)
    return { total: all.size, own: known.get(siteId)?.size ?? 0 }
  }
  const nodes: ForceNode[] = []
  const links: ForceLink[] = []
  for (const s of g.sites) {
    nodes.push({ id: s.id, label: s.name, color: '--k-site', shape: 'square', radius: 16, isGroup: true, alert: open.has(s.id), knowledge: siteKnowledge(s.id) })
  }
  const groupOf = new Map<string, string | undefined>()
  for (const e of g.elements) {
    const st = equipmentStyle(e.type)
    const group = e.site_id && siteIds.has(e.site_id) ? e.site_id : undefined
    groupOf.set(e.id, group)
    nodes.push({ id: e.id, label: e.id, color: st.color, shape: st.shape, radius: st.radius, group, alert: open.has(e.id), badge: known.has(e.id) })
    if (group) links.push({ id: `anchor:${e.id}`, source: e.id, target: group, kind: 'anchor' })
  }
  for (const l of g.links) {
    if (!groupOf.has(l.a) || !groupOf.has(l.b)) continue
    const inter = groupOf.get(l.a) !== groupOf.get(l.b)
    links.push({ id: l.id, source: l.a, target: l.b, kind: inter ? 'inter' : 'intra', dash: LINK_DASH[l.kind], label: l.kind })
  }
  return { nodes, links }
}

/** Ids a class or a piece of knowledge points at, to light up on the topology. */
export function knowledgeTargets(id: string, g: { elements: WbElement[]; classes: Record<string, ElementClass>; assertions: Record<string, ContextAssertion> }) {
  const out = new Set<string>()
  const add = (entity: string) => {
    const cls = g.classes[entity]
    if (cls) for (const m of classMembers(cls, g.elements)) out.add(m.id)
    else out.add(entity)
  }
  if (g.classes[id]) add(id)
  const a = g.assertions[id]
  if (a) for (const b of a.bound_to) if (b.role !== 'trigger') add(b.entity)
  return [...out]
}

/** Knowledge graph: shape and size per kind; knowledge is the largest. */
export const KG_SHAPE: Record<KgKind, { shape: Shape; radius: number }> = {
  Assertion: { shape: 'circle', radius: 26 },
  Person: { shape: 'circle', radius: 13 },
  Element: { shape: 'square', radius: 12 },
  Site: { shape: 'square', radius: 15 },
  Class: { shape: 'hexagon', radius: 14 },
  Event: { shape: 'diamond', radius: 12 },
  Thread: { shape: 'square', radius: 13 },
  Message: { shape: 'circle', radius: 7 },
}

export const KG_EDGE_STYLE: Record<string, Pick<ForceLink, 'dash' | 'color'>> = {
  CONFLICTS_WITH: { dash: [5, 4], color: '--bad' },
  CLOSED_BY: { dash: [5, 4] },
  MENTIONS: { dash: [1.5, 4] },
}

type KgData = KgElement['data']
const shortLabel = (s: string, n = 54) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** Knowledge graph nodes and links for the visible kinds. When messages are hidden, their links move onto their
 * conversation. Knowledge is the spine: only knowledge and its direct neighbours are drawn, plus the neighbours of
 * `keep` (the selection), so clicking a node reveals what hangs off it. */
export function knowledgeModel(nodes: Map<string, KgData>, edges: KgData[], visible: (d: KgData | undefined) => boolean, showMessages: boolean, keep?: string | null) {
  const threadOf = new Map(edges.filter((e) => e.type === 'PART_OF').map((e) => [String(e.source), String(e.target)]))
  const fNodes: ForceNode[] = []
  const fLinks: ForceLink[] = []
  const linked = new Set<string>()
  const seen = new Set<string>()
  for (const e of edges) {
    let s = String(e.source)
    let t = String(e.target)
    if (!showMessages) {
      if (e.type === 'PART_OF') continue
      if (nodes.get(s)?.kind === 'Message') s = threadOf.get(s) ?? s
      if (nodes.get(t)?.kind === 'Message') t = threadOf.get(t) ?? t
    }
    if (s === t || !visible(nodes.get(s)) || !visible(nodes.get(t))) continue
    const type = String(e.type)
    const id = `${s}|${type}|${t}`
    if (seen.has(id)) continue
    seen.add(id)
    fLinks.push({ id, source: s, target: t, kind: 'edge', label: EDGE_LABEL[type] ?? type, ...KG_EDGE_STYLE[type] })
    linked.add(s).add(t)
  }
  const isKnowledge = (id: string) => nodes.get(id)?.kind === 'Assertion'
  const shown = new Set<string>()
  for (const l of fLinks) {
    if (isKnowledge(l.source) || isKnowledge(l.target)) shown.add(l.source).add(l.target)
  }
  if (keep && nodes.has(keep)) {
    shown.add(keep)
    for (const l of fLinks) if (l.source === keep || l.target === keep) shown.add(l.source).add(l.target)
  }
  // With knowledge hidden by the filters, fall back to everything that is linked.
  const anyKnowledge = [...shown].some(isKnowledge)
  const keepNode = (id: string) => (anyKnowledge ? shown.has(id) : linked.has(id) || id === keep)
  const links = fLinks.filter((l) => keepNode(l.source) && keepNode(l.target))
  fLinks.length = 0
  fLinks.push(...links)
  for (const d of nodes.values()) {
    if (!visible(d) || !keepNode(d.id)) continue
    const k = d.kind as KgKind
    fNodes.push({
      id: d.id,
      label: shortLabel(title(d)),
      color: KIND[k]?.token ?? '--k-message',
      ...(KG_SHAPE[k] ?? { shape: 'circle', radius: 10 }),
      faded: k === 'Assertion' && d.valid === false,
    })
  }
  return { fNodes, fLinks }
}

/** Agent tester: the entity in amber, the knowledge the agent used in amber, and the links that tie them: directly,
 * or through a group or site the entity belongs to. */
export function agentEmphasis(links: ForceLink[], targetId: string | null, evidenceIds: string[]): Emphasis | null {
  if (!targetId && !evidenceIds.length) return null
  const nodes: Emphasis['nodes'] = {}
  if (targetId) nodes[targetId] = 'warn'
  for (const id of evidenceIds) nodes[id] = 'warn'
  const evidence = new Set(evidenceIds)
  const scopeLink = new Map<string, string>()
  for (const l of links) {
    if (!targetId || !/\|(MEMBER_OF|LOCATED_AT)\|/.test(l.id)) continue
    if (l.source === targetId) scopeLink.set(l.target, l.id)
    else if (l.target === targetId) scopeLink.set(l.source, l.id)
  }
  const used = new Set<string>()
  for (const l of links) {
    if (!/\|(APPLIES_TO|OBSERVED_ON)\|/.test(l.id)) continue
    const scope = evidence.has(l.source) ? l.target : evidence.has(l.target) ? l.source : null
    if (!scope) continue
    if (scope === targetId) used.add(l.id)
    else if (scopeLink.has(scope)) {
      used.add(l.id).add(scopeLink.get(scope)!)
      nodes[scope] ??= 'warn'
    }
  }
  return { nodes, links: [...used], linkTone: 'warn' }
}

/** Insights: problems in red, the possible common cause in amber, and the links between them. */
export function insightEmphasis(links: ForceLink[], focus: { problem: string[]; suspect: string[]; links: string[] } | null): Emphasis | null {
  if (!focus) return null
  const nodes: Emphasis['nodes'] = {}
  for (const id of focus.problem) nodes[id] = 'bad'
  for (const id of focus.suspect) nodes[id] = 'warn'
  const named = new Set(focus.links)
  const lit = links.filter((l) => l.kind !== 'anchor' && (named.has(l.id) || (nodes[l.source] && nodes[l.target]))).map((l) => l.id)
  return { nodes, links: lit, linkTone: 'bad' }
}
