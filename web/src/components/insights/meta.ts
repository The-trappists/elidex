// Plain-language labels for the Insights page: how sure we are, and what each level means.
import type { LiveThread, Pattern, PatternLevel } from '../../api/types'
import { toCsv, type ExportFormat } from '../../lib/download'

export const LEVEL_LABEL: Record<PatternLevel, string> = { insight: 'Insight', watch: 'Possible link', resolved: 'Resolved' }
export const LEVEL_HELP: Record<PatternLevel, string> = {
  insight: 'Backed by several reports.',
  watch: 'Seen once so far. Worth watching.',
  resolved: 'A lasting fix was reported after the last occurrence.',
}
export const LEVEL_CLS: Record<PatternLevel, string> = {
  insight: 'bg-bad/12 text-bad',
  watch: 'bg-warn/15 text-warn',
  resolved: 'bg-ok/15 text-ok',
}
export const LEVEL_ORDER: PatternLevel[] = ['insight', 'watch', 'resolved']

export const STRENGTH_LABEL = { strong: 'Strong evidence', medium: 'Some evidence', weak: 'Weak evidence' } as const

export const seenText = (p: Pattern) => (p.kind === 'recurring' ? `${p.count}×` : p.count > 1 ? `Seen ${p.count}×` : 'Seen once')

/** Words the search box looks in. */
export const patternText = (p: Pattern) =>
  [p.headline, p.title, p.note, ...p.elements, ...p.suspects, ...p.topics, ...p.people, ...p.occurrences.map((o) => o.assertion_id), LEVEL_LABEL[p.level]]
    .join(' ')
    .toLowerCase()

export function buildPatternsExport(patterns: Pattern[], threads: Record<string, LiveThread>, format: ExportFormat): string {
  if (format === 'json') return JSON.stringify(patterns, null, 2)
  if (format === 'csv') {
    return toCsv(
      ['pattern_id', 'kind', 'how_sure', 'headline', 'element', 'at', 'topic', 'knowledge_id', 'conversations', 'said_by'],
      patterns.flatMap((p) =>
        p.occurrences.map((o) => [p.id, p.kind === 'linked' ? 'Shared root cause' : 'Recurring', LEVEL_LABEL[p.level], p.headline, o.element, o.at, o.topic, o.assertion_id, o.sources.join(' '), o.by]),
      ),
    )
  }
  const lines = ['# Insights from the field', '']
  for (const p of patterns) {
    lines.push(`## ${LEVEL_LABEL[p.level]}: ${p.headline}`, '', `- Kind: ${p.kind === 'linked' ? 'Shared root cause' : 'Recurring issue'}`, `- Equipment: ${p.elements.join(', ')}`)
    if (p.suspects.length) lines.push(`- Possible common cause: ${p.suspects.join(', ')}`)
    for (const h of p.hypotheses) lines.push(`- Hypothesis (${STRENGTH_LABEL[h.strength]}): ${h.text}`, ...h.basis.map((b) => `  - Evidence: ${b}`))
    lines.push('', 'Reports:')
    for (const o of p.occurrences) {
      const conv = o.sources.map((s) => threads[s]?.subject ?? s).join(', ')
      lines.push(`- ${o.at} ${o.element}: ${o.topic} (${o.assertion_id}${conv ? `; ${conv}` : ''})`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
