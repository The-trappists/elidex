import { ChevronRight, Workflow } from 'lucide-react'
import { Fragment, useState } from 'react'
import { cn } from '../../lib/cn'
import { fmtMs } from '../../lib/format'
import { SOURCE_STYLE, STAGE_LABEL, STAGE_STATUS_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { Badge, EmptyState } from '../ui'
import { JobDrawer } from './JobDrawer'
import { extractorLabel, jobDurationMs, summaryText } from './jobUtils'
import type { PipelineJob } from '../../api/types'

export function StageChips({ job, compact }: { job: PipelineJob; compact?: boolean }) {
  return (
    <div className="flex items-center">
      {job.stages.map((s, i) => (
        <Fragment key={s.stage}>
          {i > 0 && <ChevronRight size={11} className="mx-px shrink-0 text-muted/60" />}
          <span
            title={`${STAGE_LABEL[s.stage]}: ${s.status}${s.detail ? ' · ' + s.detail : ''}`}
            className={cn('rounded border px-1.5 py-0.5 text-[11.5px] font-medium leading-none', STAGE_STATUS_STYLE[s.status], compact && 'px-1')}
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
      <ul className="divide-y divide-line/60">
        {rows.map((j) => {
          const t = threads[j.thread_id]
          const dur = jobDurationMs(j)
          return (
            <li
              key={j.id}
              onClick={() => setOpen(j.id)}
              className={cn('animate-slide-in cursor-pointer px-3.5 py-2 hover:bg-surface-2', j.error && 'bg-bad/5')}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t?.subject ?? j.thread_id}</span>
                {t && <Badge className={SOURCE_STYLE[t.source].cls}>{SOURCE_STYLE[t.source].label}</Badge>}
                <Badge className="font-mono">{extractorLabel(j.extractor)}</Badge>
                <span className="w-14 text-right text-[12.5px] tabular-nums text-muted">{fmtMs(dur)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <StageChips job={j} />
                <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', j.error ? 'text-bad' : 'text-muted')}>{j.error ? j.error : summaryText(j)}</span>
              </div>
            </li>
          )
        })}
      </ul>
      <JobDrawer jobId={open} onClose={() => setOpen(null)} />
    </>
  )
}
