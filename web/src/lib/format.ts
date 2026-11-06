import { format, formatDistanceStrict } from 'date-fns'

/** "2026-10-15 09:14" from an ISO string (sim or wall). */
export const fmtDateTime = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'yyyy-MM-dd HH:mm') : '—')
export const fmtTime = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'HH:mm:ss') : '—')
export const fmtDate = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'yyyy-MM-dd') : '—')
export const fmtMs = (ms: number | null | undefined) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
export const fmtAgo = (iso: string, now: Date) => formatDistanceStrict(new Date(iso), now, { addSuffix: true })
/** ISO string without timezone (what the backend expects for sim times). */
export const toNaiveIso = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm:ss")
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
