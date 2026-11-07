// What equipment, sites and classes a flag is about (from the finding, or from the knowledge it points at).
import type { ElementClass, WbSite } from '../../api/types'
import type { FlagContext, FlagScope } from '../../lib/review'
import { criteriaText } from '../chat/ItemCard'

export function flagScope(ctx: FlagContext, sites: WbSite[], classes: Record<string, ElementClass>): FlagScope {
  const scope: FlagScope = { els: [], siteIds: [], cls: [] }
  if (ctx.item) {
    scope.els.push(...ctx.item.scope.instance_ids)
    scope.siteIds.push(...ctx.item.scope.site_ids)
    if (ctx.item.scope.element_class) scope.cls.push(criteriaText(ctx.item.scope.element_class))
  } else if (ctx.assertion) {
    for (const b of ctx.assertion.bound_to) {
      if (classes[b.entity]) scope.cls.push(classes[b.entity].label)
      else if (sites.some((s) => s.id === b.entity)) scope.siteIds.push(b.entity)
      else scope.els.push(b.entity)
    }
  }
  return scope
}
