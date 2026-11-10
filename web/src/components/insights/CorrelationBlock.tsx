// The correlations that mention one node, as shown at the top of the Inspector and the knowledge details.
import type { Pattern } from '../../api/types'
import { LEVEL_CLS, LEVEL_LABEL, seenText } from './meta'

export function CorrelationBlock({ id, patterns, onOpen, className }: { id: string; patterns?: Pattern[]; onOpen?: (p: Pattern) => void; className?: string }) {
  const mine = (patterns ?? []).filter((p) => p.elements.includes(id) || p.suspects.includes(id) || p.occurrences.some((o) => o.assertion_id === id))
  if (!mine.length) return null
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-1.5">
        <h4 className="text-xs font-medium text-muted">Correlation</h4>
        <span className="rounded bg-surface-2 px-1 text-xs text-muted">{mine.length}</span>
      </div>
      <ul className="space-y-1.5">
        {mine.slice(0, 2).map((p) => (
          <li key={p.id} className="rounded-md border border-line p-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${LEVEL_CLS[p.level]}`}>{LEVEL_LABEL[p.level]}</span>
              <span className="ml-auto text-muted">{seenText(p)}</span>
            </div>
            <p className="mt-1 break-words">{p.headline}</p>
            {onOpen && (
              <button className="mt-1 text-accent hover:underline" onClick={() => onOpen(p)}>
                Open correlation
              </button>
            )}
          </li>
        ))}
        {mine.length > 2 && <li className="text-xs text-muted">+{mine.length - 2} more</li>}
      </ul>
    </div>
  )
}
