import { AlertTriangle, BookOpenCheck, Eye, MessagesSquare } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { validAt } from '../components/graph/graphModel'
import { IncidentFeed } from '../components/incidents/IncidentFeed'
import { PipelineLane } from '../components/pipeline/PipelineLane'
import { recentProblems } from '../components/llm/status'
import { Panel, Stat } from '../components/ui'
import { useOpenFlagCount } from '../store/review'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

export default function LivePage() {
  const nav = useNavigate()
  const nowSec = Math.floor((useSimNow(5000) ?? new Date()).getTime() / 1000)
  const now = useMemo(() => new Date(nowSec * 1000), [nowSec])
  const incidents = useLive((s) => s.incidents)
  const threads = useLive((s) => s.threads)
  const assertions = useLive((s) => s.assertions)
  const llmCalls = useLive((s) => s.llmCalls)
  const needLook = useOpenFlagCount()

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
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<AlertTriangle size={18} />} label="Open incidents" hint="Scripted, never detected" value={k.open} tone={k.open > 0 ? 'bad' : 'neutral'} />
        <Stat icon={<MessagesSquare size={18} />} label="Conversations in progress" hint="Waiting to be read" value={k.live} tone="accent" onClick={() => nav('/conversations')} />
        <Stat icon={<BookOpenCheck size={18} />} label="Knowledge in force" hint="Captured and linked" value={k.valid} tone="ok" onClick={() => nav('/knowledge')} />
        {k.llmErr > 0 ? (
          <Stat icon={<AlertTriangle size={18} />} label="AI problems, last hour" hint="Open AI activity" value={k.llmErr} tone="warn" onClick={() => nav('/llm')} />
        ) : (
          <Stat icon={<Eye size={18} />} label="Needs a look" hint="Optional, nothing waits" value={needLook} onClick={() => nav('/review')} />
        )}
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
