import type { ContextAssertion, LiveThread, PipelineJob } from '../../api/types'

export interface Citation {
  itemIndex: number
  type: ContextAssertion['type']
  topic: string
  assertionId: string | null
}

/** seq -> first extracted item of the latest job that cites it (with the matching assertion id if found). */
export function buildCitations(thread: LiveThread, job: PipelineJob | undefined, assertions: Record<string, ContextAssertion>): Map<number, Citation> {
  const out = new Map<number, Citation>()
  if (!job) return out
  job.items.forEach((item, itemIndex) => {
    const match = Object.values(assertions).find(
      (a) =>
        a.type === item.type &&
        a.topic === item.topic &&
        a.sources.some((s) => s.file === thread.id && s.seq.some((q) => item.cited_seq.includes(q))),
    )
    for (const seq of item.cited_seq) {
      if (!out.has(seq)) out.set(seq, { itemIndex, type: item.type, topic: item.topic, assertionId: match?.id ?? null })
    }
  })
  return out
}
