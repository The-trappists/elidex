import { ArrowUp, Bot, ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { AgentRunResult, GraphProvenance } from '../../api/types'
import { fmtDateTime, toNaiveIso } from '../../lib/format'
import { SOURCE_STYLE, TRUST_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { useSimNow } from '../../lib/useNow'
import { ObservationsEditor, toObservations } from '../data/ObservationsEditor'
import { AgentGraph } from './AgentGraph'
import { Button, Card, Field, IdChip, Input, Select, Textarea, Toggle, withToast } from '../ui'
import { TypeBadge } from './bits'

export function AgentTester() {
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const llm = useLive((s) => s.settings?.llm_configured ?? false)
  const sim = useSimNow(60_000)
  const [entity, setEntity] = useState('TRN-042')
  const [description, setDescription] = useState('An SFP was replaced on TRN-042. The interface is UP, optical levels are normal, alarms are cleared, but traffic counters remain at zero.')
  const [obs, setObs] = useState<Record<string, string>>({})
  const [planned, setPlanned] = useState('')
  const [at, setAt] = useState('')
  const [useLlm, setUseLlm] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingSources, setLoadingSources] = useState(false)
  const [result, setResult] = useState<AgentRunResult | null>(null)
  const [provenance, setProvenance] = useState<Record<string, GraphProvenance[]>>({})
  const [runEntity, setRunEntity] = useState('')

  const loadPreset = () => {
    setEntity('TRN-042')
    setDescription('An SFP was replaced on TRN-042. The interface is UP, optical levels are normal, alarms are cleared, but traffic counters remain at zero.')
    setObs({})
    setPlanned('')
    setResult(null)
    setProvenance({})
    setRunEntity('')
    setLoadingSources(false)
    setShowAdvanced(false)
  }

  const run = async () => {
    const observations = toObservations(obs)
    const effectiveAt = at || (sim ? toNaiveIso(sim) : '')
    setBusy(true)
    const r = await withToast(() =>
      api.agentRun({ entity_id: entity, description: description.trim(), observations, planned_action: planned.trim() || null, at: effectiveAt || null, use_llm: useLlm && llm }),
    )
    setBusy(false)
    if (r) {
      setResult(r)
      setRunEntity(entity)
      setLoadingSources(true)
      const rows = await Promise.all(r.hits.map(async (h) => [h.id, await api.provenance(h.id).catch(() => [])] as const))
      setProvenance(Object.fromEntries(rows))
      setLoadingSources(false)
    }
  }

  const sourceRows = result
    ? [...new Map(result.hits.flatMap((hit) => provenance[hit.id] ?? []).filter((source) => source.file).map((source) => [`${source.file}|${source.seq ?? 'thread'}`, source])).values()]
    : []

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <section className={`space-y-5 py-5 ${result ? 'animate-agent-form-dock' : ''}`}>
          <div className="relative mx-auto max-w-4xl px-12 text-center">
            <h1 className="flex items-center justify-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl"><Bot className="text-accent" size={26} /> Ask the agent</h1>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-muted">Showcase how the knowledge graph built from specialist conversations is used to guide autonomous network operations.</p>
            <Button variant="ghost" size="sm" className="mt-2 sm:absolute sm:right-0 sm:top-0 sm:mt-0" onClick={loadPreset}>Reset example</Button>
          </div>

          <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-surface shadow-md transition-shadow focus-within:shadow-lg">
            <Textarea
              rows={result ? 2 : 4}
              className="!min-h-24 !resize-y !rounded-none !border-0 !bg-transparent px-5 pt-4 text-base leading-relaxed shadow-none focus:!ring-0 sm:px-6"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened on the network? Describe the symptoms or observations…"
              aria-label="What happened?"
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-line/70 px-3 py-2 sm:px-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="!size-8 !rounded-full !px-0"
                icon={<Plus size={18} className={showAdvanced ? 'rotate-45 transition-transform' : 'transition-transform'} />}
                aria-label={showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
                aria-expanded={showAdvanced}
                title="Advanced options"
                onClick={() => setShowAdvanced((open) => !open)}
              />
              <label className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-bg px-2 text-xs text-muted">
                <span>Entity</span>
                <Select className="!h-7 !w-auto !border-0 !bg-transparent !px-0 !pr-5 text-xs font-medium text-text shadow-none focus:!ring-0" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Network entity">
                  <option value="">Choose…</option>
                  <optgroup label="Elements">{elements.map((e) => <option key={e.id} value={e.id}>{e.id} · {e.type}</option>)}</optgroup>
                  <optgroup label="Sites">{sites.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}</optgroup>
                </Select>
              </label>
              <label className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-bg px-2 text-xs text-muted" title="Defaults to the current simulated time">
                <span>At</span>
                <Input type="datetime-local" className="!h-7 !w-[10.5rem] !border-0 !bg-transparent !px-0 text-xs text-text shadow-none focus:!ring-0" value={at} placeholder={sim ? toNaiveIso(sim) : ''} onChange={(e) => setAt(e.target.value)} aria-label="At date and time" />
              </label>
              <div className="ml-auto flex items-center gap-2">
                <Toggle checked={useLlm && llm} disabled={!llm} onChange={setUseLlm} label={<span className="text-xs">Gemini</span>} />
                <Button
                  variant="primary"
                  className="!size-8 !rounded-lg !px-0"
                  disabled={!entity || !description.trim()}
                  loading={busy}
                  onClick={run}
                  aria-label="Run agent"
                  title="Run agent"
                  icon={<ArrowUp size={18} />}
                />
              </div>
            </div>
          </div>
          {!llm && <p className="-mt-3 text-center text-xs text-muted">Gemini isn’t configured; the rule-based agent will be used.</p>}

          {showAdvanced && (
            <div className="mx-auto max-w-5xl animate-slide-in rounded-xl border border-line bg-surface p-4">
              <div className="mb-3 text-sm font-semibold">Advanced options</div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Planned action" hint="Optional. The agent can check whether it fits the available knowledge.">
                  <Input value={planned} onChange={(e) => setPlanned(e.target.value)} placeholder="e.g. Replace the SFP module" />
                </Field>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">Structured observations (optional)</div>
                  <ObservationsEditor value={obs} onChange={setObs} />
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="agent-recommendation-title">
          <h2 id="agent-recommendation-title" className="px-1 text-base font-semibold">Recommendation</h2>
          {!result ? (
            <Card className="p-5 text-sm text-muted">Run the agent to see solutions and a recommendation grounded in the knowledge graph.</Card>
          ) : (
            <div className="animate-slide-in">
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Solutions found ({result.hits.length})</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {result.verdict && <span className={`rounded px-2 py-1 text-xs ${result.verdict.decision === 'go' ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}`}>Guard: {result.verdict.decision === 'go' ? 'go' : 'adapt'}</span>}
                    {result.evidence_confidence != null && <span className="rounded bg-ok/10 px-2 py-1 text-xs text-ok">Evidence confidence {Math.round(result.evidence_confidence * 100)}%</span>}
                  </div>
                </div>
                {result.hits.length ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {result.hits.map((hit) => (
                      <li key={hit.id} className="min-w-0 rounded-md border border-line bg-bg px-3 py-2">
                        <div className="flex items-center gap-2"><TypeBadge type={hit.type} /><span className="truncate text-sm font-medium">{hit.topic}</span><IdChip>{hit.id}</IdChip></div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{hit.summary}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No matching solutions were found for this entity and time.</p>
                )}

                <div className="border-t border-line pt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Recommendation</div>
                  <p
                    className="overflow-hidden text-base font-medium leading-relaxed text-text"
                    style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 5 }}
                    title={result.recommendation}
                  >{result.recommendation}</p>
                  {result.verdict && (
                    <div className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-xs">
                      <div className="font-medium">Guard plan for: {result.verdict.action}</div>
                      {result.verdict.steps.length > 0 && <ol className="mt-1 list-inside list-decimal text-muted">{result.verdict.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>}
                      {result.verdict.reasons.map((reason, i) => <p key={i} className="mt-1 text-muted">{reason}</p>)}
                    </div>
                  )}
                </div>

                {result.skipped.length > 0 && (
                  <div className="border-t border-line pt-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Not used ({result.skipped.length})</div>
                    <ul className="space-y-1.5">
                      {result.skipped.map((item) => (
                        <li key={item.assertion_id} className="rounded-md border border-line bg-bg px-3 py-2 text-xs">
                          <span className="font-medium">{item.assertion_id}</span>
                          <p className="mt-1 text-muted">{item.reason}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="border-t border-line pt-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Sources</div>
                  {loadingSources ? (
                    <p className="text-xs text-muted">Loading source messages…</p>
                  ) : sourceRows.length ? (
                    <ul className="grid max-h-36 gap-1.5 overflow-auto sm:grid-cols-2">
                      {sourceRows.map((source) => (
                        <li key={`${source.file}|${source.seq ?? 'thread'}`} className="min-w-0">
                          <Link
                            to={`/conversations/${encodeURIComponent(source.file!)}`}
                            className="block rounded-md border border-line px-3 py-2 hover:border-accent/50 hover:bg-accent/5"
                            title={`Open ${source.file}${source.seq != null ? `, message ${source.seq}` : ''}`}
                          >
                            <div className="flex items-center gap-2 text-xs">
                              {source.source && <span className={SOURCE_STYLE[source.source].cls}>{SOURCE_STYLE[source.source].label}</span>}
                              <span className="truncate font-medium text-text">{source.author ?? source.file}</span>
                              {source.sent_at && <time className="ml-auto shrink-0 text-muted">{fmtDateTime(source.sent_at)}</time>}
                              <span className="text-accent">Open ↗</span>
                            </div>
                            {source.text && <p className="mt-1 line-clamp-1 text-xs text-muted">{source.text}</p>}
                            {!source.text && source.seq != null && <p className="mt-1 text-xs text-muted">Message {source.seq}</p>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">No linked source messages are available for this result.</p>
                  )}
                </div>
              </Card>
            </div>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="agent-graph-title">
          <div className="px-1">
            <h2 id="agent-graph-title" className="text-base font-semibold">Knowledge graph</h2>
            <p className="text-xs text-muted">The target entity and knowledge used by the agent are highlighted in the graph.</p>
          </div>
          <div className="relative">
            <AgentGraph targetId={result ? runEntity : entity} evidenceIds={result?.hits.map((hit) => hit.id) ?? []} />
            <details open={Boolean(result)} className="group absolute right-3 top-3 z-10 w-[min(22rem,calc(100%-1.5rem))] overflow-hidden rounded-lg border border-line bg-surface/95 shadow-md backdrop-blur">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <ChevronDown size={15} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
                Knowledge used <span className="ml-auto rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{result?.hits.length ?? 0}</span>
              </summary>
              <div className="max-h-[65vh] space-y-1.5 overflow-auto border-t border-line p-2">
                {!result && <p className="p-2 text-xs text-muted">Run the agent to see which knowledge it used.</p>}
                {result?.hits.map((hit) => (
                  <details key={hit.id} className="group/item rounded-md border border-line bg-surface">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-2.5 py-2 text-xs [&::-webkit-details-marker]:hidden">
                      <ChevronDown size={13} className="shrink-0 text-muted transition-transform group-open/item:rotate-180" />
                      <IdChip>{hit.id}</IdChip><TypeBadge type={hit.type} /><span className="min-w-0 flex-1 font-medium">{hit.topic}</span>
                      <span className="text-muted">{Math.round(hit.confidence * 100)}%</span>
                    </summary>
                    <div className="space-y-2 border-t border-line px-3 py-2.5 text-xs">
                      <p className="leading-relaxed text-text">{hit.summary}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted">
                        <span>Matched via {hit.matched_via}</span>
                        <span>Trust: <b className={TRUST_STYLE[hit.trust.level].cls}>{TRUST_STYLE[hit.trust.level].label}</b></span>
                        <span>Valid {fmtDateTime(hit.valid_from)} → {hit.valid_to ? fmtDateTime(hit.valid_to) : 'open'}</span>
                      </div>
                    </div>
                  </details>
                ))}
                {result?.skipped.length ? (
                  <details className="rounded-md border border-line bg-surface">
                    <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted">Not used ({result.skipped.length})</summary>
                    <ul className="space-y-1 border-t border-line px-3 py-2 text-xs">
                      {result.skipped.map((item) => <li key={item.assertion_id}><IdChip>{item.assertion_id}</IdChip> <span className="text-muted">{item.reason}</span></li>)}
                    </ul>
                  </details>
                ) : null}
              </div>
            </details>
          </div>
        </section>
      </div>
    </div>
  )
}
