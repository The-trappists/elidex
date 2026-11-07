import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import type { ContextAssertion } from '../../api/types'
import { fmtDateTime } from '../../lib/format'
import { TYPE_STYLE } from '../../lib/semantic'
import { EmptyState } from '../ui'
import { TrustBadge, TypeBadge } from './bits'

const LABEL_W = 220

export function Timeline({ rows, now, onOpen }: { rows: ContextAssertion[]; now: Date | null; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState<ContextAssertion | null>(null)

  const { min, max, ticks, groups } = useMemo(() => {
    const times: number[] = []
    for (const a of rows) {
      times.push(new Date(a.valid_from).getTime())
      if (a.valid_to) times.push(new Date(a.valid_to).getTime())
    }
    if (now) times.push(now.getTime())
    const lo = Math.min(...times)
    const hi = Math.max(...times)
    const span = Math.max(hi - lo, 3600_000)
    const min = lo - span * 0.03
    const max = hi + span * 0.12
    const ticks = Array.from({ length: 7 }, (_, i) => min + ((max - min) * i) / 6)
    const g = new Map<string, ContextAssertion[]>()
    for (const a of [...rows].sort((x, y) => x.valid_from.localeCompare(y.valid_from))) g.set(a.topic, [...(g.get(a.topic) ?? []), a])
    return { min, max, ticks, groups: [...g.entries()] }
  }, [rows, now])

  if (!rows.length) return <EmptyState icon={<History size={28} />} title="Nothing on the timeline" hint="No knowledge matches the filters." />

  const pct = (t: number) => ((t - min) / (max - min)) * 100
  const fmtTick = (t: number) => format(new Date(t), (max - min) > 3 * 86400_000 ? 'MMM d' : 'MMM d HH:mm')
  const nowPct = now ? pct(now.getTime()) : null

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-2">
        <div className="min-w-[760px]">
          {/* axis */}
          <div className="sticky top-0 z-10 flex border-b border-line bg-bg py-2 text-xs text-muted">
            <div style={{ width: LABEL_W }} className="shrink-0" />
            <div className="relative h-4 flex-1">
              {ticks.map((t, i) => (
                <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pct(t)}%` }}>
                  {fmtTick(t)}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            {/* grid + now line sit over the track area only */}
            <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: LABEL_W }}>
              {ticks.map((t, i) => (
                <div key={i} className="absolute inset-y-0 border-l border-line/50" style={{ left: `${pct(t)}%` }} />
              ))}
              {nowPct !== null && (
                <div className="absolute inset-y-0 z-10 border-l-2 border-bad" style={{ left: `${nowPct}%` }}>
                  <span className="absolute -top-0 left-1 rounded bg-bad px-1 text-xs font-medium text-white">now</span>
                </div>
              )}
            </div>
            {groups.map(([topic, items]) => (
              <div key={topic} className="border-b border-line/60 py-1.5">
                <div className="mb-0.5 text-xs font-semibold text-muted">{topic}</div>
                {items.map((a) => {
                  const color = TYPE_STYLE[a.type].hex
                  const l = pct(new Date(a.valid_from).getTime())
                  const r = a.valid_to ? pct(new Date(a.valid_to).getTime()) : 100
                  return (
                    <div key={a.id} className="flex h-7 items-center">
                      <div style={{ width: LABEL_W }} className="shrink-0 truncate pr-3 text-xs" title={a.summary}>
                        <span className="font-mono text-xs text-muted">{a.id}</span> {a.bound_to[0]?.entity}
                      </div>
                      <div className="relative h-full flex-1">
                        <button
                          onMouseEnter={() => setHover(a)}
                          onMouseLeave={() => setHover(null)}
                          onClick={() => onOpen(a.id)}
                          className="absolute top-1.5 flex h-4 items-center justify-end rounded-sm pr-0.5 text-xs text-white hover:brightness-110"
                          style={{
                            left: `${l}%`,
                            width: `max(${Math.max(r - l, 0)}%, 6px)`,
                            background: a.valid_to ? color : `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 15%, transparent))`,
                          }}
                        >
                          {!a.valid_to && <span className="text-text opacity-70">→</span>}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="h-16 shrink-0 border-t border-line bg-surface px-4 py-2 text-xs">
        {hover ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <TypeBadge type={hover.type} />
              <span className="font-medium">{hover.topic}</span>
              <TrustBadge level={hover.trust.level} />
              <span className="font-mono text-xs text-muted">{hover.id}</span>
            </div>
            <div className="truncate text-muted">{hover.summary}</div>
            <div className="text-muted">
              {fmtDateTime(hover.valid_from)} → {hover.valid_to ? fmtDateTime(hover.valid_to) : 'still valid'}
              {hover.closed_by && ` (closed by ${hover.closed_by})`}
            </div>
          </div>
        ) : (
          <span className="text-muted">Hover a bar for details, click it to open. Bars fade out with an arrow when the knowledge has no end date. The red line is the simulated now.</span>
        )}
      </div>
    </div>
  )
}
