import { AlertTriangle, ChevronRight, Workflow } from 'lucide-react'
import { Fragment, useState } from 'react'
import { cn } from '../../lib/cn'
import { fmtMs } from '../../lib/format'
import { describeJob } from '../../lib/explain'
import { SOURCE_STYLE, STAGE_LABEL, STAGE_STATUS_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { Badge, EmptyState } from '../ui'
import { JobDrawer } from './JobDrawer'
import { extractorLabel, isRunning, jobDurationMs } from './jobUtils'
import type { PipelineJob } from '../../api/types'

const STAGE_STATUS_WORD = { pending: 'waiting', running: 'in progress', done: 'done', skipped: 'skipped', error: 'failed' } as const

export function StageChips({ job, compact }: { job: PipelineJob; compact?: boolean }) {
  return (
    <div className="flex items-center">
      {job.stages.map((s, i) => (
        <Fragment key={s.stage}>
          {i > 0 && <ChevronRight size={11} className="mx-px shrink-0 text-muted/60" />}
          <span
            title={`${STAGE_LABEL[s.stage]} (${STAGE_STATUS_WORD[s.status]})${s.detail ? ' · ' + s.detail : ''}`}
            className={cn('rounded-full border px-2 py-1 text-xs font-medium leading-none transition-colors', STAGE_STATUS_STYLE[s.status], compact && 'px-1.5')}
          >
            {STAGE_LABEL[s.stage]}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

/** The last jobs, newest on top. A click opens the job drawer. */
export function PipelineLane({ limit = 15 }: { limit?: number }) {
  const jobs = useLive((s) => s.jobs)
  const threads = useLive((s) => s.threads)
  const [open, setOpen] = useState<string | null>(null)
  const rows = jobs.slice(-limit).reverse()

  if (!rows.length)
    return <EmptyState icon={<Workflow size={26} />} title="No pipeline jobs yet" hint="A job appears here when a conversation goes quiet and is processed: listen, understand, link, store, reconcile." />

  return (
    <>
      <ul className="stagger divide-y divide-line/50">
        {rows.map((j) => {
          const t = threads[j.thread_id]
          const dur = jobDurationMs(j)
          return (
            <li
              key={j.id}
              onClick={() => setOpen(j.id)}
              className={cn('cursor-pointer px-4 py-2.5 transition-colors hover:bg-surface-2', j.error && 'border-l-4 border-l-bad bg-bad/10 hover:bg-bad/15')}
            >
              <div className="flex items-center gap-2">
                {j.error && <Badge className="bg-bad text-white"><AlertTriangle size={12} /> Failed</Badge>}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t?.subject ?? j.thread_id}</span>
                {t && <Badge className={SOURCE_STYLE[t.source].cls}>{SOURCE_STYLE[t.source].label}</Badge>}
                <Badge className="bg-surface-2 text-muted">{extractorLabel(j.extractor)}</Badge>
                {isRunning(j) && <Badge className="bg-info/15 text-info"><span className="live-dot size-1.5 rounded-full bg-current" />Reading</Badge>}
                <span className="w-14 text-right text-xs tabular-nums text-muted">{fmtMs(dur)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <StageChips job={j} />
                <span title={j.error ?? undefined} className={cn('min-w-0 flex-1 truncate text-xs', j.error ? 'font-medium text-bad' : 'text-muted')}>{describeJob(j)}</span>
              </div>
            </li>
          )
        })}
      </ul>
      <JobDrawer jobId={open} onClose={() => setOpen(null)} />
    </>
  )
}
