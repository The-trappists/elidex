import { Bot, CheckCircle2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { AgentRunResult } from '../../api/types'
import { toNaiveIso } from '../../lib/format'
import { useLive } from '../../store/live'
import { useSimNow } from '../../lib/useNow'
import { ObservationsEditor, toObservations } from '../data/ObservationsEditor'
import { Button, Card, Field, IdChip, Input, Select, Textarea, Toggle, withToast } from '../ui'
import { TypeBadge } from './bits'

export function AgentTester() {
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const llm = useLive((s) => s.settings?.llm_configured ?? false)
  const sim = useSimNow(60_000)
  const [entity, setEntity] = useState('')
  const [obs, setObs] = useState<Record<string, string>>({})
  const [planned, setPlanned] = useState('')
  const [at, setAt] = useState('')
  const [useLlm, setUseLlm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AgentRunResult | null>(null)

  const run = async () => {
    const observations = toObservations(obs)
    setBusy(true)
    const r = await withToast(() =>
      api.agentRun({ entity_id: entity, observations, planned_action: planned.trim() || null, at: at || (sim ? toNaiveIso(sim) : null), use_llm: useLlm && llm }),
    )
    setBusy(false)
    if (r) setResult(r)
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-2">
      <Card className="h-fit space-y-4 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Bot size={16} /> Ask the agent</div>
        <p className="text-xs text-muted">Play an agent that is about to act on a network entity. It looks up the knowledge valid at the chosen time and tells you what it would do.</p>
        <Field label="Entity">
          <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Select an element or site…</option>
            <optgroup label="Elements">{elements.map((e) => <option key={e.id} value={e.id}>{e.id} ({e.type}, {e.model})</option>)}</optgroup>
            <optgroup label="Sites">{sites.map((s) => <option key={s.id} value={s.id}>{s.id} ({s.name})</option>)}</optgroup>
          </Select>
        </Field>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Observations</div>
          <ObservationsEditor value={obs} onChange={setObs} />
        </div>
        <Field label="Planned action" hint="Optional. The guard checks it against the knowledge.">
          <Textarea rows={2} value={planned} onChange={(e) => setPlanned(e.target.value)} placeholder="e.g. Replace the SFP module on the interface" />
        </Field>
        <Field label="At (sim time)" hint="Empty means now.">
          <Input type="datetime-local" value={at} placeholder={sim ? toNaiveIso(sim) : ''} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <div className="flex items-center justify-between">
          <div>
            <Toggle checked={useLlm && llm} disabled={!llm} onChange={setUseLlm} label="Use the LLM" />
            {!llm && <div className="mt-0.5 text-[11px] text-muted">No LLM configured, so the rule-based agent is used.</div>}
          </div>
          <Button variant="primary" disabled={!entity} loading={busy} onClick={run}>Run agent</Button>
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
              <div className="mb-2 text-sm font-semibold">Recommendation</div>
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{result.recommendation}</pre>
            </Card>
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold">Knowledge used ({result.hits.length})</div>
              {result.hits.length === 0 && <div className="text-xs text-muted">No assertion matched this entity at this time.</div>}
              <div className="space-y-1.5">
                {result.hits.map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-xs">
                    <IdChip>{h.id}</IdChip><TypeBadge type={h.type} /><span className="font-medium">{h.topic}</span>
                    <span className="ml-auto text-muted">via {h.matched_via}</span>
                  </div>
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
  )
}
