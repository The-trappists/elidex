import { Bot, CheckCircle2, ChevronDown, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { AgentRunResult, GraphProvenance } from '../../api/types'
import { fmtDateTime, toNaiveIso } from '../../lib/format'
import { SOURCE_STYLE, TRUST_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { useSimNow } from '../../lib/useNow'
import { ObservationsEditor, toObservations } from '../data/ObservationsEditor'
import { AgentGraph } from './AgentGraph'
import { Avatar, Button, Card, Field, IdChip, Input, Select, Textarea, Toggle, withToast } from '../ui'
import { TypeBadge } from './bits'

function groupProvenance(rows: GraphProvenance[]) {
  const groups = new Map<string, { key: string; source: GraphProvenance['source']; file: string; messages: GraphProvenance[] }>()
  for (const row of rows) {
    const file = row.file ?? 'Unknown source'
    const key = `${row.source ?? 'unknown'}|${file}`
    let group = groups.get(key)
    if (!group) {
      group = { key, source: row.source, file, messages: [] }
      groups.set(key, group)
    }
    group.messages.push(row)
  }
  return [...groups.values()]
}

export function AgentTester() {
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const llm = useLive((s) => s.settings?.llm_configured ?? false)
  const sim = useSimNow(60_000)
  const [entity, setEntity] = useState('TRN-042')
  const [description, setDescription] = useState('An SFP was replaced on TRN-042. The interface is UP, optical levels are normal, alarms are cleared, but traffic counters remain at zero.')
  const [obs, setObs] = useState<Record<string, string>>({})
  const [planned, setPlanned] = useState('Replace the SFP module again')
  const [at, setAt] = useState('')
  const [useLlm, setUseLlm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AgentRunResult | null>(null)
  const [provenance, setProvenance] = useState<Record<string, GraphProvenance[]>>({})
  const [runEntity, setRunEntity] = useState('')

  const loadPreset = () => {
    setEntity('TRN-042')
    setDescription('An SFP was replaced on TRN-042. The interface is UP, optical levels are normal, alarms are cleared, but traffic counters remain at zero.')
    setObs({})
    setPlanned('Replace the SFP module again')
    setResult(null)
    setProvenance({})
    setRunEntity('')
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
      const rows = await Promise.all(r.hits.map(async (h) => [h.id, await api.provenance(h.id).catch(() => [])] as const))
      setProvenance(Object.fromEntries(rows))
    }
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <Card className="space-y-4 p-5 md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 text-center">
              <div className="mb-1 flex items-center justify-center gap-2 text-lg font-semibold"><Bot size={19} /> Ask the agent</div>
              <p className="text-sm text-muted">Describe the issue. The agent checks human knowledge for this network entity and time.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={loadPreset}>Reset example</Button>
          </div>

          <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Network entity">
              <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
                <option value="">Select an element or site…</option>
                <optgroup label="Elements">{elements.map((e) => <option key={e.id} value={e.id}>{e.id} ({e.type}, {e.model})</option>)}</optgroup>
                <optgroup label="Sites">{sites.map((s) => <option key={s.id} value={s.id}>{s.id} ({s.name})</option>)}</optgroup>
              </Select>
            </Field>
            <Field label="Case time" hint="Defaults to the current simulated time.">
              <Input type="datetime-local" value={at} placeholder={sim ? toNaiveIso(sim) : ''} onChange={(e) => setAt(e.target.value)} />
            </Field>
          </div>

          <div className="mx-auto w-full max-w-3xl">
            <Field label="What happened?">
              <Textarea
                rows={3}
                className="resize-y text-base leading-relaxed"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the issue and what you observed…"
              />
            </Field>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field className="min-w-0 flex-1" label="Planned action" hint="Optional. The agent can check whether it fits the available knowledge.">
                <Input value={planned} onChange={(e) => setPlanned(e.target.value)} placeholder="e.g. Replace the SFP module" />
              </Field>
              <Button variant="primary" className="w-full sm:w-auto" disabled={!entity || !description.trim()} loading={busy} onClick={run}>Run agent</Button>
            </div>
            <details className="group mt-3 rounded-md border border-line px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted">Advanced options</summary>
              <div className="space-y-4 pt-3">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">Structured observations (optional)</div>
                  <ObservationsEditor value={obs} onChange={setObs} />
                </div>
                <div className="border-t border-line pt-3">
                  <Toggle checked={useLlm && llm} disabled={!llm} onChange={setUseLlm} label="Use Gemini" />
                  {!llm && <div className="mt-0.5 text-xs text-muted">Gemini is not configured; using the rule-based agent.</div>}
                </div>
              </div>
            </details>
          </div>
        </Card>

        <div className="space-y-3">
        {!result ? (
          <Card className="p-6 text-center text-sm text-muted">The recommendation will appear here.</Card>
        ) : (
          <>
            {result.verdict && (
              <Card className={`p-4 ${result.verdict.decision === 'go' ? 'border-ok/50 bg-ok/10' : 'border-warn/50 bg-warn/10'}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {result.verdict.decision === 'go' ? <CheckCircle2 size={16} className="text-ok" /> : <TriangleAlert size={16} className="text-warn" />}
                  Guard: {result.verdict.decision === 'go' ? 'go' : 'adapt'}
                </div>
                <div className="mt-1 text-xs">{result.verdict.action}</div>
                {result.verdict.steps.length > 0 && <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs">{result.verdict.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
                {result.verdict.reasons.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">{result.verdict.reasons.map((s, i) => <li key={i}>{s}</li>)}</ul>}
              </Card>
            )}
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Recommendation</div>
                {result.evidence_confidence != null && <span className="rounded bg-ok/10 px-2 py-1 text-xs text-ok">Evidence confidence {Math.round(result.evidence_confidence * 100)}%</span>}
              </div>
              <p
                className="overflow-hidden text-base font-medium leading-relaxed text-text"
                style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 5 }}
                title={result.recommendation}
              >
                {result.recommendation}
              </p>
              {result.cited_assertion_ids.length > 0 && <p className="mt-2 text-xs text-muted">Cited knowledge: {result.cited_assertion_ids.join(', ')}</p>}
              {result.evidence_confidence != null && <p className="mt-1 text-xs text-muted">Calculated from the cited assertions’ confidence, trust level, and independent source count; it is not Gemini’s self-rating.</p>}
            </Card>
            {result && (
              <Card className="p-4">
                <div className="mb-3 text-sm font-semibold">Knowledge graph</div>
                <AgentGraph targetId={runEntity} evidenceIds={result.hits.map((h) => h.id)} />
              </Card>
            )}
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold">Knowledge used ({result.hits.length})</div>
              {result.hits.length === 0 && <div className="text-xs text-muted">No knowledge matched this equipment at this time.</div>}
              <div className="space-y-1.5">
                {result.hits.map((h) => (
                  <details key={h.id} className="group rounded-md border border-line bg-surface">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-2.5 py-2 [&::-webkit-details-marker]:hidden">
                      <ChevronDown size={14} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
                      <IdChip>{h.id}</IdChip><TypeBadge type={h.type} /><span className="font-medium">{h.topic}</span>
                      <span className="ml-auto text-muted">{Math.round(h.confidence * 100)}% confidence</span>
                    </summary>
                    <div className="space-y-3 border-t border-line px-3 py-3">
                      <p className="text-sm leading-relaxed text-text">{h.summary}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                        <span>Matched via {h.matched_via}</span>
                        <span>Trust: <b className={TRUST_STYLE[h.trust.level].cls}>{TRUST_STYLE[h.trust.level].label}</b></span>
                        <span>Valid {fmtDateTime(h.valid_from)} → {h.valid_to ? fmtDateTime(h.valid_to) : 'open'}</span>
                      </div>
                      {groupProvenance(provenance[h.id] ?? []).map((group) => (
                        <div key={group.key} className="overflow-hidden rounded-md border border-line bg-bg">
                          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs">
                            {group.source && <span className={SOURCE_STYLE[group.source].cls}>{SOURCE_STYLE[group.source].label}</span>}
                            <span className="truncate text-muted">{group.file}</span>
                          </div>
                          <div className="space-y-2.5 p-3">
                            {group.messages.map((p, i) => (
                              <div key={`${p.seq}-${i}`} className="flex items-start gap-2.5">
                                <Avatar name={p.author ?? 'Unknown author'} size={26} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-baseline gap-x-2">
                                    <span className="text-xs font-semibold text-text">{p.author ?? 'Unknown author'}</span>
                                    {p.role && <span className="text-xs text-muted">{p.role}</span>}
                                    <time className="text-[11px] text-muted">{p.sent_at ? fmtDateTime(p.sent_at) : ''}</time>
                                  </div>
                                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-text">{p.text ?? 'Source message is not loaded.'}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </Card>
            {result.skipped.length > 0 && (
              <Card className="p-4">
                <div className="mb-2 text-sm font-semibold">Skipped ({result.skipped.length})</div>
                <ul className="space-y-1 text-xs">
                  {result.skipped.map((s) => <li key={s.assertion_id}><IdChip>{s.assertion_id}</IdChip> <span className="text-muted">{s.reason}</span></li>)}
                </ul>
              </Card>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  )
}
