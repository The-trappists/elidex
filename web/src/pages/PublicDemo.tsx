import { ArrowRight, Menu, Network, Pause, Play, Waypoints, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { ConversationFeed } from '../components/company/ConversationFeed'
import { PipelineLane } from '../components/pipeline/PipelineLane'
import { Button, Drawer, Panel, withToast } from '../components/ui'
import { cn } from '../lib/cn'
import { refreshDemo, useDemo } from '../store/demo'
import { useLive } from '../store/live'
import AgentTesterPage from './AgentTesterPage'
import ConversationsPage from './ConversationsPage'
import GraphPage from './GraphPage'
import KnowledgePage from './KnowledgePage'
import NetworkPage from './NetworkPage'
import './PublicDemo.css'

// Public demo navigation: only the guided company-day walkthrough and the two
// visualizations. Conversations, knowledge and the agent tester stay routable
// because the walkthrough links to them, but they are not advertised here.
const NAV = [
  { to: '/company', label: 'Demo walkthrough', icon: Play },
  { to: '/network', label: 'Network', icon: Network },
  { to: '/graph', label: 'Graph', icon: Waypoints },
]

const SFP_CONVERSATION = '/conversations/elisa%2Fteams_chat.json?walkthrough=sfp'
const SFP_AGENT = '/agent?walkthrough=sfp'

function sfpKnowledgeUrl(assertions: ReturnType<typeof useLive.getState>['assertions']) {
  const assertion = Object.values(assertions).find((item) => item.type === 'workaround' && item.sources.some((source) => source.file === 'elisa/teams_chat.json'))
  return `/knowledge?walkthrough=sfp${assertion ? `&assertion=${encodeURIComponent(assertion.id)}` : ''}`
}

function SfpWalkthrough() {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const assertions = useLive((state) => state.assertions)
  const complete = useDemo((state) => state.sfpCaseComplete)
  if (params.get('walkthrough') !== 'sfp') return null
  const step = pathname.startsWith('/conversations/') ? 1 : pathname === '/knowledge' ? 2 : 3
  const next = step === 1 ? sfpKnowledgeUrl(assertions) : step === 2 ? SFP_AGENT : '/company'
  const label = step === 1 ? 'Next: Inspect the captured rule' : step === 2 ? 'Next: Run the TRN-117 case' : 'Finish walkthrough'
  return <section className="demo-step-bar" aria-label="SFP walkthrough">
    <div><p className="demo-overline">SFP incident · Step {step} of 3</p><p>{step === 1 ? 'Read how Erkki resolves the zero-traffic problem on TRN-042.' : step === 2 ? 'Check the rule’s source, scope and validity before continuing.' : complete ? 'The case has run. Inspect the recommendation and its sources, then finish the walkthrough.' : 'The TRN-117 case is prepared. Press Run SFP case to see the recommendation.'}</p></div>
    {(step < 3 || complete) && <Link to={next} className="demo-primary-link">{label}<ArrowRight size={14} /></Link>}
  </section>
}

function DemoCompany() {
  const company = useLive((s) => s.company)
  const loadCompany = useLive((s) => s.loadCompany)
  const assertions = useLive((s) => s.assertions)
  const threads = useLive((s) => s.threads)
  const companyError = useLive((s) => s.companyError)
  const knowledgeUrl = sfpKnowledgeUrl(assertions)
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
    <div className="h-full overflow-auto overscroll-contain">
      <div className="demo-workspace mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <section className="demo-guide-intro">
          <p className="demo-overline">Guided demo · SFP replacement</p>
          <h1>Follow one incident, end to end.</h1>
          <p>An engineer replaces an SFP on TRN-042. The link is up, but traffic is still at zero. Read Erkki's advice, inspect the rule ElidEx captured, then see it applied to TRN-117.</p>
          <Link to={SFP_CONVERSATION} onClick={() => useDemo.setState({ sfpCaseComplete: false })} className="demo-primary-link">1. Read the SFP conversation <ArrowRight size={16} /></Link>
          <small>Three steps. Preloaded data. No live AI allowance required.</small>
        </section>

        <nav className="demo-journey" aria-label="Follow the knowledge">
          {[
            { to: SFP_CONVERSATION, title: '1. Read the SFP conversation', text: 'Find the advice: check counters and bounce the interface before rebooting.' },
            { to: knowledgeUrl, title: '2. Inspect the captured rule', text: 'Open this conversation’s rule, with its source, equipment scope and validity.' },
            { to: SFP_AGENT, title: '3. Run the TRN-117 case', text: 'Run a prepared case on a similar node and inspect the recommendation.' },
          ].map((step) => <Link key={step.to} to={step.to} className="group"><span className="flex items-center justify-between gap-2 font-display text-base font-medium">{step.title}<ArrowRight size={15} className="shrink-0 text-accent transition-transform group-hover:translate-x-1 motion-reduce:transition-none" /></span><span className="mt-2 block text-sm leading-relaxed text-muted">{step.text}</span></Link>)}
        </nav>

        <section id="company-day" className="demo-day-heading" aria-label="Simulation controls">
          <div className="min-w-0 flex-1 basis-64"><p className="demo-overline">Explore further · Company simulation</p><h2 className="mt-3 font-display text-2xl font-medium tracking-tight">Watch a scripted company day</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Play a prepared company day and watch advice become network memory. Pause whenever something catches your eye.</p></div>
          <Button variant="primary" onClick={() => void startScripted()} loading={busy || (!company && !companyError)} disabled={!company} icon={running ? <Pause size={15} /> : <Play size={15} />}>{running ? 'Pause day' : company?.status === 'paused' ? 'Resume day' : 'Play scripted day'}</Button>
        </section>
        {companyError && <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-bad">Could not load the company day.<Button onClick={() => void loadCompany()}>Try again</Button></div>}
        <p className="mb-4 text-xs text-muted"><span className="font-mono tabular-nums text-text">{Object.keys(threads).length}</span> conversations · <span className="font-mono tabular-nums text-text">{Object.keys(assertions).length}</span> knowledge items · {running ? 'Company day playing' : 'Ready to explore'}</p>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-[360px] min-w-0"><Panel className="h-full" title="Colleagues talking" bodyClassName="overflow-hidden"><ConversationFeed /></Panel></div>
          <div className="h-[360px] min-w-0"><Panel className="h-full" title="Knowledge being captured"><PipelineLane limit={8} compact /></Panel></div>
        </div>

        <p className="demo-footer">Built for Elisa's challenge at Since AI 2026. All conversations and network data here are demo material. Changes stay in your workspace.</p>
      </div>
    </div>
  )
}

export default function PublicDemo() {
  const ready = useLive((s) => s.ready)
  const connection = useLive((s) => s.connection)
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname, search } = useLocation()
  useEffect(() => { setMenuOpen(false) }, [pathname])
  useEffect(() => {
    const refresh = () => { void refreshDemo().catch(() => undefined) }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [])
  const navLinks = NAV.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMenuOpen(false)} className={({ isActive }) => cn('demo-nav-link', isActive && 'is-active')}><Icon size={15} />{label}</NavLink>)
  return (
    <div className="public-demo flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-bg">
      <a href="#demo-content" className="skip-link">Skip to demo</a>
      <header className="demo-header">
        <div className="demo-brand-row"><Link to="/" aria-label="ElidEx home" title="Back to the homepage" className="flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight"><img src="/elidex-logo.png" alt="" className="size-8 object-contain" /><span>Elid<span className="text-accent">Ex</span></span></Link><span className="demo-session" role="status"><span className={cn('size-1.5 shrink-0 rounded-full', connection === 'live' ? 'bg-ok' : 'bg-warn')} />{connection === 'live' ? 'Your private workspace' : connection === 'offline' ? 'Reconnecting…' : 'Connecting…'}<span className="hidden sm:inline"> · Scripted mode</span></span><button className="demo-menu-button" type="button" aria-expanded={menuOpen} aria-controls="demo-mobile-navigation" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={18} /> : <Menu size={18} />}<span className="sr-only">{menuOpen ? 'Close navigation' : 'Open navigation'}</span></button></div>
        <nav aria-label="Demo" className="demo-navigation">{navLinks}</nav>
      </header>
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Explore the demo" side="left" width="max-w-xs"><nav id="demo-mobile-navigation" aria-label="Demo mobile" className="demo-drawer-navigation">{navLinks}</nav></Drawer>
      {ready && <SfpWalkthrough />}
      <main id="demo-content" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden">
        {!ready ? <div className="flex h-full items-center justify-center gap-3 p-6 text-sm text-muted"><span className="size-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />Preparing your demo workspace…</div> : <Routes>
          <Route path="/" element={<Navigate to="/company" replace />} />
          <Route path="/company" element={<DemoCompany />} />
          <Route path="/conversations" element={<ConversationsPage />} />
          <Route path="/conversations/:threadId" element={<ConversationsPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/network" element={<NetworkPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/agent" element={<AgentTesterPage key={search} />} />
          <Route path="*" element={<Navigate to="/company" replace />} />
        </Routes>}
      </main>
    </div>
  )
}
