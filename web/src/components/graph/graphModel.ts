// Pure helpers: class membership and validity.
import type {
  ClassCriteria,
  ContextAssertion,
  ElementClass,
  NetworkElement,
  WbElement,
} from '../../api/types'

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
