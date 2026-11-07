// Pure helpers: class membership, validity and the Cytoscape element list built from the live store.
import type { ElementDefinition } from 'cytoscape'
import type {
  ClassCriteria,
  ContextAssertion,
  ElementClass,
  Incident,
  NetworkElement,
  TopologyLink,
  WbElement,
  WbSite,
} from '../../api/types'
import { TYPE_STYLE } from '../../lib/semantic'

export type NodeKind = 'element' | 'site' | 'class' | 'assertion'

export function matchesCriteria(c: ClassCriteria, e: NetworkElement): boolean {
  if (c.type && c.type !== e.type) return false
  if (c.model && c.model.toLowerCase() !== e.model.toLowerCase()) return false
  if (c.install_year_min != null && e.install_year < c.install_year_min) return false
  if (c.install_year_max != null && e.install_year > c.install_year_max) return false
  return true
}

export const classMembers = (c: ElementClass, elements: WbElement[]) => elements.filter((e) => matchesCriteria(c.criteria, e))
export const classesOf = (e: NetworkElement, classes: ElementClass[]) => classes.filter((c) => matchesCriteria(c.criteria, e))

/** valid_from <= at < valid_to (valid_to null = open ended). */
export function validAt(a: ContextAssertion, at: Date): boolean {
  const t = at.getTime()
  if (new Date(a.valid_from).getTime() > t) return false
  return a.valid_to == null || t < new Date(a.valid_to).getTime()
}

export const nodeIds = {
  element: (id: string) => `el:${id}`,
  site: (id: string) => `st:${id}`,
  class: (id: string) => `cl:${id}`,
  assertion: (id: string) => `as:${id}`,
}

export interface GraphInput {
  elements: WbElement[]
  sites: WbSite[]
  links: TopologyLink[]
  classes: ElementClass[]
  assertions: ContextAssertion[]
  incidents: Incident[]
  knowledge: boolean
  fadeExpired: boolean // false = hide assertions not valid at `at`
  at: Date
}

export interface BuiltGraph {
  defs: ElementDefinition[]
  /** Ids of elements, sites and classes: a change here needs a new layout. */
  structure: string
}

export function buildGraph(g: GraphInput): BuiltGraph {
  const defs: ElementDefinition[] = []
  const openIncident = new Set(g.incidents.filter((i) => i.status === 'open').map((i) => i.entity_id))
  const siteIds = new Set(g.sites.map((s) => s.id))
  const elIds = new Set(g.elements.map((e) => e.id))
  const clsIds = new Set(g.classes.map((c) => c.id))
  const structure: string[] = []

  for (const s of g.sites) {
    structure.push(nodeIds.site(s.id))
    defs.push({
      data: { id: nodeIds.site(s.id), rawId: s.id, kind: 'site', label: s.name, incident: openIncident.has(s.id) },
      classes: 'site',
    })
  }
  for (const e of g.elements) {
    const parent = e.site_id && siteIds.has(e.site_id) ? nodeIds.site(e.site_id) : undefined
    structure.push(nodeIds.element(e.id) + '>' + (parent ?? ''))
    defs.push({
      data: {
        id: nodeIds.element(e.id),
        rawId: e.id,
        kind: 'element',
        label: e.id,
        etype: e.type,
        parent,
        incident: openIncident.has(e.id),
      },
      classes: 'element',
    })
  }
  for (const l of g.links) {
    if (!elIds.has(l.a) || !elIds.has(l.b)) continue
    defs.push({
      data: { id: `lk:${l.id}`, source: nodeIds.element(l.a), target: nodeIds.element(l.b), kind: 'link', lkind: l.kind },
      classes: `link ${l.kind}`,
    })
  }

  if (g.knowledge) {
    for (const c of g.classes) {
      structure.push(nodeIds.class(c.id))
      defs.push({ data: { id: nodeIds.class(c.id), rawId: c.id, kind: 'class', label: c.label }, classes: 'klass' })
      for (const m of classMembers(c, g.elements)) {
        defs.push({
          data: { id: `mo:${c.id}>${m.id}`, source: nodeIds.class(c.id), target: nodeIds.element(m.id), kind: 'member' },
          classes: 'member',
        })
      }
    }
    const target = (entity: string) =>
      elIds.has(entity) ? nodeIds.element(entity) : siteIds.has(entity) ? nodeIds.site(entity) : clsIds.has(entity) ? nodeIds.class(entity) : null
    for (const a of g.assertions) {
      const valid = validAt(a, g.at)
      if (!valid && !g.fadeExpired) continue
      const color = TYPE_STYLE[a.type].hex
      const aid = nodeIds.assertion(a.id)
      defs.push({
        data: { id: aid, rawId: a.id, kind: 'assertion', label: '', title: a.topic, color, faded: !valid },
        classes: 'assertion',
      })
      for (const b of a.bound_to) {
        if (b.role === 'trigger') continue
        const t = target(b.entity)
        if (!t) continue
        defs.push({
          data: { id: `ab:${a.id}>${b.entity}:${b.role}`, source: aid, target: t, kind: 'binding', color, faded: !valid },
          classes: `binding ${b.role}`,
        })
      }
    }
  }
  return { defs, structure: structure.sort().join('|') }
}
