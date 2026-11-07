import { Network } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CompanyState, HealthStatus } from '../../api/types'
import { cn } from '../../lib/cn'
import { useLive } from '../../store/live'
import { Badge, EmptyState } from '../ui'
import { HEALTH_ORDER, HEALTH_STYLE, fmtHM } from './status'

/** Bar with one segment per status, from the counts of the latest cycle (or computed when there is none yet). */
function SummaryBar({ counts }: { counts: Record<string, number> }) {
  const total = HEALTH_ORDER.reduce((n, k) => n + (counts[k] ?? 0), 0) || 1
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
        {HEALTH_ORDER.map((k) => (counts[k] ? <span key={k} className={cn('transition-[width] duration-500', HEALTH_STYLE[k].dot)} style={{ width: `${(counts[k] / total) * 100}%` }} /> : null))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        {HEALTH_ORDER.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', HEALTH_STYLE[k].dot)} />
            {HEALTH_STYLE[k].label} <span className="font-medium tabular-nums text-text">{counts[k] ?? 0}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function NetworkStatus({ c }: { c: CompanyState }) {
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const flash = useLive((s) => s.healthFlash)
  const [picked, setPicked] = useState<string | null>(null)

  const counts = useMemo(() => {
    const latest = c.cycles[c.cycles.length - 1]?.health_counts
    const own: Record<string, number> = { healthy: elements.length, degraded: 0, down: 0, recovering: 0 }
    for (const h of c.health) if (h.status !== 'healthy') {
      own[h.status] += 1
      own.healthy -= 1
    }
    return { ...own, ...(latest ?? {}) }
  }, [c.cycles, c.health, elements.length])

  const groups = useMemo(() => {
    const siteOf = new Map(elements.map((e) => [e.id, e.site_id]))
    const name = new Map(sites.map((s) => [s.id, s.name]))
    const by = new Map<string, typeof c.health>()
    for (const h of c.health) {
      const sid = siteOf.get(h.element_id) ?? 'unknown'
      by.set(sid, [...(by.get(sid) ?? []), h])
    }
    return [...by.entries()].map(([sid, list]) => ({ sid, name: name.get(sid) ?? 'Unknown site', list: list.sort((a, b) => a.element_id.localeCompare(b.element_id)) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [c, elements, sites])

  const sel = c.health.find((h) => h.element_id === picked)
  const ok = elements.length > 0 && !c.health.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <SummaryBar counts={counts} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!groups.length ? (
          <EmptyState icon={<Network size={24} />} title={ok ? 'Every element is healthy' : 'No status changes yet'} hint="Elements show up here once the autonomous system sees them leave the healthy state." />
        ) : (
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <li key={g.sid} className="px-4 py-2.5">
                <div className="mb-1.5 truncate text-xs font-medium text-muted">{g.name}</div>
                <div className="flex flex-wrap gap-2">
                  {g.list.map((h) => {
                    const st = HEALTH_STYLE[h.status as HealthStatus]
                    const f = flash[h.element_id]
                    const isNew = f != null && Date.now() - f < 4000
                    return (
                      <button
                        key={h.element_id}
                        onClick={() => setPicked(picked === h.element_id ? null : h.element_id)}
                        title={`${h.element_id}: ${st.label}. ${h.reason}`}
                        aria-pressed={picked === h.element_id}
                        className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs transition-colors hover:bg-surface-2', picked === h.element_id ? 'border-accent bg-accent-soft' : 'border-line')}
                      >
                        <span key={f ?? 0} className={cn('size-2.5 rounded-full', st.dot, isNew && 'status-flash')} />
                        {h.element_id}
                      </button>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {sel && (
        <div className="shrink-0 animate-fade-in border-t border-line bg-surface-2 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium">{sel.element_id}</span>
            <Badge className={HEALTH_STYLE[sel.status].chip}>{HEALTH_STYLE[sel.status].label}</Badge>
            <span className="ml-auto text-muted">since {fmtHM(sel.since)}</span>
          </div>
          <p className="mt-1 leading-snug">{sel.reason}</p>
          {sel.recommendation && <p className="mt-1 leading-snug text-muted">Recommendation: {sel.recommendation}</p>}
        </div>
      )}
    </div>
  )
}
