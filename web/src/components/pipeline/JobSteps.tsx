import { AlertTriangle, Check, ChevronDown, ChevronRight, Circle, Eye, MinusCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ContextAssertion, LiveThread, PipelineJob, StageName, StageStatus } from '../../api/types'
import { cn } from '../../lib/cn'
import { explainError, plural, STAGE_HELP } from '../../lib/explain'
import { fmtMs } from '../../lib/format'
import { STAGE_LABEL } from '../../lib/semantic'
import { assertionHref, TypeBadge, Validity } from '../knowledge/bits'
import { ErrorNote, IdChip, InProgress } from '../ui'
import { extractorLabel, isRunning } from './jobUtils'
import { ItemCard } from './ItemCard'
import { ItemEditor } from './ItemEditor'
import { CriticVerdicts, JudgeVerdicts } from './Verdicts'

const ICON: Record<StageStatus, ReactNode> = {
  pending: <Circle size={15} className="text-muted/50" />,
  running: <span className="size-3.5 animate-spin rounded-full border-2 border-info/30 border-t-info" />,
  done: <Check size={15} className="text-ok" />,
  skipped: <MinusCircle size={15} className="text-muted/60" />,
  error: <AlertTriangle size={15} className="text-bad" />,
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted">{children}</p>
const Label = ({ children }: { children: ReactNode }) => <div className="mb-1.5 mt-3 text-xs font-medium text-muted first:mt-0">{children}</div>

/**
 * The pipeline, one step at a time. Each step says what it received and what it produced;
 * only one is open so the reader can study it without noise from the others.
 */
export function JobSteps({
  job,
  thread,
  assertions,
  hoverItem = null,
  onHoverItem,
  showMessages,
}: {
  job: PipelineJob
  thread?: LiveThread
  assertions: Record<string, ContextAssertion>
  hoverItem?: number | null
  onHoverItem?: (i: number | null) => void
  /** Show the messages inside the Listen step (when the conversation is not already on screen). */
  showMessages?: boolean
}) {
  const failed = job.stages.find((s) => s.status === 'error')?.stage
  const [open, setOpen] = useState<StageName>(failed ?? 'understand')
  const [editing, setEditing] = useState<number | null>(null)
  const ev = job.eval
  const cited = new Set(job.items.flatMap((i) => i.cited_seq))
  const running = isRunning(job)
  const busy = (st: StageName) => running && ['running', 'pending'].includes(job.stages.find((s) => s.stage === st)?.status ?? 'done')

  const summary: Record<StageName, string> = {
    listen: plural(thread?.messages.length ?? 0, 'message'),
    understand: busy('understand') ? 'In progress…' : plural(job.items.length, 'finding') + (job.critic.some((v) => v.verdict === 'reject') ? ` · ${job.critic.filter((v) => v.verdict === 'reject').length} rejected` : ''),
    link: busy('link') ? 'In progress…' : job.notes.length ? plural(job.notes.length, 'note') : 'no remark',
    store: busy('store') ? 'In progress…' : `${job.assertion_ids.length} saved${job.removed_assertion_ids.length ? ` · ${job.removed_assertion_ids.length} replaced` : ''}`,
    reconcile: busy('reconcile') ? 'In progress…' : job.judge.filter((v) => v.verdict !== 'unrelated').length ? plural(job.judge.filter((v) => v.verdict !== 'unrelated').length, 'verdict') : job.events.length ? plural(job.events.length, 'event') : 'nothing to change',
  }

  const body: Record<StageName, ReactNode> = {
    listen: (
      <>
        <Label>Received</Label>
        <p className="text-[13px]">
          {plural(thread?.messages.length ?? 0, 'message')} from {thread?.participants.join(', ') || 'unknown participants'}.
        </p>
        {showMessages && thread && (
          <ul className="mt-2 space-y-1">
            {thread.messages.map((m) => (
              <li key={m.seq} className={cn('rounded-md border-l-2 px-2.5 py-1 text-[13px]', cited.has(m.seq) ? 'border-accent bg-surface-2' : 'border-transparent')}>
                <span className="mr-1.5 font-mono text-xs text-muted">#{m.seq}</span>
                <b className="font-medium">{m.author}</b> <span className="text-muted">{m.text}</span>
              </li>
            ))}
          </ul>
        )}
        {!showMessages && <Empty>Messages that fed a finding are marked in the conversation on the left.</Empty>}
      </>
    ),
    understand: (
      <>
        <Label>Method</Label>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span>{extractorLabel(job.extractor)}</span>
          {job.llm_call_ids.map((id) => (
            <Link key={id} to={`/llm?call=${encodeURIComponent(id)}`}>
              <IdChip className="hover:border-accent">request {id}</IdChip>
            </Link>
          ))}
        </div>
        <Label>Produced · {plural(job.items.length, 'finding')}</Label>
        {busy('understand') ? (
          <InProgress>Reading the conversation…</InProgress>
        ) : job.items.length === 0 ? (
          <Empty>Nothing worth keeping was found in this conversation.</Empty>
        ) : (
          <div className="space-y-2">
            {job.items.map((it, i) => (
              <ItemCard key={i} item={it} stored={job.assertion_ids.map((id) => assertions[id]).find((a) => a?.topic === it.topic)} active={hoverItem === i} onHover={onHoverItem ? (on) => onHoverItem(on ? i : null) : undefined} verdict={job.critic.find((v) => v.item_topic === it.topic)} onEdit={() => setEditing(i)} />
            ))}
          </div>
        )}
        <Label>Second check: why each finding was kept, lowered or rejected</Label>
        {running && !job.critic.length ? <InProgress>Second check in progress…</InProgress> : <CriticVerdicts job={job} thread={thread} />}
        {ev && (
          <>
            <Label>Compared with the expected answer</Label>
            <div className="space-y-1 text-xs">
              <EvalRow label="Matched" items={ev.matched} tone="text-ok" />
              <EvalRow label="Missed" items={ev.missed} tone="text-bad" />
              <EvalRow label="Unexpected" items={ev.unexpected} tone="text-warn" />
              {ev.binding_diffs.length > 0 && <EvalRow label="Different scope" items={ev.binding_diffs} tone="text-warn" />}
            </div>
          </>
        )}
      </>
    ),
    link: (
      <>
        <Label>Received</Label>
        <p className="text-[13px]">{plural(job.items.length, 'finding')}. Each one is matched to equipment, sites or a class of equipment.</p>
        <Label>Remarks from the linker</Label>
        {busy('link') ? <InProgress>Matching findings to equipment…</InProgress> : job.notes.length ? <ul className="list-disc space-y-1 pl-4 text-[13px]">{job.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : <Empty>The linker had nothing to flag.</Empty>}
      </>
    ),
    store: (
      <>
        <Label>Saved as knowledge · {job.assertion_ids.length}</Label>
        {busy('store') ? (
          <InProgress>Saving…</InProgress>
        ) : job.assertion_ids.length === 0 ? (
          <Empty>Nothing was created or merged.</Empty>
        ) : (
          <div className="divide-y divide-line rounded-md border border-line">
            {job.assertion_ids.map((id) => {
              const a = assertions[id]
              return (
                <Link key={id} to={assertionHref(id)} className="flex items-center gap-2 px-2.5 py-2 text-[13px] hover:bg-surface-2">
                  <IdChip>{id}</IdChip>
                  {a ? (
                    <>
                      <span className="min-w-0 flex-1 truncate">{a.topic}</span>
                      <TypeBadge type={a.type} />
                    </>
                  ) : (
                    <span className="text-muted">no longer in the store</span>
                  )}
                </Link>
              )
            })}
          </div>
        )}
        {job.assertion_ids[0] && assertions[job.assertion_ids[0]] && (
          <div className="mt-1.5"><Validity a={assertions[job.assertion_ids[0]]} /></div>
        )}
        {job.removed_assertion_ids.length > 0 && (
          <>
            <Label>Replaced by this run</Label>
            <div className="flex flex-wrap gap-1.5">{job.removed_assertion_ids.map((id) => <IdChip key={id} className="line-through opacity-60">{id}</IdChip>)}</div>
            <p className="mt-1 text-xs text-muted">Re-processing a conversation first removes what it produced before, so the result is always the same.</p>
          </>
        )}
      </>
    ),
    reconcile: (
      <>
        <Label>Changes to older knowledge</Label>
        {busy('reconcile') ? (
          <InProgress>Comparing with stored knowledge…</InProgress>
        ) : job.stages.find((s) => s.stage === 'reconcile')?.status === 'skipped' ? (
          <Empty>Skipped: lifecycle handling is switched off in Settings.</Empty>
        ) : job.events.length ? (
          <ul className="list-disc space-y-1 pl-4 text-[13px]">{job.events.map((n, i) => <li key={i}>{n}</li>)}</ul>
        ) : (
          <Empty>No older knowledge was closed, and no conflict was found.</Empty>
        )}
        <Label>Comparison with stored knowledge: why</Label>
        {busy('reconcile') || (running && !job.judge.length) ? <InProgress>Comparison in progress…</InProgress> : <JudgeVerdicts job={job} />}
      </>
    ),
  }

  return (
    <div>
      {job.flags.some((f) => !f.dismissed) && (
        <Link to={`/review?thread=${encodeURIComponent(job.thread_id)}`} className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs transition-colors hover:border-accent">
          <Eye size={14} className="text-muted" />
          <span>{plural(job.flags.filter((f) => !f.dismissed).length, 'thing')} from this run could use a look.</span>
          <span className="ml-auto font-medium text-accent">Open</span>
        </Link>
      )}
      {job.error && <ErrorNote className="mb-3" explained={explainError(job.error)!} raw={job.error} />}
      <ol className="divide-y divide-line rounded-lg border border-line">
        {job.stages.map((s, i) => {
          const isOpen = open === s.stage
          return (
            <li key={s.stage}>
              <button
                onClick={() => setOpen(isOpen ? ('' as StageName) : s.stage)}
                aria-expanded={isOpen}
                className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2', isOpen && 'bg-surface-2')}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">{ICON[s.status]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    <span className="mr-1.5 text-muted">{i + 1}</span>
                    {STAGE_LABEL[s.stage]}
                  </span>
                  <span className="block truncate text-xs text-muted">{STAGE_HELP[s.stage]}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted">
                  <span className="block text-text">{summary[s.stage]}</span>
                  {s.duration_ms != null && <span className="tabular-nums">{fmtMs(s.duration_ms)}</span>}
                </span>
                {isOpen ? <ChevronDown size={15} className="shrink-0 text-muted" /> : <ChevronRight size={15} className="shrink-0 text-muted" />}
              </button>
              {isOpen && <div className="border-t border-line bg-surface px-4 py-3">{body[s.stage]}</div>}
            </li>
          )
        })}
      </ol>
      <ItemEditor job={job} index={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function EvalRow({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  if (!items.length) return null
  return (
    <div className="flex gap-2">
      <span className={cn('w-24 shrink-0 font-medium', tone)}>{label} {items.length}</span>
      <span className="text-muted">{items.join(', ')}</span>
    </div>
  )
}
