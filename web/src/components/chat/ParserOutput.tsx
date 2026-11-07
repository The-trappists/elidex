import { ChevronDown, ChevronRight, Play, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { ContextAssertion, LiveThread, PipelineJob } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtDateTime, fmtMs } from '../../lib/format'
import { STAGE_LABEL, STAGE_STATUS_STYLE } from '../../lib/semantic'
import { assertionHref, TypeBadge, Validity } from '../knowledge/bits'
import { Badge, EmptyState, ErrorNote, IdChip, Button, withToast } from '../ui'
import { explainError } from '../../lib/explain'
import { ItemCard } from './ItemCard'

const H = ({ children, count }: { children: string; count?: number }) => (
  <h4 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
    {children}
    {count !== undefined && <span className="ml-1 font-normal">({count})</span>}
  </h4>
)

function JobView({ job, assertions, hoverItem, onHoverItem }: { job: PipelineJob; assertions: Record<string, ContextAssertion>; hoverItem: number | null; onHoverItem: (i: number | null) => void }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {job.stages.map((s) => (
          <span key={s.stage} title={`${s.detail}${s.duration_ms != null ? ` (${fmtMs(s.duration_ms)})` : ''}`} className={cn('rounded-md border px-1.5 py-0.5 text-xs', STAGE_STATUS_STYLE[s.status])}>
            {STAGE_LABEL[s.stage]}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span>Extractor</span>
        <IdChip>{job.extractor}</IdChip>
        <span className="ml-auto">{fmtDateTime(job.started_at)}</span>
      </div>
      {job.error && <ErrorNote className="mt-3" explained={explainError(job.error)!} raw={job.error} />}

      <H count={job.items.length}>What the AI found in this conversation</H>
      {job.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-3 text-xs text-muted">The parser found nothing worth keeping in this thread.</div>
      ) : (
        <div className="space-y-2">
          {job.items.map((it, i) => (
            <ItemCard key={i} item={it} highlighted={hoverItem === i} onHover={(on) => onHoverItem(on ? i : null)} />
          ))}
        </div>
      )}

      <H count={job.assertion_ids.length}>Knowledge saved</H>
      {job.assertion_ids.length === 0 ? (
        <div className="text-xs text-muted">None stored.</div>
      ) : (
        <div className="space-y-1.5">
          {job.assertion_ids.map((id) => {
            const a = assertions[id]
            return (
              <Link key={id} to={assertionHref(id)} className="flex items-center gap-2 rounded-xl border border-line px-2 py-1.5 text-xs hover:bg-surface-2">
                <IdChip>{id}</IdChip>
                {a ? (
                  <>
                    <TypeBadge type={a.type} />
                    <span className="min-w-0 flex-1 truncate">{a.topic}</span>
                    <Validity a={a} />
                  </>
                ) : (
                  <span className="text-muted">no longer in the store</span>
                )}
              </Link>
            )
          })}
        </div>
      )}
      {job.removed_assertion_ids.length > 0 && (
        <div className="mt-1.5 text-xs text-muted">Removed by this run: {job.removed_assertion_ids.join(', ')}</div>
      )}

      {job.notes.length > 0 && (
        <>
          <H>Linker notes</H>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">{job.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </>
      )}
      {job.events.length > 0 && (
        <>
          <H>Lifecycle events</H>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">{job.events.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </>
      )}
      {job.eval && (
        <>
          <H>Eval against expected</H>
          <div className="space-y-1 text-xs">
            <EvalRow label="Matched" tone="bg-ok/15 text-ok" items={job.eval.matched} />
            <EvalRow label="Missed" tone="bg-bad/15 text-bad" items={job.eval.missed} />
            <EvalRow label="Unexpected" tone="bg-warn/15 text-warn" items={job.eval.unexpected} />
            {job.eval.binding_diffs.length > 0 && <EvalRow label="Binding diffs" tone="bg-info/15 text-info" items={job.eval.binding_diffs} />}
          </div>
        </>
      )}
      {job.llm_call_ids.length > 0 && (
        <>
          <H count={job.llm_call_ids.length}>AI requests</H>
          <div className="flex flex-wrap gap-1">
            {job.llm_call_ids.map((id) => (
              <Link key={id} to={`/llm?call=${encodeURIComponent(id)}`}>
                <IdChip className="hover:border-accent">{id}</IdChip>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function EvalRow({ label, tone, items }: { label: string; tone: string; items: string[] }) {
  return (
    <div className="flex items-start gap-2">
      <Badge className={cn('w-20 justify-center', tone)}>{label} {items.length}</Badge>
      <span className="text-muted">{items.length ? items.join(', ') : '—'}</span>
    </div>
  )
}

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
          <JobView job={latest} assertions={assertions} hoverItem={hoverItem} onHoverItem={onHoverItem} />
          {previous.length > 0 && (
            <div className="mt-5 border-t border-line pt-3">
              <button className="flex items-center gap-1 text-xs font-medium text-muted hover:text-text" onClick={() => setShowPrev((v) => !v)}>
                {showPrev ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Previous jobs ({previous.length})
              </button>
              {showPrev &&
                previous.map((j) => (
                  <div key={j.id} className="mt-3 rounded-xl border border-line p-2.5 opacity-90">
                    <div className="mb-2 text-xs text-muted">Job {j.id}</div>
                    <JobView job={j} assertions={assertions} hoverItem={null} onHoverItem={() => {}} />
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
