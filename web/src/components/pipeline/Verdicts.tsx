// The "why" of the two automatic checks: the critic under Understand, the judge under Reconcile.
// Every verdict shows its reason and quotes the source messages verbatim.
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CriticVerdict, CriticVerdictKind, JudgeVerdict, JudgeVerdictKind, LiveThread, PipelineJob } from '../../api/types'
import { cn } from '../../lib/cn'
import { messagesOf } from '../../lib/review'
import { useLive } from '../../store/live'
import { assertionHref } from '../knowledge/bits'
import { QuotedMessages, QuoteLine } from '../review/Quote'
import { Badge, IdChip } from '../ui'

export const CRITIC_STYLE: Record<CriticVerdictKind, { label: string; cls: string }> = {
  keep: { label: 'Kept', cls: 'bg-ok/10 text-ok' },
  downgrade: { label: 'Lowered', cls: 'bg-warn/15 text-warn' },
  reject: { label: 'Rejected', cls: 'bg-bad/10 text-bad' },
}

const JUDGE_STYLE: Record<JudgeVerdictKind, { label: string; cls: string; sentence: string }> = {
  supersedes: { label: 'Supersedes', cls: 'bg-warn/15 text-warn', sentence: 'replaces' },
  contradicts: { label: 'Contradicts', cls: 'bg-warn/15 text-warn', sentence: 'disagrees with' },
  supports: { label: 'Supports', cls: 'bg-ok/10 text-ok', sentence: 'confirms' },
  unrelated: { label: 'Unrelated', cls: 'bg-surface-2 text-muted', sentence: 'is unrelated to' },
}

export const CriticBadge = ({ v }: { v: CriticVerdict }) => <Badge className={CRITIC_STYLE[v.verdict].cls}>{CRITIC_STYLE[v.verdict].label}</Badge>

function Sources({ label, children, count }: { label: string; children: React.ReactNode; count: number }) {
  const [open, setOpen] = useState(false)
  if (!count) return null
  return (
    <div className="mt-1.5">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-text">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {label} ({count})
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

/** Critic verdicts of one job: kept, lowered or rejected, with the reason and the evidence. */
export function CriticVerdicts({ job, thread }: { job: PipelineJob; thread?: LiveThread }) {
  if (!job.critic.length) return <p className="text-xs text-muted">The second check did not run for this job.</p>
  return (
    <ul className="space-y-2">
      {job.critic.map((v, i) => {
        const item = job.items.find((x) => x.topic === v.item_topic)
        const msgs = messagesOf(thread, item?.cited_seq ?? [])
        return (
          <li key={i} className={cn('rounded-md border border-line p-2.5 text-[13px]', v.verdict === 'reject' && 'bg-surface-2')}>
            <div className="flex flex-wrap items-center gap-1.5">
              <CriticBadge v={v} />
              <span className="min-w-0 break-words font-medium">{v.item_topic}</span>
              {v.confidence_after != null && <span className="ml-auto text-xs tabular-nums text-muted">confidence now {Math.round(v.confidence_after * 100)}%</span>}
            </div>
            <p className="mt-1.5">{v.reason}</p>
            {item?.evidence_quote && (
              <div className="mt-1.5">
                <div className="mb-1 text-xs text-muted">{v.evidence_found ? 'Quote the finding relies on' : 'Quote the finding relied on (it does not support it)'}</div>
                <QuoteLine text={item.evidence_quote} />
              </div>
            )}
            <Sources label="Source messages" count={msgs.length}>
              <QuotedMessages messages={msgs} />
            </Sources>
          </li>
        )
      })}
    </ul>
  )
}

/** Judge verdicts of one job: how new knowledge relates to what was already stored. */
export function JudgeVerdicts({ job }: { job: PipelineJob }) {
  const assertions = useLive((s) => s.assertions)
  const threads = useLive((s) => s.threads)
  const relevant = job.judge.filter((v) => v.verdict !== 'unrelated')
  const unrelated = job.judge.length - relevant.length
  if (!job.judge.length) return <p className="text-xs text-muted">The comparison with stored knowledge did not run for this job.</p>

  const quotesOf = (id: string) => {
    const a = assertions[id]
    return a ? a.sources.flatMap((s) => messagesOf(threads[s.file], s.seq)) : []
  }
  const Row = ({ v }: { v: JudgeVerdict }) => {
    const n = assertions[v.new_assertion_id]
    const o = assertions[v.other_assertion_id]
    const nq = quotesOf(v.new_assertion_id)
    const oq = quotesOf(v.other_assertion_id)
    return (
      <li className="rounded-md border border-line p-2.5 text-[13px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={JUDGE_STYLE[v.verdict].cls}>{JUDGE_STYLE[v.verdict].label}</Badge>
          <Link to={assertionHref(v.new_assertion_id)} className="min-w-0"><IdChip className="hover:border-accent">{v.new_assertion_id}</IdChip></Link>
          <span className="text-muted">{JUDGE_STYLE[v.verdict].sentence}</span>
          <Link to={assertionHref(v.other_assertion_id)} className="min-w-0"><IdChip className="hover:border-accent">{v.other_assertion_id}</IdChip></Link>
        </div>
        {(n || o) && (
          <p className="mt-1 text-xs text-muted">
            {n?.topic ?? 'unknown'} {JUDGE_STYLE[v.verdict].sentence} {o?.topic ?? 'unknown'}
          </p>
        )}
        <p className="mt-1.5">{v.reason}</p>
        <Sources label="New knowledge: what was said" count={nq.length}><QuotedMessages messages={nq} /></Sources>
        <Sources label="Existing knowledge: what was said" count={oq.length}><QuotedMessages messages={oq} /></Sources>
      </li>
    )
  }
  return (
    <div className="space-y-2">
      {relevant.length > 0 && <ul className="space-y-2">{relevant.map((v, i) => <Row key={i} v={v} />)}</ul>}
      {unrelated > 0 && <p className="text-xs text-muted">{unrelated} other {unrelated === 1 ? 'piece' : 'pieces'} of stored knowledge {unrelated === 1 ? 'was' : 'were'} compared and found unrelated.</p>}
    </div>
  )
}
