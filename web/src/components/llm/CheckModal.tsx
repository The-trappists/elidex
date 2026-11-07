import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { LlmCheckResult } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtMs } from '../../lib/format'
import { useLive } from '../../store/live'
import { Badge, Button, Modal, toast } from '../ui'

export function CheckModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const configured = useLive((s) => s.settings?.llm_configured ?? false)
  const [results, setResults] = useState<LlmCheckResult[] | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      setResults(await api.llmCheck())
    } catch (e) {
      toast.error(e)
    }
    setBusy(false)
  }
  useEffect(() => {
    if (open && configured) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Modal open={open} onClose={onClose} wide title="LLM check" footer={<>{configured && <Button loading={busy} onClick={run}>Run again</Button>}<Button variant="primary" onClick={onClose}>Close</Button></>}>
      {!configured ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium">No LLM is configured.</p>
          <p className="text-muted">Without a key, extraction runs in scripted mode and scenario generation is disabled. To enable it, copy <code>.env.example</code> to <code>.env</code> and fill in one provider:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li><b>Gemini (free):</b> create a key in Google AI Studio and set it as the primary provider.</li>
            <li><b>Featherless (fallback):</b> add credit and put its key and model as the fallback provider.</li>
          </ul>
          <p className="text-muted">Restart the backend after editing <code>.env</code>.</p>
        </div>
      ) : busy && !results ? (
        <div className="py-8 text-center text-sm text-muted">Pinging providers and testing JSON modes…</div>
      ) : (
        <div className="space-y-5">
          {results?.map((r) => (
            <div key={r.provider + r.model} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{r.provider}</span>
                <span className="font-mono text-xs text-muted">{r.model}</span>
                <Badge className={r.ping_ok ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}>{r.ping_ok ? 'ping ok' : 'ping failed'}</Badge>
              </div>
              <div className="text-xs text-muted">{r.base_url}</div>
              <table className="mt-2 w-full text-xs">
                <thead><tr className="text-left text-muted"><th className="py-1 font-medium">JSON mode</th><th className="font-medium">Result</th><th className="font-medium">Latency</th><th className="font-medium">Items</th><th className="font-medium">Error</th></tr></thead>
                <tbody>
                  {Object.entries(r.modes).map(([m, v]) => (
                    <tr key={m} className="border-t border-line/60">
                      <td className="py-1 font-mono">{m}</td>
                      <td className={cn(v.ok ? 'text-ok' : 'text-bad')}>{v.ok ? 'ok' : 'failed'}</td>
                      <td>{fmtMs(v.latency_ms)}</td>
                      <td>{v.items ?? '—'}</td>
                      <td className="max-w-xs truncate text-muted" title={v.error ?? ''}>{v.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-xs">
                {r.recommended_mode ? (
                  <>Recommended: put <code className="rounded bg-surface-2 px-1 font-mono">LLM_JSON_MODE={r.recommended_mode}</code> in your <code>.env</code>.</>
                ) : (
                  <span className="text-bad">No JSON mode worked for this provider.</span>
                )}
              </div>
            </div>
          ))}
          {results?.length === 0 && <div className="text-sm text-muted">No provider returned a result.</div>}
          <div className="text-xs text-muted">Every check call is also listed in the <Link to="/llm" className="text-accent" onClick={onClose}>LLM log</Link> (purpose "check").</div>
        </div>
      )}
    </Modal>
  )
}
