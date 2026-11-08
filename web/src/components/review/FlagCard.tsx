// One flag. Compact in the list; the selected one opens to show quotes, why the loop was unsure and every link.
import { ChevronDown, ExternalLink, MessageSquare, Network, Pencil, Waypoints } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ContextAssertion, ReviewFlag, WbSite } from '../../api/types'
import { STAGES } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtAgo } from '../../lib/format'
import { FLAG_META, flagSource, SOURCE_HELP, SOURCE_LABEL, type FlagContext, type FlagScope } from '../../lib/review'
import { STAGE_LABEL, TRUST_STYLE } from '../../lib/semantic'
import { assertionHref, CopyId, threadHref } from '../knowledge/bits'
import { Badge, Button, IdChip } from '../ui'
import { QuotedMessages } from './Quote'
import { WhyUnsure } from './WhyUnsure'

const networkHref = (id: string) => `/network?select=${encodeURIComponent(id)}`
const graphHref = (id: string) => `/graph?focus=${encodeURIComponent(id)}`

function Chips({ scope, sites, max }: { scope: FlagScope; sites: WbSite[]; max?: number }) {
  const { els, siteIds, cls } = scope
  if (!els.length && !siteIds.length && !cls.length) return null
  const shown = max ? els.slice(0, max) : els
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Equipment and sites involved">
      {shown.map((e) => (
        <Link key={e} to={networkHref(e)} title="Show on the Network page" onClick={(ev) => ev.stopPropagation()}><IdChip className="min-h-6 hover:border-accent">{e}</IdChip></Link>
      ))}
      {max && els.length > max && <span className="text-xs text-muted">+{els.length - max} more</span>}
      {siteIds.map((id) => <Badge key={id} className="bg-surface-2 text-muted">{sites.find((s) => s.id === id)?.name ?? id}</Badge>)}
      {cls.map((c) => <Badge key={c} className="max-w-full whitespace-normal break-words bg-surface-2 text-muted">class: {c}</Badge>)}
    </div>
  )
}

/** One side of a disagreement: who said it, what they advise, how sure the system is, and how to act on it. */
function Advice({ a, onEdit }: { a: ContextAssertion; onEdit: () => void }) {
  return (
    <div className="flex min-w-0 flex-col rounded-md border border-line bg-surface-2 p-3" aria-label={`Advice from ${a.trust.stated_by}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <b className="font-semibold text-text">{a.trust.stated_by} says</b>
        <Badge className={TRUST_STYLE[a.trust.level].cls}>{TRUST_STYLE[a.trust.level].label}</Badge>
        <CopyId id={a.id} />
      </div>
      <p className="mt-1.5 text-sm leading-snug">{a.action ?? a.summary}</p>
      {a.avoid.length > 0 && <p className="mt-1 text-[13px] leading-snug text-muted">Avoid: {a.avoid.join('; ')}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2.5">
        <Link to={assertionHref(a.id)} onClick={(e) => e.stopPropagation()}>
          <Button size="sm" icon={<ExternalLink size={13} />}>Open knowledge item</Button>
        </Link>
        <Link to={graphHref(a.id)} onClick={(e) => e.stopPropagation()}>
          <Button size="sm" icon={<Waypoints size={13} />}>Show in graph</Button>
        </Link>
        <Button size="sm" icon={<Pencil size={13} />} onClick={(e) => { e.stopPropagation(); onEdit() }}>Edit</Button>
      </div>
    </div>
  )
}

export function FlagCard({
  flag, ctx, scope, sites, now, selected, dismissed, isNew, canEdit, subject, onSelect, onDismiss, onRestore, onEdit, onEditAssertion,
}: {
  flag: ReviewFlag
  ctx: FlagContext
  scope: FlagScope
  sites: WbSite[]
  now: Date
  selected: boolean
  dismissed: boolean
  isNew: boolean
  canEdit: boolean
  /** Conversation name, shown when the list is not already grouped by conversation. */
  subject?: string
  onSelect: () => void
  onDismiss: () => void
  onRestore: () => void
  onEdit: () => void
  onEditAssertion: (id: string) => void
}) {
  const meta = FLAG_META[flag.kind]
  const Icon = meta.icon
  const src = flagSource(flag)
  const stepNo = STAGES.indexOf(meta.step) + 1
  const call = ctx.job?.llm_call_ids[0]
  const sideBySide = flag.kind === 'conflict' && ctx.pair.length === 2
  const knowledgeId = ctx.assertion?.id ?? flag.assertion_id
  const nextStep = {
    conflict: 'Compare the two accounts with the conversation. Edit a knowledge item if you can clarify the disagreement.',
    over_reach: 'Check that the equipment and conditions match what was actually said. Edit the finding if the scope needs correcting.',
    critic_rejected: 'Read the source to check whether useful knowledge was missed. Edit the finding if a correction is needed.',
    judge_decision: 'Check the conversation if you want to verify the change to older knowledge.',
    low_confidence: 'Compare the saved advice with its source. Edit it if you have a more precise account.',
    abstained: 'Open the conversation to check which equipment was meant. Edit the finding if one is available.',
    operator_edit: 'Open the knowledge item to inspect the edit and its history.',
  }[flag.kind]
  return (
    <article
      data-flag={flag.id}
      aria-label={flag.message}
      aria-current={selected || undefined}
      tabIndex={0}
      onClick={onSelect}
      onFocus={onSelect}
      className={cn(
        'scroll-mt-12 rounded-lg border bg-surface p-3 outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected ? 'border-accent ring-2 ring-accent/25' : 'cursor-pointer border-line hover:border-accent/50',
        dismissed && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap sm:gap-3">
        <Icon size={16} className={cn('mt-0.5 shrink-0', meta.tone)} aria-hidden />
        <div className="min-w-0 flex-1 basis-48">
          <p className={cn('break-words text-sm font-medium leading-snug', !selected && 'line-clamp-2')}>{flag.message}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <Badge title={SOURCE_HELP[src]}>{SOURCE_LABEL[src]}</Badge>
            {subject && <span className="min-w-0 max-w-full truncate">{subject}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted">
          {isNew && <Badge className="bg-accent-soft text-accent">New</Badge>}
          {dismissed && <Badge>Dismissed</Badge>}
          <span title={flag.created_at} className="whitespace-nowrap">{fmtAgo(flag.created_at, now)}</span>
          <button type="button" aria-label={selected ? 'Selected flag' : 'Show details'} aria-expanded={selected} onClick={(e) => { e.stopPropagation(); onSelect() }} className="flex size-8 items-center justify-center rounded hover:bg-surface-2">
            <ChevronDown size={16} className={cn('transition-transform', selected && 'rotate-180')} />
          </button>
        </div>
      </div>

      {!selected && (
        <div className="mt-2 sm:pl-7"><Chips scope={scope} sites={sites} max={4} /></div>
      )}

      {selected && (
        <div className="mt-2.5 space-y-2.5 sm:pl-7">
          <Chips scope={scope} sites={sites} />
          <div className="rounded-md border border-accent/25 bg-accent-soft p-3">
            <h3 className="text-sm font-semibold">What you can do <span className="ml-1 text-xs font-normal text-muted">Optional</span></h3>
            <p className="mt-1 text-sm leading-relaxed">{nextStep}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link to={threadHref(flag.thread_id)} onClick={(e) => e.stopPropagation()} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-on-accent hover:opacity-90"><MessageSquare size={13} /> Read conversation</Link>
              {!sideBySide && canEdit && <Button size="sm" icon={<Pencil size={13} />} onClick={(e) => { e.stopPropagation(); onEdit() }}>Edit finding</Button>}
              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); if (dismissed) onRestore(); else onDismiss() }}>{dismissed ? 'Restore flag' : 'Dismiss flag'}</Button>
            </div>
          </div>
          <p className="break-words text-sm leading-relaxed text-muted">{flag.detail ?? meta.why}</p>
          {sideBySide && (
            <div className="grid gap-2.5 md:grid-cols-2">
              {ctx.pair.map((a) => <Advice key={a.id} a={a} onEdit={() => onEditAssertion(a.id)} />)}
            </div>
          )}
          <section className="border-t border-line pt-3" aria-label="Source evidence">
            <h3 className="mb-2 text-xs font-semibold text-muted">From the conversation</h3>
            {ctx.quotes.length ? <QuotedMessages messages={ctx.quotes} /> : <p className="text-sm text-muted">No source excerpt available. Open the conversation for context.</p>}
          </section>

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {knowledgeId && !sideBySide && (
              <>
                <Link to={assertionHref(knowledgeId)} onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" icon={<ExternalLink size={13} />}>Open knowledge item</Button>
                </Link>
                <Link to={graphHref(knowledgeId)} onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" icon={<Waypoints size={13} />}>Show in graph</Button>
                </Link>
              </>
            )}
            {scope.els[0] && (
              <Link to={networkHref(scope.els[0])} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" icon={<Network size={13} />}>Show on network</Button>
              </Link>
            )}

          </div>
          <details className="border-t border-line pt-2" onClick={(e) => e.stopPropagation()}>
            <summary className="min-h-8 cursor-pointer py-1.5 text-xs font-medium text-muted">Reasoning & technical details</summary>
            <div className="space-y-3 pt-2">
              {knowledgeId && !sideBySide && <WhyUnsure id={knowledgeId} />}
              <dl className="grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-muted">Found by</dt>
                <dd className="leading-snug">{SOURCE_LABEL[src]}. <span className="text-muted">{SOURCE_HELP[src]}</span></dd>
                <dt className="text-muted">Step</dt>
                <dd>
                  <span className="font-medium">{stepNo}. {STAGE_LABEL[meta.step]}</span>
                  {call && (
                    <Link to={`/llm?call=${encodeURIComponent(call)}`} className="ml-2 text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                      request {call}
                    </Link>
                  )}
                </dd>
              </dl>

              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-label="Ids">
                <span>Flag</span><CopyId id={flag.id} />
                {knowledgeId && <><span>Knowledge</span><CopyId id={knowledgeId} /></>}
                <span>Conversation</span><CopyId id={flag.thread_id} />
              </div>
            </div>
          </details>
        </div>
      )}
    </article>
  )
}
