// Sample AI calls for the AI activity page, ONLY used with VITE_REVIEW_FIXTURES=1 (design work).
// Mimics GET /llm/calls, GET /llm/summary and POST /llm/compact with an in-memory list.
import type { LlmCall, LlmPurpose, LlmSummary } from '../types'

const MIN = 60_000
const ago = (min: number) => new Date(Date.now() - min * MIN).toISOString()
const THREADS = ['th-sfp-trn042', 'th-fiber-cut', 'th-power-site7']

function make(i: number, minAgo: number, purpose: LlmPurpose, thread: string | null, model: string, error: string | null = null, user = ''): LlmCall {
  return {
    id: `fx-llm-${i}`, ts: ago(minAgo), sim_time: null, purpose, thread_id: thread, provider: model.includes('backup') ? 'fallback' : 'primary',
    role: purpose === 'critic' ? 'critic' : 'primary', base_url: 'https://api.example.test/v1', model, json_mode: 'json_object',
    system: 'You extract operational knowledge from network conversations.', user: user || `Conversation ${thread ?? 'none'} (${purpose})`,
    raw_response: error ? null : '{"assertions": []}', parsed_ok: error ? null : true, parse_error: null,
    latency_ms: 800 + ((i * 937) % 9000), usage: { prompt_tokens: 1200 + i * 11, completion_tokens: 200 + i * 3, cost: null },
    fallback_used: false, error,
  }
}

function seed(): LlmCall[] {
  const out: LlmCall[] = []
  let i = 0
  const purposes: LlmPurpose[] = ['extract', 'critic', 'judge', 'agent']
  for (let k = 0; k < 36; k++) {
    const p = purposes[k % 4]
    const t = THREADS[k % 3]
    // Several identical repeated requests, spread over three days.
    out.push(make(++i, 5 + k * 47, p, p === 'agent' ? null : t, k % 7 === 0 ? 'gpt-fixture-mini' : 'gpt-fixture-large', null, k % 5 === 0 ? 'Same request again' : ''))
  }
  out.push(make(++i, 12, 'extract', THREADS[1], 'gpt-fixture-large', '429 Too Many Requests: rate limit reached'))
  out.push(make(++i, 300, 'critic', THREADS[0], 'gpt-fixture-mini', '503 Service Unavailable'))
  return out
}

let calls = seed()
let meta = { archived_total: 0, last_compacted_at: null as string | null, last_removed: 0 }

export const fixtureLlmCalls = () => [...calls].sort((a, b) => b.ts.localeCompare(a.ts))
export const fixtureLlmCall = (id: string) => calls.find((c) => c.id === id)

export function fixtureLlmSummary(): LlmSummary {
  const by_purpose: Record<string, number> = {}
  for (const c of calls) by_purpose[c.purpose] = (by_purpose[c.purpose] ?? 0) + 1
  const ts = calls.map((c) => c.ts).sort()
  return { total_kept: calls.length, by_purpose, errors_kept: calls.filter((c) => c.error).length, oldest: ts[0] ?? null, newest: ts[ts.length - 1] ?? null, ...meta }
}

/** Keep the newest call per purpose/thread/model, the last hour, and recent errors. */
export function fixtureLlmCompact(): LlmSummary {
  const newest = new Map<string, LlmCall>()
  for (const c of fixtureLlmCalls()) {
    const k = `${c.purpose}|${c.thread_id}|${c.model}`
    if (!newest.has(k)) newest.set(k, c)
  }
  const keep = new Set([...newest.values()].map((c) => c.id))
  const kept = calls.filter((c) => keep.has(c.id) || Date.now() - new Date(c.ts).getTime() < 60 * MIN || (c.error && Date.now() - new Date(c.ts).getTime() < 24 * 60 * MIN))
  meta = { archived_total: meta.archived_total + calls.length - kept.length, last_compacted_at: new Date().toISOString(), last_removed: calls.length - kept.length }
  calls = kept
  return fixtureLlmSummary()
}
