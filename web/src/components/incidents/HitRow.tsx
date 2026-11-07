import { TRUST_STYLE, TYPE_STYLE } from '../../lib/semantic'
import type { ContextHit } from '../../api/types'
import { Badge } from '../ui'

/** Compact line for a context hit: type, summary, how it matched, trust. */
export function HitRow({ hit, onClick }: { hit: ContextHit; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-md border border-line bg-surface p-2 text-xs ${onClick ? 'cursor-pointer hover:border-accent' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className={TYPE_STYLE[hit.type].cls}>{TYPE_STYLE[hit.type].label}</Badge>
        <span className="font-semibold">{hit.topic}</span>
        <Badge className={`${TRUST_STYLE[hit.trust.level].cls} ml-auto`}>{TRUST_STYLE[hit.trust.level].label}</Badge>
      </div>
      <p className="mt-1 leading-snug text-muted">{hit.summary}</p>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
        <span className="rounded bg-surface-2 px-1 py-0.5 font-mono">via {hit.matched_via}</span>
        <span>{hit.trust.stated_by}</span>
        <span className="ml-auto font-mono">{hit.id}</span>
      </div>
    </div>
  )
}
