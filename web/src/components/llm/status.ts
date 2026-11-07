import type { LlmCall } from '../../api/types'

export type CallStatus = 'ok' | 'api_error' | 'parse_error'
export const STATUS_LABEL: Record<CallStatus, { label: string; cls: string }> = {
  ok: { label: 'Succeeded', cls: 'text-muted' },
  api_error: { label: 'Failed', cls: 'text-bad' },
  parse_error: { label: 'Unusable answer', cls: 'text-warn' },
}

export const callStatus = (c: LlmCall): CallStatus => (c.error ? 'api_error' : c.parse_error || c.parsed_ok === false ? 'parse_error' : 'ok')

export const isProblem = (c: LlmCall) => callStatus(c) !== 'ok'

/** Window for the alerts (sidebar badge, Overview): an old failure should not alarm forever. */
export const RECENT_MS = 60 * 60 * 1000

/** Problems in the last hour of real time. The single definition behind every "AI problems" alert. */
export const recentProblems = (calls: LlmCall[], now = Date.now()) => calls.filter((c) => isProblem(c) && now - new Date(c.ts).getTime() < RECENT_MS)

export const fmtCost = (c: number | null | undefined) => (c == null ? '—' : c === 0 ? '$0' : `$${c < 0.01 ? c.toFixed(5) : c.toFixed(3)}`)

/** Strip ``` fences, then parse. */
export function tryParse(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return { ok: true, value: JSON.parse(t) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
