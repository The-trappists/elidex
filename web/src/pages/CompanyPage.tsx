import { Building2, CalendarCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type ArchiveStats } from '../api/client'
import { Button } from '../components/ui'
import { callCount } from '../components/company/status'
import { isDemo } from '../api/fixtures/company'
import { AutonomousPanel } from '../components/company/AutonomousPanel'
import { CompanyGraph } from '../components/company/CompanyGraph'
import { useSinceSync } from '../components/company/useSinceSync'
import { CompanyHeader } from '../components/company/CompanyHeader'
import { CompanyKpis } from '../components/company/CompanyKpis'
import { ConversationFeed } from '../components/company/ConversationFeed'
import { NetworkStatus } from '../components/company/NetworkStatus'
import { ExportButtons } from '../components/company/PackageDrawer'
import { PipelineLane } from '../components/pipeline/PipelineLane'
import { Badge, Panel } from '../components/ui'
import { cn } from '../lib/cn'
import type { CompanyState } from '../api/types'
import { useLive } from '../store/live'

/** One line under the header: what state the day is in and what to do about it. */
function StateLine({ c }: { c: CompanyState }) {
  const [archive, setArchive] = useState<ArchiveStats | null>(null)
  const syncs = c.cycles.length
  useEffect(() => {
    if (isDemo()) return
    let stale = false
    api.companyArchiveStats().then((a) => !stale && setArchive(a)).catch(() => !stale && setArchive(null))
    return () => {
      stale = true
    }
  }, [syncs, c.status])
  const stored = archive ? Object.entries(archive.counts).map(([k, n]) => `${n} ${k}`).join(', ') : ''
  const text =
    c.status === 'idle'
      ? 'No company day is running. Start one to simulate a working day: many chats, incidents opening and closing, and the autonomous system syncing every ' + c.cycle_minutes + ' minutes.'
      : c.status === 'finished'
        ? `The day has ended after ${c.cycles.length} syncs and ${callCount(c)} agent calls. Everything below is what happened; start another day to run it again.`
        : c.status === 'paused'
          ? 'The day is paused. Nothing moves until you resume.'
          : c.endless
            ? 'The day is endless: after the scripted chats, new chats are generated live until you stop it. Pipelines, the graph and the network status update live.'
            : 'The day is running. Pipelines, the graph and the network status update live.'
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5 text-sm', c.status === 'idle' ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface')}>
      <CalendarCheck size={16} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-muted">
        {text}
        {archive && (
          <span className="ml-2 whitespace-nowrap text-xs">
            · Archive: <span className="font-medium text-text">{archive.backend}</span>{stored && ` (${stored})`}
          </span>
        )}
      </span>
      <ExportButtons />
    </div>
  )
}

export default function CompanyPage() {
  const c = useLive((s) => s.company)
  const loadCompany = useLive((s) => s.loadCompany)
  const failed = useLive((s) => s.companyError)
  const [onlyNew, setOnlyNew] = useState(false)
  useEffect(() => void loadCompany(), [loadCompany])
  const since = useSinceSync(c ?? { cycles: [], started_at: null })

  if (!c && failed)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
        <Building2 size={28} />
        The company day is unavailable. Is the workbench running with the company routes?
        <Button onClick={() => void loadCompany()}>Try again</Button>
      </div>
    )
  if (!c)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
        <Building2 size={28} />
        Loading the company day…
      </div>
    )

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 lg:p-4">
      <CompanyHeader c={c} />
      <StateLine c={c} />
      <CompanyKpis c={c} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:min-h-[560px] lg:grid-cols-12 lg:grid-rows-1">
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 max-lg:h-[640px] lg:col-span-3">
          <Panel title="Pipeline" actions={<Badge>{c.status === 'running' ? 'live' : 'idle'}</Badge>}>
            <PipelineLane limit={12} compact />
          </Panel>
          <Panel title="Conversations" bodyClassName="overflow-hidden">
            <ConversationFeed />
          </Panel>
        </div>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3 max-lg:h-[760px] lg:col-span-5">
          <Panel
            title="Knowledge graph"
            actions={<Badge className="bg-accent-soft text-accent" title="Knowledge created since the last autonomous sync">+{since.count} since last sync</Badge>}
            bodyClassName="overflow-hidden"
          >
            <CompanyGraph since={since.ids} onlyNew={onlyNew} onOnlyNew={setOnlyNew} />
          </Panel>
          <Panel title="Network status" bodyClassName="overflow-hidden">
            <NetworkStatus c={c} />
          </Panel>
        </div>
        <div className="min-h-0 max-lg:h-[640px] lg:col-span-4">
          <Panel title={`Autonomous network system (every ${c.cycle_minutes} min)`} className="h-full" bodyClassName="overflow-hidden">
            <AutonomousPanel c={c} />
          </Panel>
        </div>
      </div>
    </div>
  )
}
