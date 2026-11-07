import { format } from 'date-fns'
import type { CompanyState, HealthStatus } from '../../api/types'

/** Health colors: only status uses color (ok, warn, bad) and the accent for "recovering". */
export const HEALTH_STYLE: Record<HealthStatus, { label: string; dot: string; text: string; chip: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-ok', text: 'text-ok', chip: 'bg-ok/15 text-ok' },
  degraded: { label: 'Degraded', dot: 'bg-warn', text: 'text-warn', chip: 'bg-warn/15 text-warn' },
  down: { label: 'Down', dot: 'bg-bad', text: 'text-bad', chip: 'bg-bad/15 text-bad' },
  recovering: { label: 'Recovering', dot: 'bg-accent', text: 'text-accent', chip: 'bg-accent-soft text-accent' },
}

export const HEALTH_ORDER: HealthStatus[] = ['down', 'degraded', 'recovering', 'healthy']

/** "09:40" from a sim ISO string. */
export const fmtHM = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'HH:mm') : '—')

/** Calls summed over the cycles: the store keeps only the newest 200 calls, so calls.length plateaus. */
export const callCount = (c: Pick<CompanyState, 'calls' | 'cycles'>) => Math.max(c.calls.length, c.cycles.reduce((n, x) => n + x.agent_call_ids.length, 0))

