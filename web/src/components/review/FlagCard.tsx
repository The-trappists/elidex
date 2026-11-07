import { ExternalLink, EyeOff, MessageSquare, Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ElementClass, ReviewFlag, WbSite } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtAgo } from '../../lib/format'
import { FLAG_META, type FlagContext } from '../../lib/review'
import { STAGE_LABEL } from '../../lib/semantic'
import { STAGES } from '../../api/types'
import { criteriaText } from '../chat/ItemCard'
import { assertionHref, threadHref } from '../knowledge/bits'
import { Badge, Button, IdChip } from '../ui'
import { QuotedMessages } from './Quote'

const Kbd = ({ children }: { children: string }) => (
  <kbd aria-hidden className="ml-0.5 rounded border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-muted">{children}</kbd>
)

function Chips({ ctx, sites, classes }: { ctx: FlagContext; sites: WbSite[]; classes: Record<string, ElementClass> }) {
  const els: string[] = []
  const siteIds: string[] = []
  const cls: string[] = []
  if (ctx.item) {
    els.push(...ctx.item.scope.instance_ids)
    siteIds.push(...ctx.item.scope.site_ids)
    if (ctx.item.scope.element_class) cls.push(criteriaText(ctx.item.scope.element_class))
  } else if (ctx.assertion) {
    for (const b of ctx.assertion.bound_to) {
      if (classes[b.entity]) cls.push(classes[b.entity].label)
      else if (sites.some((s) => s.id === b.entity)) siteIds.push(b.entity)
      else els.push(b.entity)
    }
  }
  if (!els.length && !siteIds.length && !cls.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Equipment and sites involved">
      {els.map((e) => <IdChip key={e}>{e}</IdChip>)}
      {siteIds.map((id) => <Badge key={id} className="bg-surface-2 text-muted">{sites.find((s) => s.id === id)?.name ?? id}</Badge>)}
      {cls.map((c) => <Badge key={c} className="bg-surface-2 text-muted">class: {c}</Badge>)}
    </div>
  )
}

export function FlagCard({
  flag, ctx, sites, classes, now, selected, dismissed, fresh, canEdit, onSelect, onDismiss, onEdit,
}: {
  flag: ReviewFlag
  ctx: FlagContext
  sites: WbSite[]
  classes: Record<string, ElementClass>
  now: Date
  selected: boolean
  dismissed: boolean
  fresh: boolean
  canEdit: boolean
  onSelect: () => void
  onDismiss: () => void
  onEdit: () => void
}) {
  const meta = FLAG_META[flag.kind]
  const Icon = meta.icon
  const stepNo = STAGES.indexOf(meta.step) + 1
  const call = ctx.job?.llm_call_ids[0]
  return (
    <article
      data-flag={flag.id}
      aria-label={flag.message}
      aria-current={selected || undefined}
      onClick={onSelect}
      className={cn(
        'scroll-mt-12 rounded-lg border bg-surface p-4 transition-shadow',
        selected ? 'border-accent ring-2 ring-accent/25' : 'border-line',
        dismissed && 'opacity-60',
        fresh && 'animate-slide-in',
      )}
    >
      <div className="flex items-start gap-3">
        <Icon size={16} className={cn('mt-0.5 shrink-0', meta.tone)} aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{flag.message}</p>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          {fresh && <Badge className="bg-surface-3 text-text">New</Badge>}
          {dismissed && <Badge>Dismissed</Badge>}
          <span title={flag.created_at}>{fmtAgo(flag.created_at, now)}</span>
        </div>
      </div>

      <div className="mt-2.5 space-y-2.5 pl-7">
        <Chips ctx={ctx} sites={sites} classes={classes} />
        <QuotedMessages messages={ctx.quotes} />
        <dl className="grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">Step</dt>
          <dd>
            <span className="font-medium">{stepNo}. {STAGE_LABEL[meta.step]}</span>
            {call && (
              <Link to={`/llm?call=${encodeURIComponent(call)}`} className="ml-2 text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                request {call}
              </Link>
            )}
          </dd>
          <dt className="text-muted">Why</dt>
          <dd className="min-w-0 leading-snug">{flag.detail ?? meta.why}</dd>
        </dl>

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Link to={threadHref(flag.thread_id)} onClick={(e) => e.stopPropagation()}>
            <Button size="sm" icon={<MessageSquare size={13} />}>Open thread <Kbd>↵</Kbd></Button>
          </Link>
          {flag.assertion_id && (
            <Link to={assertionHref(flag.assertion_id)} onClick={(e) => e.stopPropagation()}>
              <Button size="sm" icon={<ExternalLink size={13} />}>Open knowledge item</Button>
            </Link>
          )}
          <Button size="sm" icon={<Pencil size={13} />} disabled={!canEdit} title={canEdit ? undefined : 'There is nothing saved to edit for this one'} onClick={(e) => { e.stopPropagation(); onEdit() }}>
            Edit <Kbd>e</Kbd>
          </Button>
          {!dismissed && (
            <Button size="sm" variant="ghost" className="ml-auto" icon={<EyeOff size={13} />} onClick={(e) => { e.stopPropagation(); onDismiss() }}>
              Dismiss <Kbd>d</Kbd>
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}
