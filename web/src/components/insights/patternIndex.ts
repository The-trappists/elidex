// Correlations as marks: which nodes and links an open pattern points at. Hypotheses only, never rules.
import type { Pattern } from '../../api/types'

export interface PatternIndex {
  /** Open patterns, newest first. */
  open: Pattern[]
  byId: Map<string, Pattern>
  /** Element, suspect and assertion ids -> the patterns that mention them. */
  byNode: Map<string, Pattern[]>
  /** Elements where the problem was reported. */
  problem: Set<string>
  /** Elements that may be the common cause. */
  suspect: Set<string>
  /** Topology link ids between a problem and a suspect. */
  links: Set<string>
  /** Knowledge that reported or applied a problem (dashed amber). */
  occurrenceAssertions: Set<string>
  /** Knowledge that fixed a problem (dashed green). */
  fixAssertions: Set<string>
}

export function patternIndex(patterns: Pattern[], openOnly = true): PatternIndex {
  const open = patterns
    .filter((p) => !openOnly || p.level !== 'resolved')
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen))
  const index: PatternIndex = {
    open,
    byId: new Map(),
    byNode: new Map(),
    problem: new Set(),
    suspect: new Set(),
    links: new Set(),
    occurrenceAssertions: new Set(),
    fixAssertions: new Set(),
  }
  const add = (id: string, p: Pattern) => index.byNode.set(id, [...(index.byNode.get(id) ?? []), p])
  for (const p of open) {
    index.byId.set(p.id, p)
    for (const id of p.elements) {
      index.problem.add(id)
      add(id, p)
    }
    for (const id of p.suspects) {
      if (!index.problem.has(id)) index.suspect.add(id)
      add(id, p)
    }
    for (const id of p.links) index.links.add(id)
    for (const o of p.occurrences) {
      index.occurrenceAssertions.add(o.assertion_id)
      add(o.assertion_id, p)
    }
    for (const f of p.fixes) {
      index.fixAssertions.add(f.assertion_id)
      add(f.assertion_id, p)
    }
  }
  return index
}
