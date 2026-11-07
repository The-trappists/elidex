import { Workflow } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../lib/cn'
import { fmtMs } from '../../lib/format'
import { describeJob } from '../../lib/explain'
import { useLive } from '../../store/live'
import { EmptyState } from '../ui'
import { JobDrawer } from './JobDrawer'
import { StepStrip } from './StepStrip'
import { jobDurationMs } from './jobUtils'

/** The last pipeline runs, newest on top. A click opens the step-by-step view. */
export function PipelineLane({ limit = 15, compact = false }: { limit?: number; compact?: boolean }) {
  const jobs = useLive((s) => s.jobs)
  const threads = useLive((s) => s.threads)
  const [open, setOpen] = useState<string | null>(null)
  const rows = jobs.slice(-limit).reverse()

  if (!rows.length) return <EmptyState icon={<Workflow size={24} />} title="Nothing processed yet" hint="A conversation is processed once it goes quiet. Run a scenario to see it happen." />

  return (
    <>
      <ul className="divide-y divide-line">
        {rows.map((j) => {
          const t = threads[j.thread_id]
          return (
            <li key={j.id}>
              <button onClick={() => setOpen(j.id)} className={cn('flex w-full px-4 py-3 text-left transition-colors hover:bg-surface-2', compact ? 'flex-col gap-1.5' : 'items-center gap-4')}>
                <div className="min-w-0 flex-1 self-stretch">
                  <div className="truncate text-sm font-medium">{t?.subject ?? j.thread_id}</div>
                  <div className={cn('truncate text-xs', j.error ? 'text-bad' : 'text-muted')}>{describeJob(j)}</div>
                </div>
                {compact ? (
                  <div className="flex items-center gap-3 self-stretch">
                    <StepStrip job={j} className="w-full flex-1" />
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted">{fmtMs(jobDurationMs(j))}</span>
                  </div>
                ) : (
                  <>
                    <StepStrip job={j} />
                    <span className="w-12 text-right text-xs tabular-nums text-muted">{fmtMs(jobDurationMs(j))}</span>
                  </>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <JobDrawer jobId={open} onClose={() => setOpen(null)} />
    </>
  )
}
