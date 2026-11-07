// Sample data for the operator console ("Needs a look"), used while the L4 endpoints do not exist
// (VITE_REVIEW_FIXTURES=1, or any 404/501 from /api/review, /rerun, /history...). The wording of
// the conversations is verbatim from data/workbench/scenarios. Nothing here talks to a backend.
import type {
  Binding,
  ContextAssertion,
  ElementClass,
  ExtractedItem,
  PipelineJob,
  ReviewFlag,
  Settings,
  Stage,
  StageName,
  StateSnapshot,
  WbElement,
  WbSite,
} from '../types'
import { FIXTURE_THREADS } from './threads'

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

// ---------------------------------------------------------------- inventory
const el = (id: string, type: string, model: string, install_year: number, firmware: string, site_id: string): WbElement => ({
  id, type, model, install_year, firmware, site_id, aliases: [], origin: 'synthetic',
})
const site = (id: string, name: string, region: string, lat: number, lon: number): WbSite => ({ id, name, region, lat, lon, origin: 'synthetic' })

const ELEMENTS: WbElement[] = [
  el('TRN-042', 'transmission_node', 'TX-3000', 2017, '3.8', 'SITE-TKU-004'),
  el('TRN-088', 'transmission_node', 'TX-3000', 2017, '3.8', 'SITE-JKL-006'),
  el('TRN-176', 'transmission_node', 'TX-3000', 2022, '4.0', 'SITE-TMP-002'),
  el('TRN-229', 'transmission_node', 'TX-5000', 2023, '5.0', 'SITE-OUL-011'),
  el('RAD-176', 'radio_unit', 'RU-200', 2019, '2.3', 'SITE-ROV-008'),
  el('RAD-198', 'radio_unit', 'RU-200', 2020, '2.3', 'SITE-NF-021'),
  el('RAD-233', 'radio_unit', 'RU-400', 2022, '2.5', 'SITE-NF-021'),
  el('RAD-254', 'radio_unit', 'RU-400', 2023, '2.5', 'SITE-TKU-009'),
]
const SITES: WbSite[] = [
  site('SITE-TKU-004', 'Turku Kupittaa exchange', 'Southwest Finland', 60.449, 22.295),
  site('SITE-TKU-009', 'Turku harbour hut', 'Southwest Finland', 60.435, 22.219),
  site('SITE-OUL-011', 'Oulu Linnanmaa exchange', 'North Ostrobothnia', 65.059, 25.466),
  site('SITE-TMP-002', 'Tampere Hervanta exchange', 'Pirkanmaa', 61.45, 23.85),
  site('SITE-JKL-006', 'Jyväskylä Kangas exchange', 'Central Finland', 62.25, 25.78),
  site('SITE-ROV-008', 'Rovaniemi Ounasvaara exchange', 'Lapland', 66.49, 25.78),
  site('SITE-NF-021', 'Sodankylä fell mast', 'Lapland', 67.42, 26.59),
  site('SITE-HEL-001', 'Helsinki Pasila exchange', 'Uusimaa', 60.198, 24.934),
]

const C_TX3000 = 'class:transmission_node:tx-3000:installed-upto-2019'
const C_OLD = 'class:transmission_node:installed-upto-2019'
const C_TX5000 = 'class:transmission_node:tx-5000'
const CLASSES: ElementClass[] = [
  { id: C_TX3000, label: 'transmission nodes model TX-3000 installed up to 2019', criteria: { type: 'transmission_node', model: 'TX-3000', install_year_min: null, install_year_max: 2019 } },
  { id: C_OLD, label: 'transmission nodes installed up to 2019', criteria: { type: 'transmission_node', model: null, install_year_min: null, install_year_max: 2019 } },
  { id: C_TX5000, label: 'transmission nodes model TX-5000', criteria: { type: 'transmission_node', model: 'TX-5000', install_year_min: null, install_year_max: null } },
]

// ---------------------------------------------------------------- knowledge
const bind = (entity: string, role: Binding['role'] = 'applies_to'): Binding => ({ entity, role })

function assertion(p: Partial<ContextAssertion> & Pick<ContextAssertion, 'id' | 'type' | 'topic' | 'summary' | 'bound_to'>): ContextAssertion {
  return {
    conditions: [], diagnosis: null, action: null, avoid: [], fact: null,
    valid_from: '2026-11-05T12:00:00', valid_to: null, closed_by: null,
    trust: { level: 'stated', stated_by: 'Erkki Expert', role: 'Network Expert', evidence: null },
    sources: [], conflicts_with: [], confidence: 0.8, link_notes: [],
    ...p,
  }
}

export const FX_OPERATOR_EDITED = 'ctx_fx_sodankyla'

export const FIXTURE_ASSERTIONS: ContextAssertion[] = [
  assertion({
    id: 'ctx_fx_rad176', type: 'workaround', topic: 'rad-176-frost-margin-dip',
    summary: 'RAD-176 (RU-200 at Ounasvaara) loses link margin on hard frost mornings, below minus 25. It recovers by itself in about 20 minutes once the heater has warmed the unit.',
    bound_to: [bind('RAD-176')], action: 'Wait about 20 minutes. Do not go up and realign the antenna.', avoid: ['Realigning the antenna'],
    trust: { level: 'stated', stated_by: 'Raimo Rantanen', role: 'Radio Specialist', evidence: 'it comes back on its own when the heater has warmed the unit, about 20 min' },
    sources: [{ source: 'slack', file: 'FX-176', seq: [7, 8, 9] }], confidence: 0.82,
  }),
  assertion({
    id: 'ctx_fx_turku', type: 'workaround', topic: 'tx-3000-fw38-cold-start-mgmt-port',
    summary: 'After a power cycle, TX-3000 nodes on firmware 3.8 need around 8 minutes before the management port answers. Traffic is fine in the meantime.',
    bound_to: [bind('TRN-042'), bind(C_TX3000, 'observed_on')], action: 'Do not cycle it again. Wait about 8 minutes.', avoid: ['Power cycling the node a second time'],
    trust: { level: 'stated', stated_by: 'Erkki Expert', role: 'Network Expert', evidence: 'The 3.8 boxes need around 8 minutes after a cold start before the management port answers.' },
    sources: [{ source: 'teams', file: 'FX-TURKU', seq: [7, 10] }], confidence: 0.55,
    link_notes: ["'the Turku node' was matched to TRN-042 from \"yes the old one, Kupittaa\"."],
  }),
  assertion({
    id: 'ctx_fx_bounce', type: 'workaround', topic: 'sfp-swap-zero-counters-bounce-first',
    summary: 'After an SFP swap with the link UP and counters stuck at zero, bounce the interface first (disable, wait, enable).',
    bound_to: [bind(C_TX3000)], action: 'Disable the interface, wait a bit, enable it.',
    valid_to: '2026-11-06T09:05:00', closed_by: 'ctx_fx_fw42', conflicts_with: ['ctx_fx_reseat'],
    trust: { level: 'stated', stated_by: 'Erkki Expert', role: 'Network Expert', evidence: 'Bounce it. Disable, wait a bit, enable. On the old TX-3000s that\'s always step one.' },
    sources: [{ source: 'teams', file: 'FX-SFP', seq: [2, 5] }], confidence: 0.78,
  }),
  assertion({
    id: 'ctx_fx_reseat', type: 'workaround', topic: 'sfp-swap-zero-counters-reseat-first',
    summary: 'A half-seated module also gives link UP with zero counters. On units up to 2019, reseat the module first, then bounce if that fails.',
    bound_to: [bind(C_TX3000)], action: 'Reseat the module first. Bounce the interface only if that fails.', conflicts_with: ['ctx_fx_bounce'],
    trust: { level: 'stated', stated_by: 'Aino Arkkitehti', role: 'Network Architect', evidence: "The vendor guide for the TX-3000 says reseat the module first." },
    sources: [{ source: 'teams', file: 'FX-SFP', seq: [3, 4, 6] }], confidence: 0.74,
  }),
  assertion({
    id: 'ctx_fx_vendor', type: 'fact', topic: 'tx-5000-sync-after-power-dip',
    summary: 'After even a short power dip, a TX-5000 node may need about 15 minutes to get sync back, and a reboot just restarts that clock. Second-hand, from vendor support.',
    bound_to: [bind(C_TX5000), bind('TRN-229', 'observed_on')], action: 'Wait about 15 minutes before rebooting.',
    trust: { level: 'hunch', stated_by: 'Aino Arkkitehti', role: 'Network Architect', evidence: "caveat: that's only their word, I haven't seen it happen myself" },
    sources: [{ source: 'slack', file: 'FX-VENDOR', seq: [5, 6] }], confidence: 0.4,
  }),
  assertion({
    id: 'ctx_fx_fw42', type: 'invalidation', topic: 'fw-4-2-no-bounce-after-sfp-swap',
    summary: 'Firmware 4.2 is rolled out to all transmission nodes installed 2019 or earlier. It fixes the forwarding-state bug after an optical module replacement, so the disable/enable trick is no longer needed.',
    bound_to: [bind(C_OLD)], fact: 'If counters are still zero after a swap on 4.2, it is something else.',
    valid_from: '2026-11-06T09:05:00',
    trust: { level: 'verified', stated_by: 'Aino Arkkitehti', role: 'Network Architect', evidence: 'Release notes say it fixes the forwarding-state bug after optical module replacement.' },
    sources: [{ source: 'teams', file: 'FX-FW42', seq: [1, 3] }], confidence: 0.9,
  }),
  assertion({
    id: FX_OPERATOR_EDITED, type: 'workaround', topic: 'rad-198-restart-load-profile-1',
    summary: 'Restarting RAD-198 (RU-200, Sodankylä fell mast) is fine, but on firmware 2.3 it forgets the antenna profile. After the restart, load profile 1, otherwise the link is bad.',
    bound_to: [bind('RAD-198')],
    action: "Restart RAD-198, then in the front panel menu choose 'Load profile 1'. Take a headlamp: the cabinet has no light.",
    avoid: ['Leaving the radio on the factory profile'],
    trust: { level: 'stated', stated_by: 'Raimo Rantanen', role: 'Radio Specialist', evidence: "restarting RAD-198 is fine, but it forgets the antenna profile on 2.3" },
    sources: [{ source: 'slack', file: 'FX-SODANKYLA', seq: [5, 6, 7] }, { source: 'operator', file: 'operator', seq: [] }], confidence: 0.85,
  }),
]

// ---------------------------------------------------------------- pipeline jobs
const STAGES: StageName[] = ['listen', 'understand', 'link', 'store', 'reconcile']
const stages = (ms = [40, 2400, 80, 30, 120]): Stage[] => STAGES.map((s, i) => ({ stage: s, status: 'done', detail: '', duration_ms: ms[i] }))

function item(p: Partial<ExtractedItem> & Pick<ExtractedItem, 'topic' | 'summary' | 'stated_by' | 'cited_seq'>): ExtractedItem {
  return {
    type: 'workaround', conditions: [], diagnosis: null, action: null, avoid: [], fact: null,
    trust_level: 'stated', evidence: null, evidence_quote: null, confidence: 0.8,
    scope: { instance_ids: [], site_ids: [], element_class: null, trigger: null, qualifier: null },
    ...p,
  }
}

function job(n: string, thread_id: string, p: Partial<PipelineJob>): PipelineJob {
  return {
    id: `FXJ-${n}`, thread_id, started_at: ago(120), finished_at: ago(119), extractor: 'llm:fixture-model',
    stages: stages(), items: [], notes: [], assertion_ids: [], removed_assertion_ids: [], events: [],
    llm_call_ids: [], eval: null, flags: [], critic: [], judge: [], error: null,
    ...p,
  }
}

const J_176 = job('176', 'FX-176', {
  started_at: ago(300),
  items: [
    item({
      topic: 'rad-176-frost-margin-dip', stated_by: 'Raimo Rantanen', cited_seq: [7, 8],
      summary: 'RAD-176 loses link margin on hard frost mornings below minus 25 and recovers by itself in about 20 minutes.',
      action: 'Wait about 20 minutes. Do not realign the antenna.', avoid: ['Realigning the antenna'],
      evidence_quote: 'it comes back on its own when the heater has warmed the unit, about 20 min', confidence: 0.82,
      scope: { instance_ids: ['RAD-176'], site_ids: [], element_class: null, trigger: 'hard frost, below minus 25', qualifier: null },
    }),
    item({
      topic: 'ru-200-frost-margin-dip', stated_by: 'Raimo Rantanen', cited_seq: [7, 8],
      summary: 'RU-200 radios lose link margin on frost mornings.', confidence: 0.35,
      evidence_quote: 'the other RU-200s are fine',
      scope: { instance_ids: [], site_ids: [], element_class: { type: 'radio_unit', model: 'RU-200', install_year_min: null, install_year_max: null }, trigger: 'frost', qualifier: null },
    }),
    item({
      topic: 'rad-176-realign-antenna', stated_by: 'Raimo Rantanen', cited_seq: [8, 9], confidence: 0.2,
      summary: 'Realign the antenna of RAD-176 to fix the margin dip.', action: 'Realign the antenna',
      evidence_quote: "don't go up and realign it",
      scope: { instance_ids: ['RAD-176'], site_ids: [], element_class: null, trigger: null, qualifier: null },
    }),
  ],
  assertion_ids: ['ctx_fx_rad176'],
  notes: ["Narrowed 'RU-200 frost margin dip' to RAD-176: the source says only this unit is affected."],
  critic: [
    { item_topic: 'rad-176-frost-margin-dip', verdict: 'keep', evidence_found: true, confidence_after: null, reason: "The quote is in message #8 and the scope matches: \"only this unit tho\"." },
    { item_topic: 'ru-200-frost-margin-dip', verdict: 'downgrade', evidence_found: true, confidence_after: 0.35, reason: "Over-reach. The speaker limits it to one unit: \"only this unit tho, its antenna sits in the shade of the cliff. the other RU-200s are fine\"." },
    { item_topic: 'rad-176-realign-antenna', verdict: 'reject', evidence_found: false, confidence_after: null, reason: "Nobody recommended realigning. The message says the opposite (\"don't go up and realign it\"), so the finding turned a warning into advice." },
  ],
})

const J_TURKU = job('TURKU', 'FX-TURKU', {
  started_at: ago(260),
  items: [item({
    topic: 'tx-3000-fw38-cold-start-mgmt-port', stated_by: 'Erkki Expert', cited_seq: [7, 10], confidence: 0.55,
    summary: 'After a power cycle, TX-3000 nodes on firmware 3.8 need around 8 minutes before the management port answers.',
    action: 'Do not cycle it again. Wait about 8 minutes.', avoid: ['Power cycling the node a second time'],
    evidence_quote: 'The 3.8 boxes need around 8 minutes after a cold start before the management port answers.',
    scope: { instance_ids: ['TRN-042'], site_ids: ['SITE-TKU-004'], element_class: { type: 'transmission_node', model: 'TX-3000', install_year_min: null, install_year_max: 2019 }, trigger: 'after a cold start', qualifier: null },
  })],
  assertion_ids: ['ctx_fx_turku'],
  notes: ["'the Turku node' matched TRN-042 (Kupittaa) from: \"yes the old one, Kupittaa\". The harbour hut was ruled out."],
  critic: [{ item_topic: 'tx-3000-fw38-cold-start-mgmt-port', verdict: 'keep', evidence_found: true, confidence_after: null, reason: 'The quote is verbatim in message #7. The node was named by the participants, not guessed.' }],
})

const J_SFP = job('SFP', 'FX-SFP', {
  started_at: ago(900),
  items: [
    item({
      topic: 'sfp-swap-zero-counters-bounce-first', stated_by: 'Erkki Expert', cited_seq: [2, 5], confidence: 0.78,
      summary: 'After an SFP swap with the link UP and counters at zero, bounce the interface first.', action: 'Disable the interface, wait a bit, enable it.',
      evidence_quote: "Bounce it. Disable, wait a bit, enable. On the old TX-3000s that's always step one.",
      scope: { instance_ids: [], site_ids: [], element_class: { type: 'transmission_node', model: 'TX-3000', install_year_min: null, install_year_max: 2019 }, trigger: null, qualifier: null },
    }),
    item({
      topic: 'sfp-swap-zero-counters-reseat-first', stated_by: 'Aino Arkkitehti', cited_seq: [3, 4, 6], confidence: 0.74,
      summary: 'A half-seated module also gives link UP with zero counters. On units up to 2019, reseat the module first.', action: 'Reseat the module first, then bounce if that fails.',
      evidence_quote: "I'd still reseat first on anything up to 2019, then bounce if that fails.",
      scope: { instance_ids: [], site_ids: [], element_class: { type: 'transmission_node', model: 'TX-3000', install_year_min: null, install_year_max: 2019 }, trigger: null, qualifier: null },
    }),
  ],
  assertion_ids: ['ctx_fx_bounce', 'ctx_fx_reseat'],
  events: ['Conflict recorded between ctx_fx_bounce and ctx_fx_reseat. Both stay valid until someone settles it.'],
  critic: [
    { item_topic: 'sfp-swap-zero-counters-bounce-first', verdict: 'keep', evidence_found: true, confidence_after: null, reason: 'Quote found in message #2.' },
    { item_topic: 'sfp-swap-zero-counters-reseat-first', verdict: 'keep', evidence_found: true, confidence_after: null, reason: 'Quote found in message #6.' },
  ],
  judge: [{ new_assertion_id: 'ctx_fx_reseat', other_assertion_id: 'ctx_fx_bounce', verdict: 'contradicts', reason: 'Same first step after the same SFP swap on the same class of nodes, but the two steps are different and exclude each other: bounce versus reseat. Nobody settled it ("Veikko, your call").' }],
})

const J_VENDOR = job('VENDOR', 'FX-VENDOR', {
  started_at: ago(700),
  items: [item({
    topic: 'tx-5000-sync-after-power-dip', type: 'fact', stated_by: 'Aino Arkkitehti', cited_seq: [5, 6], trust_level: 'hunch', confidence: 0.4,
    summary: 'After even a short power dip a TX-5000 node may need about 15 minutes to get sync back. A reboot restarts that clock.', action: 'Wait about 15 minutes before rebooting.',
    evidence_quote: 'after even a short power dip the node needs about 15 min to get sync back, and a reboot just restarts that clock',
    scope: { instance_ids: ['TRN-229'], site_ids: [], element_class: { type: 'transmission_node', model: 'TX-5000', install_year_min: null, install_year_max: null }, trigger: 'short power dip', qualifier: 'second-hand, from vendor support' },
  })],
  assertion_ids: ['ctx_fx_vendor'],
  critic: [{ item_topic: 'tx-5000-sync-after-power-dip', verdict: 'downgrade', evidence_found: true, confidence_after: 0.4, reason: "Kept as a hunch. It is second-hand: \"caveat: that's only their word, I haven't seen it happen myself\", and Erkki has \"never seen it on any of mine\"." }],
})

const J_FW42 = job('FW42', 'FX-FW42', {
  started_at: ago(1500),
  items: [item({
    topic: 'fw-4-2-no-bounce-after-sfp-swap', type: 'invalidation', stated_by: 'Aino Arkkitehti', cited_seq: [1, 3], trust_level: 'verified', confidence: 0.9,
    summary: 'Firmware 4.2 fixes the forwarding-state bug after an optical module replacement. The disable/enable trick is no longer needed.',
    evidence_quote: 'Correct, it shouldn\'t be needed anymore on those units.',
    scope: { instance_ids: [], site_ids: [], element_class: { type: 'transmission_node', model: null, install_year_min: null, install_year_max: 2019 }, trigger: null, qualifier: null },
  })],
  assertion_ids: ['ctx_fx_fw42'],
  events: ['Closed ctx_fx_bounce (superseded by ctx_fx_fw42).'],
  critic: [{ item_topic: 'fw-4-2-no-bounce-after-sfp-swap', verdict: 'keep', evidence_found: true, confidence_after: null, reason: 'Release notes are quoted and confirmed in message #3.' }],
  judge: [{ new_assertion_id: 'ctx_fx_fw42', other_assertion_id: 'ctx_fx_bounce', verdict: 'supersedes', reason: 'The bounce step existed only to work around the forwarding-state bug. Firmware 4.2 fixes it on every unit the bounce rule covered, so the older rule no longer applies.' }],
})

const J_SOD = job('SODANKYLA', 'FX-SODANKYLA', {
  started_at: ago(800),
  items: [item({
    topic: 'rad-198-restart-load-profile-1', stated_by: 'Raimo Rantanen', cited_seq: [5, 6, 7], confidence: 0.85,
    summary: 'Restarting RAD-198 is fine, but it forgets the antenna profile on firmware 2.3. Load profile 1 afterwards.',
    action: "After the restart, front panel menu, 'Load profile 1'.", avoid: ['Leaving the radio on the factory profile'],
    evidence_quote: "after the restart, front panel menu, 'Load profile 1'. otherwise it comes up on the factory profile and the link is bad",
    scope: { instance_ids: ['RAD-198'], site_ids: ['SITE-NF-021'], element_class: null, trigger: 'after a restart', qualifier: null },
  })],
  assertion_ids: [FX_OPERATOR_EDITED],
  notes: ["'the old one' resolved to RAD-198 (RU-200) rather than RAD-233: \"the old one is the RU-200, RAD-198\"."],
  critic: [{ item_topic: 'rad-198-restart-load-profile-1', verdict: 'keep', evidence_found: true, confidence_after: null, reason: 'Quote found in message #7.' }],
})

const J_HEL = job('HELSINKI', 'FX-HELSINKI', {
  started_at: ago(5),
  notes: ["Four devices at Helsinki Pasila match 'the box'. Nothing was bound."],
})

export const FIXTURE_JOBS: PipelineJob[] = [J_176, J_TURKU, J_SFP, J_VENDOR, J_FW42, J_SOD, J_HEL]

// ---------------------------------------------------------------- flags
let n = 0
const flag = (p: Omit<ReviewFlag, 'id' | 'dismissed' | 'job_id'> & { job: PipelineJob }): ReviewFlag => {
  const { job: j, ...rest } = p
  return { id: `fxflag-${++n}`, job_id: j.id, dismissed: false, ...rest }
}

export const FIXTURE_FLAGS: ReviewFlag[] = [
  flag({
    kind: 'abstained', thread_id: 'FX-176', job: J_176, assertion_id: null, created_at: ago(298),
    message: "The loop could not tell which '176' was meant (TRN-176 in Hervanta or RAD-176 in Ounasvaara), so it saved nothing for the first part of the conversation.",
    detail: 'A wrong link is worse than none. It only attached knowledge once Raimo named RAD-176 explicitly.',
  }),
  flag({
    kind: 'over_reach', thread_id: 'FX-176', job: J_176, assertion_id: null, created_at: ago(297),
    message: 'Finding "ru-200-frost-margin-dip" was drafted for every RU-200 radio, but the source says only one unit is affected.',
    detail: 'The second check lowered its confidence and the linker kept it off the whole class.',
  }),
  flag({
    kind: 'critic_rejected', thread_id: 'FX-176', job: J_176, assertion_id: null, created_at: ago(296),
    message: 'Finding "rad-176-realign-antenna" was dropped by the second check: it contradicts what was said.',
    detail: "Raimo said \"don't go up and realign it\". Nothing was saved.",
  }),
  flag({
    kind: 'low_confidence', thread_id: 'FX-TURKU', job: J_TURKU, assertion_id: 'ctx_fx_turku', created_at: ago(240),
    message: "'The Turku node' was linked to TRN-042 (Kupittaa). Confidence is 55%.",
    detail: 'Turku has two sites. Veikko said "yes the old one, Kupittaa" and Helmi then wrote "that\'s TRN-042 then", but nobody confirmed the id.',
  }),
  flag({
    kind: 'conflict', thread_id: 'FX-SFP', job: J_SFP, assertion_id: 'ctx_fx_reseat', created_at: ago(880),
    message: 'Two experts gave opposite first steps after an SFP swap on TX-3000 nodes: bounce the interface, or reseat the module.',
    detail: 'Both are kept and agents see both, with a warning. Nobody settled it in the conversation.',
  }),
  flag({
    kind: 'low_confidence', thread_id: 'FX-VENDOR', job: J_VENDOR, assertion_id: 'ctx_fx_vendor', created_at: ago(690),
    message: 'The 15-minute sync wait for TX-5000 nodes is second-hand, from vendor support. It is kept as a hunch.',
    detail: "Aino said \"that's only their word, I haven't seen it happen myself\".",
  }),
  flag({
    kind: 'judge_decision', thread_id: 'FX-FW42', job: J_FW42, assertion_id: 'ctx_fx_fw42', created_at: ago(1490),
    message: 'The "bounce the interface after an SFP swap" rule was closed: firmware 4.2 makes it obsolete.',
    detail: 'The new knowledge supersedes the older rule for transmission nodes installed 2019 or earlier.',
  }),
  flag({
    kind: 'operator_edit', thread_id: 'FX-SODANKYLA', job: J_SOD, assertion_id: FX_OPERATOR_EDITED, created_at: ago(45),
    message: 'An operator changed the action of "restart RAD-198, then load profile 1".',
    detail: "Added a tip from the conversation: \"take a headlamp, the cabinet has no light\". Agents now use the edited version.",
  }),
]

/** Arrives a few seconds after load in fixtures mode, to show the live update. */
export const FIXTURE_LIVE_FLAG: ReviewFlag = {
  id: 'fxflag-live', kind: 'abstained', thread_id: 'FX-HELSINKI', job_id: J_HEL.id, assertion_id: null, dismissed: false, created_at: new Date().toISOString(),
  message: "The loop could not tell which of the four devices at Helsinki Pasila drops traffic when the second port is used, so it saved nothing.",
  detail: 'A rumour about "the box" would have been bound to the whole site. It waits for someone who knows which box.',
}

/** Wall-clock "now" in fixtures: edits made by the operator are history rows. */
export interface FixtureEdit {
  id: string
  assertion_id: string
  ts: string
  note: string | null
  before: Record<string, unknown>
  after: Record<string, unknown>
  undone: boolean
}

export const FIXTURE_HISTORY: FixtureEdit[] = [
  {
    id: 'fxedit-2', assertion_id: FX_OPERATOR_EDITED, ts: ago(45), note: 'Added the headlamp tip from the conversation', undone: false,
    before: { action: "Restart RAD-198, then in the front panel menu choose 'Load profile 1'." },
    after: { action: "Restart RAD-198, then in the front panel menu choose 'Load profile 1'. Take a headlamp: the cabinet has no light." },
  },
  {
    id: 'fxedit-1', assertion_id: FX_OPERATOR_EDITED, ts: ago(180), note: 'Raised to verified after a field visit', undone: true,
    before: { trust_level: 'stated' }, after: { trust_level: 'verified' },
  },
]

const SETTINGS: Settings = {
  extractor_mode: 'auto', lifecycle: true, idle_seconds: 90, use_conditions: true, use_guard: true, slack_mirror: false,
  auto_sim: false, auto_every_s: 600, use_critic: true, use_judge: true, use_outcome_loop: false,
  llm_configured: false, llm_model: null, llm_fallback_model: null, slack_connected: false,
}

/** A full /api/state replacement, so the whole UI works with the backend down. */
export function fixtureSnapshot(): StateSnapshot {
  return {
    clock: { sim_now: '2026-11-07T10:00:00', speed: 1, running: false },
    settings: SETTINGS,
    elements: ELEMENTS,
    sites: SITES,
    links: [],
    personas: [],
    threads: FIXTURE_THREADS,
    incidents: [],
    assertions: FIXTURE_ASSERTIONS,
    classes: CLASSES,
    jobs: FIXTURE_JOBS,
    scenarios: [],
    runs: [],
    llm_calls: [],
  }
}
