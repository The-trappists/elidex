import { Bot, CheckCircle2, ShieldAlert, SkipForward } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AgentRunResult, Incident } from '../../api/types'
import { cn } from '../../lib/cn'
import { Button, Field, Input, Modal, toast } from '../ui'
import { HitRow } from './HitRow'

/** Runs the agent on an incident (optional planned action) and shows recommendation, hits, skips and the guard verdict. */
export function AgentModal({ incident, onClose }: { incident: Incident | null; onClose: () => void }) {
  const [planned, setPlanned] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AgentRunResult | null>(null)

  useEffect(() => {
    setPlanned('')
    setResult(null)
  }, [incident?.id])

  const run = async () => {
    if (!incident) return
    setRunning(true)
    try {
      setResult(
        await api.agentRun({
          entity_id: incident.entity_id,
          observations: incident.observations,
          planned_action: planned.trim() || null,
          description: incident.summary,
        }),
      )
    } catch (e) {
      toast.error(e)
    } finally {
      setRunning(false)
    }
  }

  const v = result?.verdict
  return (
    <Modal
      open={!!incident}
      onClose={onClose}
      wide
      title={
        <span className="flex items-center gap-2">
          <Bot size={18} className="text-accent" /> Ask the agent about {incident?.entity_id}
        </span>
      }
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" loading={running} icon={<Bot size={14} />} onClick={run}>
            {result ? 'Run again' : 'Run agent'}
          </Button>
        </>
      }
    >
      {incident && (
        <div className="space-y-4">
          <p className="text-sm text-muted">{incident.summary}</p>
          <Field label="Planned action (optional)" hint='What the agent intends to do, for example "restart the interface". The guard checks it against what people said.'>
            <Input value={planned} onChange={(e) => setPlanned(e.target.value)} placeholder="e.g. restart the interface" onKeyDown={(e) => e.key === 'Enter' && run()} />
          </Field>

          {!result && !running && <p className="text-xs text-muted">Press “Run agent” to see what it would do with and without the team's knowledge.</p>}

          {result && (
            <div className="space-y-4">
              <div className="rounded-xl border border-accent/30 bg-accent-soft p-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">Recommendation</div>
                <p className="whitespace-pre-wrap text-sm">{result.recommendation}</p>
              </div>

              {v && (
                <div className={cn('rounded-xl border p-3', v.decision === 'go' ? 'border-ok/40 bg-ok/10' : 'border-warn/40 bg-warn/10')}>
                  <div className={cn('flex items-center gap-1.5 text-sm font-semibold', v.decision === 'go' ? 'text-ok' : 'text-warn')}>
                    {v.decision === 'go' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
                    Guard: {v.decision === 'go' ? 'go' : 'adapt'} · {v.action}
                  </div>
                  {v.steps.length > 0 && (
                    <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">{v.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  )}
                  {v.reasons.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">{v.reasons.map((s, i) => <li key={i}>{s}</li>)}</ul>}
                </div>
              )}

              <div>
                <div className="mb-1.5 text-xs font-semibold text-muted">Knowledge used ({result.hits.length})</div>
                {result.hits.length ? (
                  <div className="space-y-1.5">{result.hits.map((h) => <HitRow key={h.id} hit={h} />)}</div>
                ) : (
                  <p className="text-xs text-muted">No knowledge applied.</p>
                )}
              </div>

              {result.skipped.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-muted">Skipped ({result.skipped.length})</div>
                  <ul className="space-y-1">
                    {result.skipped.map((s) => (
                      <li key={s.assertion_id} className="flex items-start gap-1.5 text-xs text-muted">
                        <SkipForward size={12} className="mt-0.5 shrink-0" />
                        <span><span className="font-mono text-text">{s.assertion_id}</span>: {s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
