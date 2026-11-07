import { ArrowRight, BookOpenCheck, MessagesSquare, Waypoints } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { validAt } from '../components/graph/graphModel'
import { IncidentFeed } from '../components/incidents/IncidentFeed'
import { PipelineLane } from '../components/pipeline/PipelineLane'
import { recentProblems } from '../components/llm/status'
import { Panel } from '../components/ui'
import { cn } from '../lib/cn'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

function Metric({ label, value, tone, onClick }: { label: string; value: number; tone?: 'bad' | 'warn'; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="overview-metric group flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface px-5 py-4 text-left enabled:hover:border-accent/50"
      disabled={!onClick}
    >
      <span
        className={cn(
          'font-display text-3xl font-medium tabular-nums',
          tone === 'bad' && value > 0 && 'text-bad',
          tone === 'warn' && value > 0 && 'text-warn',
        )}
      >
        {value}
      </span>
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
      llmErr: recentProblems(llmCalls).length,
    }),
    [incidents, threads, assertions, llmCalls, now],
  )

  return (
    <div className="overview-page flex h-full min-h-0 flex-col gap-6 overflow-auto p-5 xl:p-8">
      <div className="overview-intro flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">The as-experienced layer</p>
          <h2 className="font-display text-3xl font-medium tracking-tight">From conversation to context.</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Follow what specialists share, what the network remembers, and what agents can reuse.
          </p>
        </div>
        <Link to="/graph" className="flex items-center gap-2 text-sm font-medium text-accent">
          Explore the knowledge graph <ArrowRight size={16} />
        </Link>
      </div>
      <div className="context-flow grid shrink-0 gap-0 overflow-hidden rounded-xl border border-line bg-surface md:grid-cols-3">
        {[
          { icon: MessagesSquare, label: 'Capture', detail: 'Knowledge from everyday conversations', to: '/conversations' },
          { icon: Waypoints, label: 'Link', detail: 'The right equipment, scope and time', to: '/graph' },
          { icon: BookOpenCheck, label: 'Reuse', detail: 'Source-backed context for agents', to: '/knowledge' },
        ].map(({ icon: Icon, label, detail, to }) => (
          <Link key={to} to={to} className="flow-stop group flex items-center gap-4 px-5 py-5 hover:bg-accent-soft">
            <span className="flow-node flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-bg text-accent">
              <Icon size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{label}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>
            </div>
            <ArrowRight size={15} className="ml-auto shrink-0 text-muted group-hover:text-accent" />
          </Link>
        ))}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric label="open incidents" value={k.open} tone="bad" />
        <Metric label="conversations in progress" value={k.live} onClick={() => nav('/conversations')} />
        <Metric label="active knowledge" value={k.valid} onClick={() => nav('/knowledge')} />
        {k.llmErr > 0 && <Metric label="AI problems in the last hour" value={k.llmErr} tone="warn" onClick={() => nav('/llm')} />}
      </div>

      <div className="overview-feeds grid min-h-[300px] flex-1 gap-5 lg:grid-cols-2">
        <Panel title="Agent reuse" actions={<span className="text-xs text-muted">Scripted incidents</span>}>
          <IncidentFeed />
        </Panel>
        <Panel title="Recent processing" actions={<span className="text-xs text-muted">Trace a conversation</span>}>
          <PipelineLane />
        </Panel>
      </div>
    </div>
  )
}
