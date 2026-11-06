import { AlertTriangle, BookCheck, Cpu, MessagesSquare, Network, Siren, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NetworkGraph } from '../components/graph/NetworkGraph'
import { validAt } from '../components/graph/graphModel'
import { IncidentFeed } from '../components/incidents/IncidentFeed'
import { ChatTicker } from '../components/pipeline/ChatTicker'
import { PipelineLane } from '../components/pipeline/PipelineLane'
import { Panel, Stat } from '../components/ui'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

export default function LivePage() {
  const nav = useNavigate()
  // Round to the second so memoized values do not recompute on every render.
  const nowSec = Math.floor((useSimNow(5000) ?? new Date()).getTime() / 1000)
  const now = useMemo(() => new Date(nowSec * 1000), [nowSec])
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
      total: Object.keys(threads).length,
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
        <Stat icon={<Siren size={19} />} label="Open incidents" hint={k.open ? 'need attention' : 'all clear'} value={k.open} tone={k.open ? 'bad' : 'ok'} onClick={() => nav('/')} />
        <Stat icon={<MessagesSquare size={19} />} label="Conversations in progress" hint="being read right now" value={k.live} tone={k.live ? 'ok' : 'neutral'} onClick={() => nav('/conversations')} />
        <Stat icon={<BookCheck size={19} />} label="Things the team knows" hint="valid at this moment" value={k.valid} tone="accent" onClick={() => nav('/knowledge')} />
        <Stat icon={<Workflow size={19} />} label="Conversations processed today" value={k.jobsToday} />
        <Stat icon={<AlertTriangle size={19} />} label="AI problems" hint={k.llmErr ? 'see what failed' : 'none'} value={k.llmErr} tone={k.llmErr ? 'warn' : 'ok'} onClick={() => nav('/llm')} />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Panel
            title="Network and what we know about it"
            icon={<Network size={15} />}
            className="min-h-0 flex-[3]"
            bodyClassName="relative overflow-hidden"
            actions={<span className="flex items-center gap-1 text-xs text-muted"><span className={running ? 'live-dot size-1.5 rounded-full bg-ok text-ok' : 'size-1.5 rounded-full bg-muted'} />{running ? 'Simulation running' : 'Simulation paused'}</span>}
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
          <Panel title="How conversations become knowledge" icon={<Cpu size={15} />} className="min-h-0 flex-[2]">
            <PipelineLane />
          </Panel>
        </div>

        <div className="flex w-[420px] shrink-0 flex-col gap-3 2xl:w-[480px]">
          <Panel title="Incidents" icon={<Siren size={15} />} className="min-h-0 flex-[3]">
            <IncidentFeed />
          </Panel>
          <Panel title="Latest messages" icon={<MessagesSquare size={15} />} className="min-h-0 flex-[2]" bodyClassName="overflow-hidden">
            <ChatTicker />
          </Panel>
        </div>
      </div>
    </div>
  )
}
