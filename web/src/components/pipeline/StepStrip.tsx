import { cn } from '../../lib/cn'
import { STAGE_LABEL } from '../../lib/semantic'
import type { PipelineJob, StageStatus } from '../../api/types'

const SEG: Record<StageStatus, string> = {
  pending: 'bg-surface-3',
  running: 'bg-info animate-pulse',
  done: 'bg-ok',
  skipped: 'bg-surface-3',
  error: 'bg-bad',
}
const WORD: Record<StageStatus, string> = { pending: 'waiting', running: 'in progress', done: 'done', skipped: 'skipped', error: 'failed' }

/** Five thin segments, one per pipeline step. Quiet enough to repeat on every row. */
export function StepStrip({ job, className }: { job: PipelineJob; className?: string }) {
  return (
    <div className={cn('flex w-28 gap-0.5', className)} aria-label="Pipeline steps">
      {job.stages.map((s) => (
        <span key={s.stage} title={`${STAGE_LABEL[s.stage]}: ${WORD[s.status]}${s.detail ? ' · ' + s.detail : ''}`} className={cn('h-1.5 flex-1 rounded-full', SEG[s.status])} />
      ))}
    </div>
  )
}
