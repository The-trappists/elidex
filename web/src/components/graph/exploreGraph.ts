import type { ElementDefinition } from 'cytoscape'

/** Bound the canvas, keeping the focus and its nearest connections first. No data is deleted. */
export function exploreGraph(defs: ElementDefinition[], focus: string | null, limit: number, depth = 1, priority: string[] = [], perKind = Infinity) {
  const nodes = defs.filter((d) => !d.data.source)
  const edges = defs.filter((d) => !!d.data.source)
  const byId = new Map(nodes.map((d) => [String(d.data.id), d]))
  const adjacency = new Map<string, string[]>()
  for (const { data } of edges) {
    const s = String(data.source), t = String(data.target)
    if (!byId.has(s) || !byId.has(t)) continue
    adjacency.set(s, [...(adjacency.get(s) ?? []), t])
    adjacency.set(t, [...(adjacency.get(t) ?? []), s])
  }
  // Rank by distance from the focus, but let many neighbours of one kind (say 25 radios on one rule)
  // queue behind the next hop, so the view stays a balanced mix instead of one long column.
  const score = new Map<string, number>()
  const rank = (ids: string[], hop: number) => {
    const perKind = new Map<string, number>()
    for (const id of ids) {
      if (score.has(id)) continue
      const kind = String(byId.get(id)?.data.kind)
      const i = perKind.get(kind) ?? 0
      perKind.set(kind, i + 1)
      score.set(id, hop + i / 3)
    }
  }
  priority.filter((id) => byId.has(id)).forEach((id, i) => score.set(id, -1 + i / 1000))
  // Overview: knowledge first, then what it is connected to.
  const seeds = focus && byId.has(focus) ? [focus] : nodes.filter((n) => n.data.kind === 'Assertion').map((n) => String(n.data.id))
  rank(seeds, focus ? 0 : 1)
  let frontier = [...seeds, ...priority.filter((id) => byId.has(id))]
  for (let hop = 1; hop <= depth; hop++) {
    const next = frontier.flatMap((id) => (adjacency.get(id) ?? []).filter((n) => !score.has(n)))
    rank(next, (focus ? 0 : 1) + hop)
    frontier = [...new Set(next)]
  }
  if (!focus) nodes.forEach((n, i) => { const id = String(n.data.id); if (!score.has(id)) score.set(id, 1e6 + i) })
  const candidates = [...score.keys()].filter((id) => byId.has(id)).sort((a, b) => score.get(a)! - score.get(b)!)
  // Cap each kind, so no single kind becomes a column taller than the box. The focus and priority items always count.
  const included = new Set<string>()
  const taken = new Map<string, number>()
  for (const id of candidates) {
    if (included.size >= Math.max(1, limit)) break
    const kind = String(byId.get(id)?.data.kind)
    const pinned = id === focus || score.get(id)! < 0
    if (!pinned && (taken.get(kind) ?? 0) >= perKind) continue
    taken.set(kind, (taken.get(kind) ?? 0) + 1)
    included.add(id)
  }
  // Compound parents must accompany their children, even at the limit.
  for (const id of included) {
    const parent = byId.get(id)?.data.parent
    if (parent && byId.has(String(parent))) included.add(String(parent))
  }
  return {
    defs: defs.filter((d) => d.data.source
      ? included.has(String(d.data.source)) && included.has(String(d.data.target))
      : included.has(String(d.data.id))),
    shown: included.size,
    available: candidates.length,
    total: nodes.length,
  }
}

/** Collapse equipment into its site, aggregating only real physical links. */
export function networkOverview(defs: ElementDefinition[], expanded: Set<string>) {
  const nodes = defs.filter((d) => !d.data.source)
  const byId = new Map(nodes.map((d) => [String(d.data.id), d]))
  const equipment = nodes.filter((n) => n.data.kind === 'element')
  const representative = (id: string) => {
    const n = byId.get(id)
    return n?.data.parent && !expanded.has(String(n.data.parent)) ? String(n.data.parent) : id
  }
  const visibleEquipment = new Set(equipment.filter((n) => representative(String(n.data.id)) === n.data.id).map((n) => String(n.data.id)))
  const members = new Map<string, string[]>()
  for (const d of defs) if (d.data.kind === 'member') {
    const id = String(d.data.source)
    members.set(id, [...(members.get(id) ?? []), String(d.data.target)])
  }
  const knowledge = new Map<string, Set<string>>()
  const visibleKnowledge = new Set<string>()
  const visibleClasses = new Set<string>()
  for (const d of defs) if (d.data.kind === 'binding') {
    const target = String(d.data.target)
    const targets = members.get(target) ?? [target]
    for (const id of targets) {
      const site = byId.get(id)?.data.parent ?? (byId.get(id)?.data.kind === 'site' ? id : null)
      if (site) {
        const ids = knowledge.get(String(site)) ?? new Set<string>()
        ids.add(String(d.data.source)); knowledge.set(String(site), ids)
      }
      if (visibleEquipment.has(id) || expanded.has(id)) {
        visibleKnowledge.add(String(d.data.source))
        if (members.has(target)) visibleClasses.add(target)
      }
    }
  }
  const counts = new Map<string, number>()
  for (const n of equipment) if (n.data.parent) counts.set(String(n.data.parent), (counts.get(String(n.data.parent)) ?? 0) + 1)
  const out: ElementDefinition[] = nodes.filter((n) => n.data.kind === 'site' || visibleEquipment.has(String(n.data.id)) || visibleKnowledge.has(String(n.data.id)) || visibleClasses.has(String(n.data.id))).map((n) => {
    if (n.data.kind !== 'site') return n
    const id = String(n.data.id)
    const collapsed = !expanded.has(id)
    const known = knowledge.get(id)?.size ?? 0
    const parts = [`${counts.get(id) ?? 0} equipment`, ...(known ? [`${known} knowledge`] : [])]
    return { ...n, classes: collapsed ? 'site collapsed-site' : 'site', data: {
      ...n.data, collapsed, knowledge: known,
      label: collapsed ? `${n.data.label}\n${parts.join(' · ')}` : String(n.data.label),
    } }
  })
  const included = new Set(out.map((n) => String(n.data.id)))
  const aggregated = new Map<string, ElementDefinition>()
  for (const d of defs.filter((d) => !!d.data.source)) {
    const source = representative(String(d.data.source)), target = representative(String(d.data.target))
    if (source === target || !included.has(source) || !included.has(target)) continue
    if (d.data.kind !== 'link') {
      // Never imply a direct binding to a site when the assertion only binds to equipment.
      if (source === d.data.source && target === d.data.target) out.push(d)
      continue
    }
    const pair = [source, target].sort()
    const id = JSON.stringify([pair, d.data.lkind])
    const existing = aggregated.get(id)
    if (existing) { existing.data.count++; existing.data.label = `${existing.data.count} links` }
    else aggregated.set(id, { ...d, data: { ...d.data, id: `aggregate:${id}`, source, target, count: 1, label: '' } })
  }
  return [...out, ...aggregated.values()]
}
