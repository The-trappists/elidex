import { Pencil } from 'lucide-react'
import type { CriticVerdict, ExtractedItem } from '../../api/types'
import { TRUST_STYLE } from '../../lib/semantic'
import { TypeBadge } from '../knowledge/bits'
import { Badge, Button, IdChip } from '../ui'
import { CriticBadge } from './Verdicts'

export function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`confidence ${Math.round(value * 100)}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted">{Math.round(value * 100)}%</span>
    </div>
  )
}

/** One extracted item as a card (used in the job drawer). */
export function ItemCard({ item, active, onHover, verdict, onEdit }: { item: ExtractedItem; active?: boolean; onHover?: (on: boolean) => void; verdict?: CriticVerdict; onEdit?: () => void }) {
  const sc = item.scope
  return (
    <div
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={`rounded-md border bg-surface p-3 text-[13px] transition ${active ? 'border-accent ' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <TypeBadge type={item.type} />
        <span className="font-semibold">{item.topic}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {verdict && <CriticBadge v={verdict} />}
          <Badge className={TRUST_STYLE[item.trust_level].cls}>{TRUST_STYLE[item.trust_level].label}</Badge>
        </span>
      </div>
      <p className="mt-1.5 text-muted">{item.summary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-xs text-muted">Scope</span>
        {sc.instance_ids.map((i) => <IdChip key={i}>{i}</IdChip>)}
        {sc.site_ids.map((i) => <IdChip key={i}>{i}</IdChip>)}
        {sc.element_class && <Badge className="bg-surface-2 text-muted">class: {[sc.element_class.type, sc.element_class.model, sc.element_class.install_year_min != null || sc.element_class.install_year_max != null ? `${sc.element_class.install_year_min ?? ''}–${sc.element_class.install_year_max ?? ''}` : null].filter(Boolean).join(' · ') || 'any'}</Badge>}
        {sc.trigger && <Badge className="bg-surface-2 text-muted">trigger: {sc.trigger}</Badge>}
      </div>
      {item.conditions.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="text-muted">Conditions: </span>
          {item.conditions.map((c, i) => <span key={i} className="mr-1.5 rounded bg-surface-2 px-1 py-0.5">{c.text}{c.check ? ` (${c.check.field} ${c.check.op} ${String(c.check.value)})` : ''}</span>)}
        </div>
      )}
      {item.action && <div className="mt-1.5 text-xs"><span className="text-muted">Action: </span>{item.action}</div>}
      {item.avoid.length > 0 && <div className="mt-1 text-xs"><span className="text-bad">Avoid: </span>{item.avoid.join('; ')}</div>}
      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        <span>stated by <b className="font-medium text-text">{item.stated_by}</b></span>
        {item.cited_seq.length > 0 && <span>msgs #{item.cited_seq.join(', #')}</span>}
        <span className="ml-auto"><ConfidenceBar value={item.confidence} /></span>
      </div>
      {onEdit && (
        <div className="mt-2 border-t border-line pt-2">
          <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={onEdit}>Edit and re-run from link</Button>
        </div>
      )}
    </div>
  )
}
