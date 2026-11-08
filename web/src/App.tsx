import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { MobileBar, Sidebar } from './components/layout/Sidebar'
import { LlmErrorBanner } from './components/layout/LlmErrorBanner'
import { TopBar } from './components/layout/TopBar'
import { Toaster } from './components/ui'
import AgentTesterPage from './pages/AgentTesterPage'
import CompanyPage from './pages/CompanyPage'
import ConversationsPage from './pages/ConversationsPage'
import DataPage from './pages/DataPage'
import KnowledgePage from './pages/KnowledgePage'
import LivePage from './pages/LivePage'
import HomePage from './pages/HomePage'
import LlmLogPage from './pages/LlmLogPage'
import GraphPage from "./pages/GraphPage"
import NetworkPage from './pages/NetworkPage'
import NotFoundPage from './pages/NotFoundPage'
import InsightsPage from './pages/InsightsPage'
import PipelinePage from './pages/PipelinePage'
import ReviewPage from './pages/ReviewPage'
import SettingsPage from './pages/SettingsPage'
import { connectLive, useLive } from './store/live'
import { connectReview } from './store/review'
import { useUi } from './store/ui'
import { bootstrapDemo, useDemo } from './store/demo'
import PublicDemo from './pages/PublicDemo'

function DashboardLayout() {
  const ready = useLive((s) => s.ready)
  const { pathname } = useLocation()
  const section = pathname.split('/')[1] ?? ''
  const headerVisible = useUi((s) => s.headerVisible)

  return (
    <div className="app-shell flex h-full animate-fade-in [animation-duration:300ms]">
      <a href="#dashboard-content" className="skip-link">Skip to workspace</a>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileBar />
        {headerVisible && <TopBar />}
        <LlmErrorBanner />
        <main id="dashboard-content" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden">
          {!ready ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
              <span className="size-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              Connecting to the dashboard…
            </div>
          ) : (
            <div key={section} className="h-full">
              <Routes>
                <Route path="/" element={<LivePage />} />
                <Route path="/overview" element={<LivePage />} />
                <Route path="/company" element={<CompanyPage />} />
                <Route path="/conversations" element={<ConversationsPage />} />
                <Route path="/conversations/:threadId" element={<ConversationsPage />} />
                <Route path="/review" element={<ReviewPage />} />
                <Route path="/network" element={<NetworkPage />} />
                <Route path="/graph" element={<GraphPage />} />
                <Route path="/knowledge" element={<KnowledgePage />} />
                <Route path="/agent" element={<AgentTesterPage />} />
                <Route path="/insights" element={<InsightsPage />} />
                <Route path="/patterns" element={<Navigate to="/insights" replace />} />
                <Route path="/pipeline" element={<PipelinePage />} />
                <Route path="/architecture" element={<Navigate to="/pipeline" replace />} />
                <Route path="/llm" element={<LlmLogPage />} />
                <Route path="/data" element={<DataPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function AppContent() {
  const { pathname } = useLocation()
  const landing = pathname === '/'
  const status = useDemo((s) => s.status)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    // The marketing homepage is public even when the backend is full or offline.
    // Allocate a private workspace only when the visitor enters the dashboard.
    if (landing) {
      setConnecting(true)
      return
    }
    setConnecting(true)
    setError('')
    useLive.setState({ ready: false, company: null, companyError: false })
    let stopped = false
    let disconnectLive: (() => void) | undefined
    let disconnectReview: (() => void) | undefined
    void bootstrapDemo().then((demo) => {
      if (stopped) return
      disconnectLive = connectLive()
      if (!demo.enabled) disconnectReview = connectReview()
      setConnecting(false)
    }).catch((cause: unknown) => {
      if (!stopped) {
        setError(cause instanceof Error ? cause.message : 'Unable to connect')
        setConnecting(false)
      }
    })
    return () => { stopped = true; disconnectLive?.(); disconnectReview?.() }
  }, [attempt, landing])
  if (landing) return <HomePage />
  if (connecting || error || !status) return <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg p-6 text-center text-sm text-muted" role="status">{error ? <><p>{error}</p><button className="rounded-md border border-line px-4 py-2 text-text hover:bg-surface-2" onClick={() => { setError(''); setConnecting(true); setAttempt((n) => n + 1) }}>Try again</button></> : <><span className="size-6 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />Connecting to ElidEx…</>}</div>
  return (
    <>
      {status.enabled ? <PublicDemo /> : <Routes>
        {/* Standalone Home / Landing Page */}
        <Route path="/" element={<HomePage />} />
        
        {/* Dashboard App (with Sidebar, TopBar, and exit button) */}
        <Route path="/*" element={<DashboardLayout />} />
      </Routes>}
    </>
  )
}

export default function App() {
  return <BrowserRouter><AppContent /><Toaster /></BrowserRouter>
}
