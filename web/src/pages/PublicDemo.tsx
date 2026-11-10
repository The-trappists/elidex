import { ArrowRight, Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import type { ContextAssertion } from '../api/types'
import { CompanyBoard } from '../components/company/CompanyBoard'
import { Drawer } from '../components/ui'
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
  { to: '/company', label: 'Company day' },
  { to: '/network', label: 'Network' },
  { to: '/graph', label: 'Knowledge graph' },
]

const SFP_CONVERSATION = '/conversations/elisa%2Fteams_chat.json?walkthrough=sfp'
const SFP_AGENT = '/agent?walkthrough=sfp'

function sfpKnowledgeUrl(assertions: Record<string, ContextAssertion>) {
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
  const label = step === 1 ? 'Open the rule' : step === 2 ? 'Run the case' : 'Finish'
  const text = step === 1 ? 'Read how Erkki fixed TRN-042.' : step === 2 ? 'Check where this rule comes from.' : complete ? 'The case ran. Read the advice.' : 'Press Run SFP case to see the advice.'
  return <section className="demo-step-bar" aria-label="SFP walkthrough">
    <div><p className="demo-overline">SFP case · {step} of 3</p><p>{text}</p></div>
    {(step < 3 || complete) && <Link to={next} className="demo-primary-link">{label}<ArrowRight size={14} /></Link>}
  </section>
}

function DemoCompany() {
  return (
    <CompanyBoard
      publicDemo
      cta={
        <Link to={SFP_CONVERSATION} onClick={() => useDemo.setState({ sfpCaseComplete: false })} className="demo-primary-link">
          Start the SFP case <ArrowRight size={14} />
        </Link>
      }
    />
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
  const session = connection === 'live' ? 'Demo workspace' : connection === 'offline' ? 'Reconnecting…' : 'Connecting…'
  const navLinks = NAV.map(({ to, label }) => <NavLink key={to} to={to} onClick={() => setMenuOpen(false)} className={({ isActive }) => cn('demo-nav-link', isActive && 'is-active')}>{label}</NavLink>)
  return (
    <div className="public-demo flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-bg">
      <a href="#demo-content" className="skip-link">Skip to demo</a>
      <header className="demo-header">
        <Link to="/" aria-label="ElidEx home" title="Back to the homepage" className="flex shrink-0 items-center gap-2.5 font-display text-xl font-semibold tracking-tight"><img src="/elidex-logo.png" alt="" className="size-8 object-contain" /><span>Elid<span className="text-accent">Ex</span></span></Link>
        <nav aria-label="Demo" className="demo-navigation">{navLinks}</nav>
        <span className="demo-session" role="status" title={session} aria-label={session}><span className={cn('size-1.5 shrink-0 rounded-full', connection === 'live' ? 'bg-ok' : 'bg-warn')} /><span className="demo-session-label">{session}</span></span>
        <button className="demo-menu-button" type="button" aria-expanded={menuOpen} aria-controls="demo-mobile-navigation" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={18} /> : <Menu size={18} />}<span className="sr-only">{menuOpen ? 'Close navigation' : 'Open navigation'}</span></button>
      </header>
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Explore the demo" side="left" width="max-w-xs"><nav id="demo-mobile-navigation" aria-label="Demo mobile" className="demo-drawer-navigation">{navLinks}<p className="mt-2 px-2 text-xs text-muted">Private demo workspace.</p></nav></Drawer>
      {ready && <SfpWalkthrough />}
      <main id="demo-content" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden">
        {!ready ? <div className="flex h-full items-center justify-center gap-3 p-6 text-sm text-muted"><span className="size-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />Preparing demo…</div> : <Routes>
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
