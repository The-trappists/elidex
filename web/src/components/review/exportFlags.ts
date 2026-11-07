// Text of the flags export, built from what the page has loaded (CSV, JSON, Markdown).
import type { LiveThread, ReviewFlag } from '../../api/types'
import { toCsv, type ExportFormat } from '../../lib/download'
import { FLAG_META, flagSource, SOURCE_LABEL } from '../../lib/review'

export function buildFlagsExport(flags: ReviewFlag[], threads: Record<string, LiveThread>, format: ExportFormat): string {
  if (format === 'json') return JSON.stringify(flags, null, 2)
  const subject = (f: ReviewFlag) => threads[f.thread_id]?.subject ?? f.thread_id
  if (format === 'csv') {
    return toCsv(
      ['id', 'kind', 'found_by', 'created_at', 'dismissed', 'conversation_id', 'conversation', 'knowledge_id', 'topic', 'message', 'detail'],
      flags.map((f) => [f.id, FLAG_META[f.kind].title, SOURCE_LABEL[flagSource(f)], f.created_at, f.dismissed, f.thread_id, subject(f), f.assertion_id, f.item_topic, f.message, f.detail]),
    )
  }
  const lines = [`# Needs a look (${flags.length})`, '']
  for (const f of flags) {
    lines.push(`## ${FLAG_META[f.kind].title}: ${f.message}`, '')
    lines.push(`- Found by: ${SOURCE_LABEL[flagSource(f)]}`, `- When: ${f.created_at}`, `- Conversation: ${subject(f)} (${f.thread_id})`)
    if (f.assertion_id) lines.push(`- Knowledge: ${f.assertion_id}`)
    if (f.detail) lines.push(`- Why: ${f.detail}`)
    lines.push('')
  }
  return lines.join('\n')
}
