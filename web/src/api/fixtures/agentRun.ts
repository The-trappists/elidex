// Sample POST /agent/run response, ONLY for VITE_REVIEW_FIXTURES=1 (design work). Nothing here talks to a backend.
import type { AgentRunBody, AgentRunResult } from '../types'

export function fixtureAgentRun(body: AgentRunBody): AgentRunResult {
  const hit = (id: string, type: string, topic: string, summary: string, extra: Record<string, unknown>) => ({
    id, type, topic, summary, bound_to: [{ entity: body.entity_id, role: 'applies_to' }], conditions: [], diagnosis: null,
    action: null, avoid: [], fact: null, valid_from: '2026-03-02T09:00:00', valid_to: null, closed_by: null,
    trust: { level: 'verified', stated_by: 'Mika', role: 'field engineer', evidence: null },
    sources: [{ source: 'slack', file: 'thread-001', seq: [2] }], conflicts_with: [], confidence: 0.86, link_notes: [],
    matched_via: 'entity', ...extra,
  })
  return {
    recommendation: `After an SFP swap on ${body.entity_id} with zero traffic, re-enable the port and check the far-end optics before replacing anything else (A-101). ${body.planned_action ? `Planned action "${body.planned_action}" should wait until the port state is confirmed.` : ''}`.trim(),
    hits: [
      hit('A-101', 'workaround', 'SFP swap, port stays silent', 'After an SFP swap the port can stay administratively down. Re-enable it and verify far-end optical levels.', { check_status: 'fully checked', to_read: [], track_record: { status: 'ok', worked: 3, failed: 0, failed_on: [], thread: 2, last_at: '2026-04-01T10:00:00' } }),
      hit('A-117', 'invalidation', 'Firmware 3.8 resets counters', 'On TX-3000 firmware 3.8 counters read zero for a few minutes after a reload.', { confidence: 0.62, trust: { level: 'stated', stated_by: 'Ines', role: null, evidence: null }, check_status: 'not fully checked', to_read: ['traffic_counters'], track_record: { status: 'contested', worked: 1, failed: 1, failed_on: ['TRN-088'], thread: 1, last_at: '2026-05-01T10:00:00' } }),
      hit('A-140', 'fact', 'Spare SFPs are in cabinet B', 'Spare SFP modules for Turku Kupittaa are kept in cabinet B.', { confidence: 0.4, trust: { level: 'hunch', stated_by: 'Jari', role: null, evidence: null }, check_status: 'text only', track_record: { status: 'untested', worked: 0, failed: 0, failed_on: [], thread: 0, last_at: null } }),
    ] as unknown as AgentRunResult['hits'],
    skipped: [{ assertion_id: 'A-090', reason: 'Bound to RAD-176; this case is on a transmission node.' }],
    verdict: body.planned_action
      ? { decision: 'adapt', action: body.planned_action, steps: ['Confirm the port is administratively up', 'Read far-end optical levels', 'Then replace the module if levels are low'], reasons: ['A-101 says the port may just be disabled.'] }
      : null,
    thread_id: 'thread-001',
    cited_assertion_ids: ['A-101'],
    evidence_confidence: 0.78,
  }
}
