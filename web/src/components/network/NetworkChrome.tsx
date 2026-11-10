// The quiet chrome above the topology canvas and the `Sites` rail beside it.
import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import type { CompanyState, HealthStatus, Incident } from '../../api/types'
import { cn } from '../../lib/cn'
import { useLive } from '../../store/live'
import { HEALTH_ORDER, HEALTH_STYLE, healthCounts } from '../company/status'
import { validAt } from '../graph/graphModel'
import { incidentOpenAt } from '../timeline/timelineModel'
import { Input } from '../ui'

/** One line: current health at now, or the incident count at the chosen time (never mixed). */
export function NetworkHealthStrip({ company, incidents, at, now }: { company: CompanyState | null; incidents: Record<string, Incident>; at: Date; now: Date }) {
  const elements = useLive((s) => s.elements)
  const counts = useMemo(() => (company ? healthCounts(company, elements) : null), [company, elements])
  const open = useMemo(() => Object.values(incidents).filter((i) => incidentOpenAt(i, at)).length, [incidents, at])
  if (at.getTime() !== now.getTime()) {
    return (
      <div className="diagram-status">
        {open} incidents at {format(at, 'HH:mm')}
      </div>
    )
  }
  if (!counts) return <div className="diagram-status">{open} incidents</div>
  const total = HEALTH_ORDER.reduce((n, k) => n + (counts[k] ?? 0), 0) || 1
  const pct = Math.round(((counts.healthy ?? 0) / total) * 100)
  return (
    <div className="diagram-status">
      {pct}% healthy · {open} incidents
    </div>
  )
}

/** Sites with their equipment and rules in force at `at`; typing switches to matching equipment. */
export function SitesList({ at, selectedId, onSelect, company }: { at: Date; selectedId: string | null; onSelect: (id: string) => void; company: CompanyState | null }) {
  const sites = useLive((s) => s.sites)
  const elements = useLive((s) => s.elements)
  const assertions = useLive((s) => s.assertions)
  const [q, setQ] = useState('')

  const siteHealth = useMemo(() => {
    const map = new Map<string, HealthStatus>()
    for (const h of company?.health ?? []) {
      const site = elements.find((e) => e.id === h.element_id)?.site_id
      if (!site) continue
      const current = map.get(site)
      map.set(site, current && HEALTH_ORDER.indexOf(current) <= HEALTH_ORDER.indexOf(h.status) ? current : h.status)
    }
    return map
  }, [company, elements])

  const rows = useMemo(() => {
    const inForce = Object.values(assertions).filter((a) => validAt(a, at))
    return sites.map((s) => {
      const els = elements.filter((e) => e.site_id === s.id)
      const ids = new Set([s.id, ...els.map((e) => e.id)])
      const rules = inForce.filter((a) => a.bound_to.some((b) => ids.has(b.entity))).length
      return { id: s.id, title: s.name, health: siteHealth.get(s.id) ?? 'healthy', detail: `${els.length} eq · ${rules} rules` }
    })
  }, [sites, elements, assertions, at, siteHealth])

  const needle = q.trim().toLowerCase()
  const matches = useMemo(
    () =>
      needle
        ? elements
            .filter((e) => `${e.id} ${e.model} ${sites.find((s) => s.id === e.site_id)?.name ?? ''}`.toLowerCase().includes(needle))
            .map((e) => ({ id: e.id, title: e.id, health: company?.health.find((h) => h.element_id === e.id)?.status ?? 'healthy', detail: `${e.model} · ${sites.find((s) => s.id === e.site_id)?.name ?? 'No site'}` }))
        : rows,
    [needle, elements, sites, rows, company],
  )

  return (
    <div className="p-4">
      <h3 className="mb-3 font-semibold">Sites</h3>
      <Input aria-label="Search equipment" placeholder="Search equipment" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 divide-y divide-line">
        {matches.map((r) => (
          <button key={r.id} onClick={() => onSelect(r.id)} aria-pressed={r.id === selectedId} className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-md py-2.5 text-left hover:bg-surface-2', r.id === selectedId && 'bg-accent-soft/40')}>
            {company && <span className={cn('size-2 shrink-0 rounded-full', HEALTH_STYLE[r.health].dot)} aria-hidden />}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{r.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">{r.detail}</span>
            </span>
          </button>
        ))}
      </div>
      {!matches.length && <p className="py-4 text-sm text-muted">No matching equipment.</p>}
    </div>
  )
}
