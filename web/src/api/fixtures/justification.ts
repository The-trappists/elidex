// Sample data for the justification panel and the merge list. Used only with VITE_REVIEW_FIXTURES=1.
import type { DedupeReport, Justification } from '../types'

export function fixtureJustification(id: string): Justification {
  if (id === 'ctx_fx_empty') throw new Error('No justification for this knowledge')
  return {
    assertion_id: id,
    trust_level: 'stated',
    trust_summary: 'Stated by a named expert, but not confirmed by a second person or a measurement.',
    trust_factors: [
      { label: 'Named expert', effect: 'supports', detail: 'Erkki Expert (Network Expert) said it in the conversation.' },
      { label: 'No second confirmation', effect: 'limits', detail: 'Nobody else repeated or confirmed the advice.' },
      { label: 'Single conversation', effect: 'neutral', detail: 'Only one thread mentions it.' },
    ],
    confidence: 0.8,
    confidence_summary: 'The reading is clear and linked to one piece of equipment, but the conditions are loose.',
    confidence_factors: [
      { label: 'Clear wording', effect: 'supports', detail: 'The action and the thing to avoid are stated explicitly.' },
      { label: 'Equipment matched by name', effect: 'supports', detail: 'RAD-176 appears in the inventory.' },
      { label: 'No machine-checkable condition', effect: 'limits', detail: 'The advice cannot be tested against live data.' },
    ],
    critic: { verdict: 'accepted', reason: 'The second check found the advice consistent with the messages.', other_assertion_id: null },
    judge: [
      { verdict: 'complements', reason: 'Same site, different symptom. Both can hold at once.', other_assertion_id: 'ctx_fx_turku' },
      { verdict: 'conflicts', reason: 'Gives the opposite advice for the same antenna.', other_assertion_id: 'ctx_fx_reseat' },
    ],
    n_sources: 2,
    source_thread_ids: ['TRN-042', 'RAD-176'],
    track_record: { times_used: 4, times_confirmed: 3, last_confirmed_by: 'Mika Field' },
  }
}

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

export const FIXTURE_DEDUPE: DedupeReport = {
  enabled: true,
  merged_total: 3,
  threshold: 0.92,
  recent: [
    { kept_id: 'ctx_fx_rad176', merged_id: 'ctx_dup_0007', similarity: 1, method: 'exact', reason: 'Same topic, same action, same equipment.', at: ago(12) },
    { kept_id: 'ctx_fx_turku', merged_id: 'ctx_dup_0011', similarity: 0.94, method: 'words', reason: 'Nearly identical wording about the cold start wait.', at: ago(55) },
    { kept_id: 'ctx_fx_vendor', merged_id: 'ctx_dup_0012', similarity: 0.93, method: 'embedding', reason: 'Same vendor statement written by two people.', at: ago(190) },
  ],
}
