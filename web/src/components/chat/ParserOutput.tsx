import { ChevronDown, ChevronRight, Play, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { ContextAssertion, LiveThread, PipelineJob } from '../../api/types'
import { formatDistanceToNowStrict } from 'date-fns'
import { fmtDateTime } from '../../lib/format'
import { EmptyState, Button, withToast } from '../ui'
import { JobSteps } from '../pipeline/JobSteps'

export function ParserOutput({
  thread,
  jobs,
  assertions,
  hoverItem,
  onHoverItem,
  idleSeconds,
}: {
  thread: LiveThread
  jobs: PipelineJob[]
  assertions: Record<string, ContextAssertion>
  hoverItem: number | null
  onHoverItem: (i: number | null) => void
  idleSeconds: number | null
}) {
  const [showPrev, setShowPrev] = useState(false)
  const mine = jobs.filter((j) => j.thread_id === thread.id)
  const latest = mine.find((j) => j.id === thread.last_job_id) ?? mine[mine.length - 1]
  const previous = mine.filter((j) => j !== latest).reverse()

  return (
    <div className="h-full overflow-auto p-3">
      {!latest ? (
        <EmptyState
          icon={<ScanSearch size={28} />}
          title="Not processed yet"
          hint={
            idleSeconds != null
              ? `The pipeline reads this thread about ${idleSeconds} s after the last message (idle timer). You can also run it now.`
              : 'Run the pipeline to see what it extracts.'
          }
          action={
            <Button variant="primary" icon={<Play size={14} />} disabled={!thread.messages.length} onClick={() => withToast(() => api.processThread(thread.id), 'Processing started')}>
              Process now
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs text-muted">
            <span title={`${fmtDateTime(latest.started_at)} (real time)`}>Processed {formatDistanceToNowStrict(new Date(latest.started_at), { addSuffix: true })}</span>
          </div>
          <JobSteps job={latest} thread={thread} assertions={assertions} hoverItem={hoverItem} onHoverItem={onHoverItem} />
          {previous.length > 0 && (
            <div className="mt-5 border-t border-line pt-3">
              <button className="flex items-center gap-1 text-xs font-medium text-muted hover:text-text" onClick={() => setShowPrev((v) => !v)}>
                {showPrev ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Previous jobs ({previous.length})
              </button>
              {showPrev &&
                previous.map((j) => (
                  <div key={j.id} className="mt-3">
                    <div className="mb-2 text-xs text-muted">Job {j.id}</div>
                    <JobSteps job={j} thread={thread} assertions={assertions} />
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
