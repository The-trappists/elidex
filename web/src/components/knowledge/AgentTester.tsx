import { Bot, ChevronDown, ChevronRight, FlaskConical, MessageSquare, PanelRightClose, PanelRightOpen, Play, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { AgentRunResult, ContextHit, GraphProvenance, TrackRecord } from '../../api/types'
import { OBSERVABLE_FIELDS } from '../../api/types'
import { fmtDateTime, toNaiveIso } from '../../lib/format'
import { SOURCE_STYLE } from '../../lib/semantic'
import { useSimNow } from '../../lib/useNow'
import { useLive } from '../../store/live'
import { OBS_OPTIONS, toObservations } from '../data/ObservationsEditor'
import { Badge, Button, EmptyState, IdChip, Input, Select, Toggle, withToast } from '../ui'
import { AgentGraph } from './AgentGraph'
import { TrustBadge, TypeBadge } from './bits'

/** /agent/run adds these to each hit (see routes.py); they are not in the shared ContextHit type. */
type Hit = ContextHit & { check_status?: string; to_read?: string[]; track_record?: TrackRecord | null }

interface Preset {
  label: string
  entity: string
  description: string
  obs: Record<string, string>
  planned: string
}
const SFP_TEXT = 'An SFP was replaced on TRN-042. The interface is UP, optical levels are normal, alarms are cleared, but traffic counters remain at zero.'
const PRESETS: Preset[] = [
  { label: 'SFP swap, no traffic', entity: 'TRN-042', description: SFP_TEXT, obs: {}, planned: '' },
  {
    label: 'SFP swap, with observations',
    entity: 'TRN-042',
    description: SFP_TEXT,
    obs: { sfp_replaced: 'true', interface_status: 'UP', optical_levels: 'normal', traffic_counters: '0', alarms: 'cleared' },
    planned: '',
  },
  { label: 'SFP swap, planned action', entity: 'TRN-042', description: SFP_TEXT, obs: {}, planned: 'Replace the SFP module again' },
]

const CHECK_STYLE: Record<string, { label: string; cls: string }> = {
  'fully checked': { label: 'Fully checked', cls: 'bg-ok/10 text-ok' },
  'not fully checked': { label: 'Not fully checked', cls: 'bg-warn/10 text-warn' },
}
const TEXT_ONLY = { label: 'Text only', cls: 'bg-surface-2 text-muted' }

function CheckBadge({ hit }: { hit: Hit }) {
  if (!hit.check_status) return null
  const s = CHECK_STYLE[hit.check_status] ?? TEXT_ONLY
  return <Badge className={s.cls} title={hit.check_status === 'not fully checked' && hit.to_read?.length ? `Read first: ${hit.to_read.join(', ')}` : 'Whether the conditions of this knowledge could be checked automatically'}>{s.label}</Badge>
}

function TrackBadge({ t }: { t?: TrackRecord | null }) {
  if (!t) return null
  const cls = t.status === 'ok' ? 'bg-ok/10 text-ok' : t.status === 'contested' ? 'bg-warn/10 text-warn' : 'bg-surface-2 text-muted'
  const label = t.status === 'untested' ? 'Not tried yet' : `${t.worked} worked, ${t.failed} failed`
  return <Badge className={cls} title={t.failed_on.length ? `Failed on ${t.failed_on.join(', ')}` : 'Track record: what happened when this was applied'}>{t.status === 'contested' ? 'Contested: ' : 'Record: '}{label}</Badge>
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}{count != null && <span className="ml-1.5 font-normal">({count})</span>}</h2>
      {children}
    </section>
  )
}

export function AgentTester() {
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const llm = useLive((s) => s.settings?.llm_configured ?? false)
  const sim = useSimNow(60_000)
  const [entity, setEntity] = useState(PRESETS[0].entity)
  const [description, setDescription] = useState(PRESETS[0].description)
  const [obs, setObs] = useState<Record<string, string>>({})
  const [planned, setPlanned] = useState('')
  const [at, setAt] = useState('')
  const [useLlm, setUseLlm] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingSources, setLoadingSources] = useState(false)
  const [result, setResult] = useState<AgentRunResult | null>(null)
  const [provenance, setProvenance] = useState<Record<string, GraphProvenance[]>>({})
  const [runEntity, setRunEntity] = useState('')
  const [graphOpen, setGraphOpen] = useState(true)
  const [addField, setAddField] = useState('')

  const applyPreset = (p: Preset) => {
    setEntity(p.entity)
    setDescription(p.description)
    setObs(p.obs)
    setPlanned(p.planned)
    setResult(null)
    setProvenance({})
    setRunEntity('')
    if (p.planned || Object.keys(p.obs).length) setShowMore(true)
  }

  const run = async () => {
    const effectiveAt = at || (sim ? toNaiveIso(sim) : '')
    setBusy(true)
    const r = await withToast(() =>
      api.agentRun({ entity_id: entity, description: description.trim(), observations: toObservations(obs), planned_action: planned.trim() || null, at: effectiveAt || null, use_llm: useLlm && llm }),
    )
    setBusy(false)
    if (!r) return
    setResult(r)
    setRunEntity(entity)
    setLoadingSources(true)
    const rows = await Promise.all(r.hits.map(async (h) => [h.id, await api.provenance(h.id).catch(() => [])] as const))
    setProvenance(Object.fromEntries(rows))
    setLoadingSources(false)
  }

  const hits = (result?.hits ?? []) as Hit[]
  const sourceRows = [...new Map(hits.flatMap((hit) => provenance[hit.id] ?? []).filter((s) => s.file).map((s) => [`${s.file}|${s.seq ?? 'thread'}`, s])).values()]
  const setObsKeys = Object.keys(obs).filter((k) => obs[k] !== '')
  const freeFields = Object.keys(OBSERVABLE_FIELDS).filter((f) => !setObsKeys.includes(f))
  const addOpts = addField ? OBS_OPTIONS[addField] : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* case bar */}
      <div className="shrink-0 space-y-2 border-b border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 flex items-center gap-2 font-display text-lg font-medium tracking-tight"><FlaskConical size={18} className="text-accent" /> Agent tester</h1>
          <Select className="!w-72" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Network entity">
            <option value="">Choose entity…</option>
            <optgroup label="Elements">{elements.map((e) => <option key={e.id} value={e.id}>{e.id} · {e.type.replace(/_/g, ' ')}</option>)}</optgroup>
            <optgroup label="Sites">{sites.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}</optgroup>
          </Select>
          <Select className="!w-52" value="" onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) applyPreset(p) }} aria-label="Preset cases">
            <option value="">Preset cases…</option>
            {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </Select>
          <Input className="!w-[13rem]" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="At date and time (defaults to the simulated time)" title="Defaults to the current simulated time" />
          <div className="ml-auto flex items-center gap-3">
            <Toggle checked={useLlm && llm} disabled={!llm} onChange={setUseLlm} label={<span className="text-[13px]" title={llm ? '' : 'No language model is configured; the rule-based agent is used'}>Use LLM</span>} />
            <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => applyPreset(PRESETS[0])} aria-label="Reset to the default case">Reset</Button>
            <Button variant="primary" icon={<Play size={14} />} loading={busy} disabled={!entity || !description.trim()} onClick={run} aria-label="Run agent">Run</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="min-w-64 flex-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened on the network?" aria-label="What happened?" />
          <button type="button" className="flex h-9 items-center gap-1 rounded-md px-2 text-[13px] text-muted hover:bg-surface-2 hover:text-text" aria-expanded={showMore} onClick={() => setShowMore((o) => !o)}>
            {showMore ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Observations and planned action
            {(setObsKeys.length > 0 || planned.trim()) && <span className="rounded bg-accent/10 px-1.5 text-accent">{setObsKeys.length + (planned.trim() ? 1 : 0)}</span>}
          </button>
        </div>
        {showMore && (
          <div className="flex flex-wrap items-center gap-2 animate-slide-in">
            <Input className="!w-64" value={planned} onChange={(e) => setPlanned(e.target.value)} placeholder="Planned action, e.g. Replace the SFP module" aria-label="Planned action" title="Optional. The guard checks whether it fits the available knowledge." />
            {setObsKeys.map((f) => (
              <span key={f} className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-bg pl-3 pr-1 text-[13px]" title={OBSERVABLE_FIELDS[f]}>
                <code>{f}</code> = {obs[f]}
                <button type="button" className="rounded-full p-1 text-muted hover:bg-surface-2 hover:text-text" aria-label={`Remove observation ${f}`} onClick={() => setObs((o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== f)))}><X size={12} /></button>
              </span>
            ))}
            {freeFields.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Select className="!w-44" value={addField} onChange={(e) => setAddField(e.target.value)} aria-label="Add observation field">
                  <option value="">Add observation…</option>
                  {freeFields.map((f) => <option key={f} value={f}>{f}</option>)}
                </Select>
                {addField && addOpts === 'number' && (
                  <Input type="number" className="!w-24" autoFocus placeholder="value" aria-label={`Value of ${addField}`}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.currentTarget.value !== '') { setObs({ ...obs, [addField]: e.currentTarget.value }); setAddField('') } }} />
                )}
                {addField && Array.isArray(addOpts) && (
                  <Select className="!w-32" value="" aria-label={`Value of ${addField}`} onChange={(e) => { if (e.target.value) { setObs({ ...obs, [addField]: e.target.value }); setAddField('') } }}>
                    <option value="">value…</option>
                    {addOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {/* results + graph */}
      <div className="flex min-h-0 flex-1 max-[899px]:flex-col max-[899px]:overflow-auto">
        <div className="min-w-0 flex-1 overflow-auto bg-bg p-4 max-[899px]:flex-none max-[899px]:overflow-visible" aria-live="polite" aria-busy={busy}>
          <div className="mx-auto max-w-4xl space-y-6">
            {busy && !result && <p className="text-sm text-muted">The agent is working on this case…</p>}
            {!result && !busy && (
              <EmptyState icon={<Bot size={22} />} title="Run a case to see the recommendation" hint="Pick an entity, describe what happened (or choose a preset case) and press Run. The answer shows the knowledge it used and why." />
            )}
            {result && (
              <div className={`space-y-6 animate-slide-in ${busy ? 'opacity-60' : ''}`}>
                <Section title="Recommendation">
                  <div className="rounded-xl border border-accent/30 bg-surface p-5 shadow-sm">
                    <p className="text-lg font-medium leading-relaxed text-text">{result.recommendation || 'The agent had no recommendation for this case.'}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
                      {result.evidence_confidence != null && <Badge className="bg-ok/10 text-ok" title="How sure the system is about the knowledge the recommendation cites">Evidence confidence {Math.round(result.evidence_confidence * 100)}%</Badge>}
                      <Badge className="bg-surface-2 text-muted">{runEntity}</Badge>
                      {result.thread_id && (
                        <Link to={`/conversations/${encodeURIComponent(result.thread_id)}`} className="inline-flex items-center gap-1 text-accent hover:underline" title="The agent posted this advice in the thread so the outcome can be learned from the replies">
                          <MessageSquare size={13} /> Follow the outcome in the thread
                        </Link>
                      )}
                    </div>
                  </div>
                </Section>

                <Section title="Knowledge used" count={hits.length}>
                  {hits.length ? (
                    <ul className="grid gap-2 md:grid-cols-2">
                      {hits.map((hit) => {
                        const cited = result.cited_assertion_ids.includes(hit.id)
                        return (
                          <li key={hit.id} className={`min-w-0 rounded-lg border bg-surface p-3 ${cited ? 'border-accent/40' : 'border-line'}`}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <TypeBadge type={hit.type} />
                              <Link to={`/knowledge?assertion=${encodeURIComponent(hit.id)}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-accent hover:underline" title={`Open ${hit.id} in Knowledge`}>{hit.topic}</Link>
                              <IdChip>{hit.id}</IdChip>
                            </div>
                            <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted" title={hit.summary}>{hit.summary}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <TrustBadge level={hit.trust.level} labelled />
                              <Badge className="bg-surface-2 text-muted" title="How sure the system is">Confidence {Math.round(hit.confidence * 100)}%</Badge>
                              <CheckBadge hit={hit} />
                              <TrackBadge t={hit.track_record} />
                              {cited && <Badge className="bg-accent/10 text-accent">Cited</Badge>}
                            </div>
                            {hit.check_status === 'not fully checked' && !!hit.to_read?.length && <p className="mt-1.5 text-[12px] text-warn">Read first: {hit.to_read.join(', ')}</p>}
                            <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted">
                              <span>Matched via {hit.matched_via}. Valid {fmtDateTime(hit.valid_from)} to {hit.valid_to ? fmtDateTime(hit.valid_to) : 'open'}</span>
                              <Link to={`/knowledge?assertion=${encodeURIComponent(hit.id)}`} className="shrink-0 text-accent hover:underline">Open</Link>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-line bg-surface p-3 text-sm text-muted">No matching knowledge was found for this entity and time.</p>
                  )}
                </Section>

                {result.skipped.length > 0 && (
                  <Section title="Skipped rules" count={result.skipped.length}>
                    <ul className="space-y-1.5">
                      {result.skipped.map((item) => (
                        <li key={item.assertion_id} className="flex flex-wrap items-baseline gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
                          <Link to={`/knowledge?assertion=${encodeURIComponent(item.assertion_id)}`}><IdChip>{item.assertion_id}</IdChip></Link>
                          <span className="min-w-0 flex-1 text-muted">{item.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {result.verdict && (
                  <Section title="Guard verdict">
                    <div className={`rounded-lg border p-3 text-[13px] ${result.verdict.decision === 'go' ? 'border-ok/40 bg-ok/5' : 'border-warn/40 bg-warn/5'}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={result.verdict.decision === 'go' ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}>{result.verdict.decision === 'go' ? 'Go' : 'Adapt the plan'}</Badge>
                        <span className="font-medium">{result.verdict.action}</span>
                      </div>
                      {result.verdict.steps.length > 0 && <ol className="mt-2 list-inside list-decimal space-y-0.5">{result.verdict.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>}
                      {result.verdict.reasons.map((reason, i) => <p key={i} className="mt-1 text-muted">{reason}</p>)}
                    </div>
                  </Section>
                )}

                <Section title="Sources">
                  {loadingSources ? (
                    <p className="text-[13px] text-muted">Loading source messages…</p>
                  ) : sourceRows.length ? (
                    <ul className="grid gap-1.5 md:grid-cols-2">
                      {sourceRows.map((source) => (
                        <li key={`${source.file}|${source.seq ?? 'thread'}`} className="min-w-0">
                          <Link to={`/conversations/${encodeURIComponent(source.file!)}`} className="block rounded-md border border-line bg-surface px-3 py-2 hover:border-accent/50 hover:bg-accent/5" title={`Open ${source.file}${source.seq != null ? `, message ${source.seq}` : ''}`}>
                            <div className="flex items-center gap-2 text-[13px]">
                              {source.source && <span className={SOURCE_STYLE[source.source].cls}>{SOURCE_STYLE[source.source].label}</span>}
                              <span className="truncate font-medium text-text">{source.author ?? source.file}</span>
                              {source.sent_at && <time className="ml-auto shrink-0 text-muted">{fmtDateTime(source.sent_at)}</time>}
                            </div>
                            {source.text ? <p className="mt-1 line-clamp-1 text-[13px] text-muted">{source.text}</p> : source.seq != null && <p className="mt-1 text-[13px] text-muted">Message {source.seq}</p>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-muted">No linked source messages are available for this result.</p>
                  )}
                </Section>
              </div>
            )}
          </div>
        </div>

        {/* graph side panel */}
        {graphOpen ? (
          <aside className="flex w-[26rem] max-w-[45%] shrink-0 flex-col border-l border-line bg-surface max-[899px]:h-80 max-[899px]:w-full max-[899px]:max-w-none max-[899px]:border-l-0 max-[899px]:border-t" aria-label="Knowledge graph panel">
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
              <h2 className="text-sm font-semibold">Knowledge graph</h2>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted">Entity and knowledge used are highlighted</span>
              <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text" aria-label="Collapse the graph panel" title="Collapse" onClick={() => setGraphOpen(false)}><PanelRightClose size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 p-2">
              <AgentGraph targetId={result ? runEntity : entity} evidenceIds={hits.map((h) => h.id)} />
            </div>
          </aside>
        ) : (
          <button type="button" className="flex w-9 shrink-0 flex-col items-center gap-2 border-l border-line bg-surface py-3 text-muted hover:text-text max-[899px]:w-full max-[899px]:flex-row max-[899px]:justify-center max-[899px]:border-l-0 max-[899px]:border-t" aria-label="Expand the graph panel" title="Show the knowledge graph" onClick={() => setGraphOpen(true)}>
            <PanelRightOpen size={16} />
            <span className="text-[12px] [writing-mode:vertical-rl] max-[899px]:[writing-mode:horizontal-tb]">Knowledge graph</span>
          </button>
        )}
      </div>
    </div>
  )
}
