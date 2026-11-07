import type { PipelineJob } from '../../api/types'

export function jobDurationMs(job: PipelineJob): number | null {
  const sum = job.stages.reduce((n, s) => n + (s.duration_ms ?? 0), 0)
  if (sum > 0) return sum
  if (job.finished_at) return Math.max(0, new Date(job.finished_at).getTime() - new Date(job.started_at).getTime())
  return null
}

export const isRunning = (job: PipelineJob) => job.stages.some((s) => s.status === 'running') || (!job.finished_at && !job.error)

export interface JobSummary {
  assertions: number
  merged: number
  closed: number
  conflicts: number
  removed: number
  eval: string | null
}

export function summarize(job: PipelineJob): JobSummary {
  const count = (re: RegExp) => job.events.filter((e) => re.test(e)).length
  const ev = job.eval
  const expected = ev ? ev.matched.length + ev.missed.length : 0
  return {
    assertions: job.assertion_ids.length,
    merged: count(/merge/i),
    closed: count(/clos/i),
    conflicts: count(/conflict/i),
    removed: job.removed_assertion_ids.length,
    eval: ev ? `${ev.matched.length}/${expected}` : null,
  }
}

export function summaryText(job: PipelineJob): string {
  const s = summarize(job)
  const parts = [`+${s.assertions} assertion${s.assertions === 1 ? '' : 's'}`]
  if (s.merged) parts.push(`${s.merged} merged`)
  if (s.closed) parts.push(`${s.closed} closed`)
  if (s.conflicts) parts.push(`${s.conflicts} conflict${s.conflicts === 1 ? '' : 's'}`)
  if (s.removed) parts.push(`${s.removed} removed`)
  if (s.eval) parts.push(`eval ${s.eval}`)
  return parts.join(' · ')
}

export function extractorLabel(extractor: string): string {
  if (!extractor) return 'Not read'
  if (extractor.startsWith('llm:')) return `AI · ${extractor.slice(4)}`
  if (extractor === 'scripted') return 'Scripted'
  return extractor
}
