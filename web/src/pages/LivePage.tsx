import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { validAt } from '../components/graph/graphModel'
import { IncidentFeed } from '../components/incidents/IncidentFeed'
import { PipelineLane } from '../components/pipeline/PipelineLane'
import { Panel } from '../components/ui'
import { cn } from '../lib/cn'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

function Metric({ label, value, tone, onClick }: { label: string; value: number; tone?: 'bad' | 'warn'; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group flex items-baseline gap-2 text-left" disabled={!onClick}>
      <span className={cn('text-2xl font-semibold tabular-nums', tone === 'bad' && value > 0 && 'text-bad', tone === 'warn' && value > 0 && 'text-warn')}>{value}</span>
      <span className="text-sm text-muted group-hover:text-text">{label}</span>
    </button>
  )
}

export default function LivePage() {
  const nav = useNavigate()
  const nowSec = Math.floor((useSimNow(5000) ?? new Date()).getTime() / 1000)
  const now = useMemo(() => new Date(nowSec * 1000), [nowSec])
  const incidents = useLive((s) => s.incidents)
  const threads = useLive((s) => s.threads)
  const assertions = useLive((s) => s.assertions)
  const llmCalls = useLive((s) => s.llmCalls)

  const k = useMemo(
    () => ({
      open: Object.values(incidents).filter((i) => i.status === 'open').length,
      live: Object.values(threads).filter((t) => t.status === 'active' || t.status === 'processing').length,
      valid: Object.values(assertions).filter((a) => validAt(a, now)).length,
      llmErr: llmCalls.filter((c) => c.error || c.parse_error || c.parsed_ok === false).length,
    }),
    [incidents, threads, assertions, llmCalls, now],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-8 gap-y-1">
        <Metric label="open incidents" value={k.open} tone="bad" />
        <Metric label="conversations in progress" value={k.live} onClick={() => nav('/conversations')} />
        <Metric label="pieces of knowledge in force" value={k.valid} onClick={() => nav('/knowledge')} />
        {k.llmErr > 0 && <Metric label="AI problems" value={k.llmErr} tone="warn" onClick={() => nav('/llm')} />}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <Panel title="Incidents">
          <IncidentFeed />
        </Panel>
        <Panel title="Recent processing" actions={<span className="text-xs text-muted">Click a row to follow its steps</span>}>
          <PipelineLane />
        </Panel>
      </div>
    </div>
  )
}
