import type { ClassCriteria, ExtractedItem } from '../../api/types'
import { cn } from '../../lib/cn'
import { TYPE_STYLE } from '../../lib/semantic'
import { TrustBadge, TypeBadge } from '../knowledge/bits'
import { IdChip } from '../ui'

export function criteriaText(c: ClassCriteria): string {
  const parts: string[] = []
  if (c.type) parts.push(c.type)
  if (c.model) parts.push(c.model)
  if (c.install_year_min != null || c.install_year_max != null) parts.push(`${c.install_year_min ?? '…'}–${c.install_year_max ?? '…'}`)
  return parts.join(' · ') || 'any element'
}

/** One extracted item (before linking), as the parser returned it. */
export function ItemCard({ item, highlighted, onHover }: { item: ExtractedItem; highlighted?: boolean; onHover?: (on: boolean) => void }) {
  const s = item.scope
  return (
    <div
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={cn('rounded-md border border-line border-l-[3px] bg-surface p-2.5 text-[13px] transition', highlighted && 'ring-2 ring-accent/50 bg-accent-soft')}
      style={{ borderLeftColor: TYPE_STYLE[item.type].hex }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <TypeBadge type={item.type} />
        <span className="font-semibold">{item.topic}</span>
        <span className="ml-auto text-[13px] text-muted" title="As extracted, before the second check and linking">Confidence {Math.round(item.confidence * 100)}%</span>
      </div>
      <p className="mt-1.5 text-text">{item.summary}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {s.instance_ids.map((x) => <IdChip key={x}>{x}</IdChip>)}
        {s.site_ids.map((x) => <IdChip key={x}>site:{x}</IdChip>)}
        {s.element_class && <IdChip>class: {criteriaText(s.element_class)}</IdChip>}
        {s.trigger && <IdChip>trigger: {s.trigger}</IdChip>}
      </div>
      {item.conditions.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted">
          {item.conditions.map((c, i) => (
            <li key={i}>
              {c.text}
              {c.check && <code className="ml-1 rounded bg-surface-2 px-1 font-mono text-[13px]">{c.check.field} {c.check.op} {JSON.stringify(c.check.value)}</code>}
            </li>
          ))}
        </ul>
      )}
      {item.diagnosis && <Line k="Diagnosis" v={item.diagnosis} />}
      {item.action && <Line k="Action" v={item.action} />}
      {item.fact && <Line k="Fact" v={item.fact} />}
      {item.avoid.length > 0 && <Line k="Avoid" v={item.avoid.join('; ')} />}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        <TrustBadge level={item.trust_level} labelled />
        <span>by {item.stated_by}</span>
        {item.cited_seq.length > 0 && <span>msgs {item.cited_seq.map((q) => `#${q}`).join(' ')}</span>}
      </div>
      {item.evidence && <div className="mt-1 text-[13px] italic text-muted">"{item.evidence}"</div>}
    </div>
  )
}

const Line = ({ k, v }: { k: string; v: string }) => (
  <div className="mt-1">
    <span className="font-medium text-muted">{k}: </span>
    {v}
  </div>
)
