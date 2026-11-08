import { ArrowRight, BookOpenCheck, FlaskConical, MessagesSquare, Network, Pause, Play, Sparkles, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from '../api/client'
import { ConversationFeed } from '../components/company/ConversationFeed'
import { PipelineLane } from '../components/pipeline/PipelineLane'
import { Badge, Button, Panel, withToast } from '../components/ui'
import { cn } from '../lib/cn'
import { refreshDemo, startLiveDemo, useDemo } from '../store/demo'
import { useLive } from '../store/live'
import AgentTesterPage from './AgentTesterPage'
import ConversationsPage from './ConversationsPage'
import GraphPage from './GraphPage'
import KnowledgePage from './KnowledgePage'
import NetworkPage from './NetworkPage'

const NAV = [
  { to: '/company', label: 'Try the demo', icon: Play },
  { to: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { to: '/knowledge', label: 'Knowledge', icon: BookOpenCheck },
  { to: '/network', label: 'Network', icon: Network },
  { to: '/graph', label: 'Graph', icon: Waypoints },
  { to: '/agent', label: 'Try a case', icon: FlaskConical },
]

function DemoCompany() {
  const status = useDemo((s) => s.status)
  const company = useLive((s) => s.company)
  const loadCompany = useLive((s) => s.loadCompany)
  const assertions = useLive((s) => s.assertions)
  const threads = useLive((s) => s.threads)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void loadCompany() }, [loadCompany])
  const running = company?.status === 'running'
  const startScripted = async () => {
    setBusy(true)
    try {
      await withToast(async () => {
        if (running) await api.companyPause()
        else if (company?.status === 'paused') await api.companyResume()
        else await api.companyStart({ day_minutes: 120, speed: 120, reset: 'keep', use_llm: false, clear_archive: false })
        await loadCompany()
      })
    } finally { setBusy(false) }
  }
  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-medium text-accent">Your private network sandbox</p>
            <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">The fix was in a conversation.</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">An engineer knows why a green link still carries no traffic. Follow that advice from a colleague's message to knowledge an autonomous agent can reuse.</p>
          </div>
          <Badge className="bg-surface-2 text-muted">{Object.keys(threads).length} conversations · {Object.keys(assertions).length} knowledge items</Badge>
        </div>

        <div className="grid gap-0 overflow-hidden rounded-lg border border-line bg-surface md:grid-cols-3">
          {[
            { to: '/conversations/elisa%2Fteams_chat.json', title: '1. Read the conversation', text: 'See the technical advice hidden among everyday messages.' },
            { to: '/knowledge', title: '2. Follow the knowledge', text: 'Inspect the source, equipment links, trust and validity.' },
            { to: '/agent', title: '3. Apply it to a case', text: 'Try the SFP swap preset and see which advice applies.' },
          ].map((step) => <Link key={step.to} to={step.to} className="group border-line p-4 transition-colors hover:bg-surface-2 max-md:border-b md:border-r last:border-0"><span className="flex items-center justify-between gap-2 text-sm font-semibold">{step.title}<ArrowRight size={15} className="shrink-0 text-accent transition-transform group-hover:translate-x-1 motion-reduce:transition-none" /></span><span className="mt-2 block text-sm leading-relaxed text-muted">{step.text}</span></Link>)}
        </div>

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface p-4" aria-label="Simulation controls">
          <div className="min-w-0 flex-1 basis-64"><h2 className="text-sm font-semibold">Watch the company day</h2><p className="mt-1 text-sm text-muted">Play the prepared conversations and watch the pipeline update. You can pause and explore at any time.</p></div>
          <Button onClick={() => void startScripted()} loading={busy} disabled={status?.live_run_running} icon={running ? <Pause size={15} /> : <Play size={15} />}>{running ? 'Pause day' : company?.status === 'paused' ? 'Resume day' : 'Play scripted day'}</Button>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-[360px] min-w-0"><Panel title="Colleagues talking" bodyClassName="overflow-hidden"><ConversationFeed /></Panel></div>
          <div className="h-[360px] min-w-0"><Panel title="Knowledge being captured"><PipelineLane limit={8} compact /></Panel></div>
        </div>

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-accent/30 bg-accent-soft p-4" aria-label="Live AI trial">
          <div className="min-w-0 flex-1 basis-64"><h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} className="text-accent" />Try one live AI run</h2><p className="mt-1 text-sm leading-relaxed text-muted">Generate and process one new conversation with the live models. After this run, your workspace returns to scripted mode and remains yours to explore.</p>
            {status?.live_run_used && !status.live_run_running && <p className="mt-2 text-sm font-medium">Your live run is complete. Continue exploring the scripted demo.</p>}
            {!status?.live_run_used && !status?.live_run_available && <p className="mt-2 text-sm">Live AI is unavailable right now. The scripted demo is ready to explore.</p>}
            {status?.live_run_error && <p className="mt-2 text-sm text-bad" role="alert">{status.live_run_error}</p>}
          </div>
          <Button variant="primary" loading={status?.live_run_running} disabled={!status?.live_run_available || status.live_run_used} icon={<Sparkles size={15} />} onClick={() => void withToast(startLiveDemo)}>{status?.live_run_running ? 'Live run in progress…' : status?.live_run_used ? 'Live run used' : 'Start my live run'}</Button>
        </section>
        <p className="pb-2 text-xs leading-relaxed text-muted">All people, conversations and network data in this sandbox are demo material. Changes here stay in your workspace. Slack is disconnected.</p>
      </div>
    </div>
  )
}

export default function PublicDemo() {
  const ready = useLive((s) => s.ready)
  const connection = useLive((s) => s.connection)
  const status = useDemo((s) => s.status)
  useEffect(() => {
    const refresh = () => { void refreshDemo().catch(() => undefined) }
    window.addEventListener('focus', refresh)
    const timer = status?.live_run_running ? window.setInterval(refresh, 2000) : undefined
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer) }
  }, [status?.live_run_running])
  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      <a href="#demo-content" className="skip-link">Skip to demo</a>
      <header className="shrink-0 border-b border-line bg-surface px-4 py-3 md:px-6">
        <div className="flex items-center gap-3"><Link to="/company" className="flex items-center gap-2 font-display text-xl font-semibold"><img src="/elidex-logo.png" alt="" className="size-7 object-contain" />Elid<span className="-ml-2 text-accent">Ex</span></Link><span className="ml-auto text-xs text-muted" role="status">{connection === 'live' ? 'Private workspace' : connection === 'offline' ? 'Reconnecting…' : 'Connecting…'} · {status?.live_run_running ? 'Live AI run' : 'Scripted mode'}</span></div>
        <nav aria-label="Demo" className="mt-3 flex flex-wrap gap-1">{NAV.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => cn('flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors sm:text-sm', isActive ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-surface-2 hover:text-text')}><Icon size={15} />{label}</NavLink>)}</nav>
      </header>
      <main id="demo-content" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden">
        {!ready ? <div className="flex h-full items-center justify-center gap-3 p-6 text-sm text-muted"><span className="size-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />Preparing your demo workspace…</div> : <Routes>
          <Route path="/" element={<Navigate to="/company" replace />} />
          <Route path="/company" element={<DemoCompany />} />
          <Route path="/conversations" element={<ConversationsPage />} />
          <Route path="/conversations/:threadId" element={<ConversationsPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/network" element={<NetworkPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/agent" element={<AgentTesterPage />} />
          <Route path="*" element={<Navigate to="/company" replace />} />
        </Routes>}
      </main>
    </div>
  )
}
