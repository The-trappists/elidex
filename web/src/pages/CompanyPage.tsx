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
import { Badge, Panel, Tabs } from '../components/ui'
import { useMediaQuery } from '../lib/useMediaQuery'
import { cn } from '../lib/cn'
import type { CompanyState } from '../api/types'
import { useLive } from '../store/live'

/** One line under the header: what state the day is in and what to do about it. */
function StateLine({ c, compact }: { c: CompanyState; compact?: boolean }) {
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
    <div className={cn('flex shrink-0 items-center gap-x-4 gap-y-2 rounded-lg border text-sm', compact ? 'flex-wrap px-3 py-1.5 md:flex-nowrap' : 'flex-wrap px-4 py-2.5', c.status === 'idle' ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface')}>
      <CalendarCheck size={16} className="shrink-0 text-accent" />
      <span className={cn('min-w-0 flex-1 text-muted', compact && 'md:truncate')} title={compact ? text : undefined}>
        {text}
        {archive && !compact && (
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
  const [tab, setTab] = useState<'live' | 'graph' | 'auto'>('live')
  // Narrow or short: a compact header and one panel group at a time (tabs) instead of three columns.
  const compact = useMediaQuery('(max-width: 1279px), (max-height: 899px)')
  const tabbed = compact
  useEffect(() => void loadCompany(), [loadCompany])
  const since = useSinceSync(c ?? { cycles: [], started_at: null })

  if (!c && failed)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
        <Building2 size={28} />
        The company day is unavailable. Is the dashboard running with the company routes?
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

  const live = (
    <div className={cn('grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 md:grid-cols-2 md:grid-rows-1', !tabbed && 'md:grid-cols-[minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]')}>
      <Panel title="Pipeline" actions={<Badge>{c.status === 'running' ? 'live' : 'idle'}</Badge>}>
        <PipelineLane limit={12} compact />
      </Panel>
      <Panel title="Conversations" bodyClassName="overflow-hidden">
        <ConversationFeed />
      </Panel>
    </div>
  )
  const graph = (
    <div className={cn('grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3', tabbed && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-1')}>
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
  )
  const auto = (
    <Panel title={`Autonomous network system (every ${c.cycle_minutes} min)`} className="min-h-0 flex-1" bodyClassName="overflow-hidden">
      <AutonomousPanel c={c} />
    </Panel>
  )

  return (
    <div className={cn('flex h-full flex-col gap-2 p-2 md:p-3 xl:gap-3 xl:p-4', 'overflow-auto')}>
      <CompanyHeader c={c} compact={compact} />
      <StateLine c={c} compact={compact} />
      <CompanyKpis c={c} compact={compact} />
      {tabbed ? (
        <>
          <Tabs value={tab} onChange={setTab} items={[{ id: 'live', label: 'Pipeline and chats' }, { id: 'graph', label: 'Graph and network' }, { id: 'auto', label: 'Autonomous system' }]} />
          <div className="flex min-h-[320px] flex-1 flex-col max-md:min-h-[560px]">{tab === 'live' ? live : tab === 'graph' ? graph : auto}</div>
        </>
      ) : (
        <div className={cn('grid min-h-0 flex-1 grid-cols-12 grid-rows-1 gap-3', 'min-h-[480px]')}>
          <div className="col-span-3 flex min-h-0 flex-col">{live}</div>
          <div className="col-span-5 flex min-h-0 flex-col">{graph}</div>
          <div className="col-span-4 flex min-h-0 flex-col">{auto}</div>
        </div>
      )}
    </div>
  )
}
