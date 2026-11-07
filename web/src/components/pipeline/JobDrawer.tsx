import { formatDistanceToNowStrict } from 'date-fns'
import { fmtDateTime, fmtMs } from '../../lib/format'
import { useLive } from '../../store/live'
import { Drawer, IdChip } from '../ui'
import { JobSteps } from './JobSteps'
import { extractorLabel, jobDurationMs } from './jobUtils'

export function JobDrawer({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const job = useLive((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined))
  const thread = useLive((s) => (job ? s.threads[job.thread_id] : undefined))
  const assertions = useLive((s) => s.assertions)

  if (!jobId || !job) return <Drawer open={false} onClose={onClose} title="" children={null} />

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-2xl"
      title={
        <div>
          <div className="truncate">{thread?.subject ?? job.thread_id}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs font-normal text-muted">
            <IdChip>{job.id}</IdChip>
            <span>{extractorLabel(job.extractor)}</span>
            <span title={`${fmtDateTime(job.started_at)} (real time)`}>processed {formatDistanceToNowStrict(new Date(job.started_at), { addSuffix: true })}</span>
            <span>{fmtMs(jobDurationMs(job))}</span>
          </div>
        </div>
      }
    >
      <JobSteps job={job} thread={thread} assertions={assertions} showMessages />
    </Drawer>
  )
}
