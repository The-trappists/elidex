import { Activity, AlertTriangle, BookCheck, Cpu, MessagesSquare, Network, Siren, Workflow } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { NetworkGraph } from '../components/graph/NetworkGraph'
import { validAt } from '../components/graph/graphModel'
import { IncidentFeed } from '../components/incidents/IncidentFeed'
import { ChatTicker } from '../components/pipeline/ChatTicker'
import { PipelineLane } from '../components/pipeline/PipelineLane'
import { Card, Panel } from '../components/ui'
import { cn } from '../lib/cn'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

function Kpi({ icon, label, value, tone, onClick }: { icon: ReactNode; label: string; value: number; tone?: string; onClick?: () => void }) {
  return (
    <div className="flex-1" onClick={onClick}>
    <Card className={cn('flex items-center gap-3 px-3.5 py-2.5', onClick && 'cursor-pointer hover:border-accent')}>
      <span className={cn('flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted', tone)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-xl font-semibold leading-none tabular-nums" >{value}</div>
        <div className="mt-1 truncate text-[11px] text-muted">{label}</div>
      </div>
    </Card>
    </div>
  )
}

export default function LivePage() {
  const nav = useNavigate()
  const now = useSimNow(5000) ?? new Date()
  const incidents = useLive((s) => s.incidents)
  const threads = useLive((s) => s.threads)
  const assertions = useLive((s) => s.assertions)
  const jobs = useLive((s) => s.jobs)
  const llmCalls = useLive((s) => s.llmCalls)
  const running = useLive((s) => s.clock?.running ?? false)
  const [knowledge, setKnowledge] = useState(true)

  const k = useMemo(() => {
    const today = new Date().toDateString() // job timestamps are wall time
    return {
      open: Object.values(incidents).filter((i) => i.status === 'open').length,
      live: Object.values(threads).filter((t) => t.status === 'active' || t.status === 'processing').length,
      valid: Object.values(assertions).filter((a) => validAt(a, now)).length,
      jobsToday: jobs.filter((j) => new Date(j.started_at).toDateString() === today).length,
      llmErr: llmCalls.filter((c) => c.error || c.parse_error || c.parsed_ok === false).length,
    }
  }, [incidents, threads, assertions, jobs, llmCalls, now])

  const empty = !Object.keys(threads).length && !Object.keys(incidents).length && !jobs.length

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex shrink-0 gap-3">
        <Kpi icon={<Siren size={18} />} label="Open incidents" value={k.open} tone={k.open ? 'bg-bad/15 text-bad' : undefined} />
        <Kpi icon={<MessagesSquare size={18} />} label="Live conversations" value={k.live} tone={k.live ? 'bg-ok/15 text-ok' : undefined} onClick={() => nav('/conversations')} />
        <Kpi icon={<BookCheck size={18} />} label="Assertions valid now" value={k.valid} tone="bg-accent-soft text-accent" onClick={() => nav('/knowledge')} />
        <Kpi icon={<Workflow size={18} />} label="Pipeline jobs today" value={k.jobsToday} />
        <Kpi icon={<AlertTriangle size={18} />} label="LLM calls with errors" value={k.llmErr} tone={k.llmErr ? 'bg-warn/15 text-warn' : undefined} onClick={() => nav('/llm')} />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Panel
            title="Network and knowledge"
            icon={<Network size={15} />}
            className="min-h-0 flex-[3]"
            bodyClassName="relative overflow-hidden"
            actions={<span className="flex items-center gap-1 text-[11px] text-muted"><Activity size={12} className={running ? 'text-ok' : ''} />{running ? 'clock running' : 'clock paused'}</span>}
          >
            <div className="absolute inset-0">
              <NetworkGraph at={now} layers={{ knowledge }} onLayersChange={(l) => setKnowledge(l.knowledge)} onSelect={(id) => id && nav(`/network?select=${encodeURIComponent(id)}`)} />
              {empty && (
                <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                  <div className="rounded-full border border-accent/30 bg-accent-soft px-4 py-1.5 text-xs font-medium text-accent shadow-sm">
                    Nothing happening yet. Start the clock and run a scenario from the top bar.
                  </div>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Pipeline" icon={<Cpu size={15} />} className="min-h-0 flex-[2]">
            <PipelineLane />
          </Panel>
        </div>

        <div className="flex w-[420px] shrink-0 flex-col gap-3 2xl:w-[480px]">
          <Panel title="Incidents" icon={<Siren size={15} />} className="min-h-0 flex-[3]">
            <IncidentFeed />
          </Panel>
          <Panel title="Live chat" icon={<MessagesSquare size={15} />} className="min-h-0 flex-[2]" bodyClassName="overflow-hidden">
            <ChatTicker />
          </Panel>
        </div>
      </div>
    </div>
  )
}
