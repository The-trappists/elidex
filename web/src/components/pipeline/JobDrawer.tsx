import { CheckCircle2, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { fmtDateTime, fmtMs, fmtTime } from '../../lib/format'
import { SOURCE_STYLE, STAGE_LABEL, STAGE_STATUS_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { Badge, Drawer, ErrorNote, IdChip } from '../ui'
import { describeJob, explainError, STAGE_HELP } from '../../lib/explain'
import { ItemCard } from './ItemCard'
import { StageChips } from './PipelineLane'
import { extractorLabel, jobDurationMs } from './jobUtils'

const Section = ({ title, children, count }: { title: string; children: ReactNode; count?: number }) => (
  <section className="mb-5">
    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
      {title}
      {count !== undefined && <span className="ml-1.5 rounded bg-surface-2 px-1 normal-case">{count}</span>}
    </h4>
    {children}
  </section>
)

const List = ({ items, tone }: { items: string[]; tone: 'ok' | 'bad' }) => (
  <ul className="space-y-1">
    {items.map((x, i) => (
      <li key={i} className={cn('flex gap-1.5 rounded-md px-2 py-1 text-xs', tone === 'ok' ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>
        {tone === 'ok' ? <CheckCircle2 size={13} className="mt-px shrink-0" /> : <XCircle size={13} className="mt-px shrink-0" />}
        <span>{x}</span>
      </li>
    ))}
  </ul>
)

export function JobDrawer({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const job = useLive((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined))
  const thread = useLive((s) => (job ? s.threads[job.thread_id] : undefined))
  const nav = useNavigate()
  const [focus, setFocus] = useState<number | null>(null)

  if (!jobId || !job) return <Drawer open={false} onClose={onClose} title="" children={null} />

  const cited = new Set(job.items.flatMap((i) => i.cited_seq))
  const focused = focus != null ? new Set(job.items[focus]?.cited_seq ?? []) : null
  const ev = job.eval

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={
        <div>
          <div className="flex items-center gap-2">
            <span className="truncate">{thread?.subject ?? job.thread_id}</span>
            {thread && <Badge className={SOURCE_STYLE[thread.source].cls}>{SOURCE_STYLE[thread.source].label}</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs font-normal text-muted">
            <IdChip>{job.id}</IdChip>
            <span>{extractorLabel(job.extractor)}</span>
            <span>{fmtDateTime(job.started_at)} (wall)</span>
            <span>{fmtMs(jobDurationMs(job))}</span>
          </div>
        </div>
      }
    >
      <div className="mb-5 flex items-center gap-3">
        <StageChips job={job} />
        <span className="text-sm font-medium">{describeJob(job)}</span>
      </div>

      {job.error && <ErrorNote className="mb-5" explained={explainError(job.error)!} raw={job.error} />}

      <Section title="Stages">
        <ol className="space-y-1.5">
          {job.stages.map((s) => (
            <li key={s.stage} className="flex items-center gap-2 text-xs">
              <span className={cn('w-20 rounded border px-1.5 py-1 text-center font-medium', STAGE_STATUS_STYLE[s.status])}>{STAGE_LABEL[s.stage]}</span>
              <span className="w-14 tabular-nums text-muted">{fmtMs(s.duration_ms)}</span>
              <span className="min-w-0 flex-1 break-words text-muted">{s.detail || STAGE_HELP[s.stage]}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Conversation" count={thread?.messages.length}>
        {thread?.messages.length ? (
          <ul className="space-y-1">
            {thread.messages.map((m) => {
              const isCited = cited.has(m.seq)
              const isFocus = focused?.has(m.seq)
              return (
                <li
                  key={m.seq}
                  className={cn(
                    'rounded-md border-l-2 px-2.5 py-1.5 text-[13px] transition',
                    isFocus ? 'border-accent bg-accent-soft' : isCited ? 'border-accent/40 bg-surface-2' : 'border-transparent',
                    focused && !isFocus && 'opacity-50',
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <span className="font-mono">#{m.seq}</span>
                    <b className="font-medium text-text">{m.author}</b>
                    {m.role && <span>{m.role}</span>}
                    <span className="ml-auto">{fmtTime(m.sent_at)}</span>
                  </div>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted">The thread is no longer available.</p>
        )}
      </Section>

      <Section title="Extracted items" count={job.items.length}>
        {job.items.length ? (
          <div className="space-y-2">
            {job.items.map((it, i) => (
              <ItemCard key={i} item={it} active={focus === i} onHover={(on) => setFocus(on ? i : null)} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">Nothing was extracted from this thread.</p>
        )}
      </Section>

      {job.notes.length > 0 && (
        <Section title="Linker notes" count={job.notes.length}>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">{job.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Section>
      )}

      <Section title="Knowledge saved" count={job.assertion_ids.length}>
        {job.assertion_ids.length || job.removed_assertion_ids.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {job.assertion_ids.map((id) => <IdChip key={id} onClick={() => nav(`/knowledge?assertion=${encodeURIComponent(id)}`)}>{id}</IdChip>)}
            {job.removed_assertion_ids.map((id) => <IdChip key={id} className="line-through opacity-60">{id}</IdChip>)}
            {job.removed_assertion_ids.length > 0 && <span className="text-xs text-muted">struck through = removed on re-processing</span>}
          </div>
        ) : (
          <p className="text-xs text-muted">No knowledge created or merged.</p>
        )}
      </Section>

      {job.events.length > 0 && (
        <Section title="Lifecycle events" count={job.events.length}>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">{job.events.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Section>
      )}

      {ev && (
        <Section title="Evaluation against expected">
          <div className="space-y-3">
            {ev.matched.length > 0 && <div><div className="mb-1 text-xs font-medium text-ok">Matched ({ev.matched.length})</div><List items={ev.matched} tone="ok" /></div>}
            {ev.missed.length > 0 && <div><div className="mb-1 text-xs font-medium text-bad">Missed ({ev.missed.length})</div><List items={ev.missed} tone="bad" /></div>}
            {ev.unexpected.length > 0 && <div><div className="mb-1 text-xs font-medium text-bad">Unexpected ({ev.unexpected.length})</div><List items={ev.unexpected} tone="bad" /></div>}
            {ev.binding_diffs.length > 0 && <div><div className="mb-1 text-xs font-medium text-bad">Binding differences</div><List items={ev.binding_diffs} tone="bad" /></div>}
          </div>
        </Section>
      )}

      {job.llm_call_ids.length > 0 && (
        <Section title="LLM calls" count={job.llm_call_ids.length}>
          <div className="flex flex-wrap gap-1.5">
            {job.llm_call_ids.map((id) => <IdChip key={id} onClick={() => nav(`/llm?call=${encodeURIComponent(id)}`)}>{id}</IdChip>)}
          </div>
        </Section>
      )}
    </Drawer>
  )
}
