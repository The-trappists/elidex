import type { LlmCall } from '../../api/types'

export type CallStatus = 'ok' | 'api_error' | 'parse_error'
export const STATUS_LABEL: Record<CallStatus, { label: string; cls: string }> = {
  ok: { label: 'OK', cls: 'bg-ok/15 text-ok' },
  api_error: { label: 'API error', cls: 'bg-bad/15 text-bad' },
  parse_error: { label: 'Parse error', cls: 'bg-warn/15 text-warn' },
}

export const callStatus = (c: LlmCall): CallStatus => (c.error ? 'api_error' : c.parsed_ok === false ? 'parse_error' : 'ok')

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
