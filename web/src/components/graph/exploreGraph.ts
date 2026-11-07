import type { ElementDefinition } from 'cytoscape'

/** Bound the canvas, keeping the focus and its nearest connections first. No data is deleted. */
export function exploreGraph(defs: ElementDefinition[], focus: string | null, limit: number, depth = 1, priority: string[] = []) {
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
  const candidates = new Set<string>()
  const add = (id: string) => { if (byId.has(id)) candidates.add(id) }
  if (focus && byId.has(focus)) {
    add(focus)
    priority.forEach(add)
    let frontier = [...candidates]
    for (let hop = 0; hop < depth; hop++) {
      const next: string[] = []
      for (const id of frontier) for (const neighbour of adjacency.get(id) ?? []) {
        if (!candidates.has(neighbour)) { add(neighbour); next.push(neighbour) }
      }
      frontier = next
    }
  } else {
    priority.forEach(add)
    // Put knowledge and its immediate evidence before disconnected inventory.
    for (const n of nodes.filter((n) => n.data.kind === 'Assertion')) {
      add(String(n.data.id))
      ;(adjacency.get(String(n.data.id)) ?? []).forEach(add)
    }
    nodes.forEach((n) => add(String(n.data.id)))
  }
  const included = new Set([...candidates].slice(0, Math.max(1, limit)))
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
    available: candidates.size,
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
    return { ...n, classes: collapsed ? 'site collapsed-site' : 'site', data: {
      ...n.data, collapsed,
      label: collapsed ? `Site · ${n.data.label}\n${counts.get(id) ?? 0} equipment · ${knowledge.get(id)?.size ?? 0} knowledge` : `Site · ${n.data.label}`,
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
