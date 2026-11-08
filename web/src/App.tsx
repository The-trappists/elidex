import { useEffect } from 'react'
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

function DashboardLayout() {
  const ready = useLive((s) => s.ready)
  const { pathname } = useLocation()
  const section = pathname.split('/')[1] ?? ''
  const headerVisible = useUi((s) => s.headerVisible)

  return (
    <div className="app-shell flex h-full animate-fade-in [animation-duration:300ms]">
      <a href="#workbench-content" className="skip-link">Skip to workspace</a>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileBar />
        {headerVisible && <TopBar />}
        <LlmErrorBanner />
        <main id="workbench-content" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden">
          {!ready ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
              <span className="size-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              Connecting to the workbench…
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

export default function App() {
  useEffect(() => connectLive(), [])
  useEffect(() => connectReview(), [])
  return (
    <BrowserRouter>
      <Routes>
        {/* Standalone Home / Landing Page */}
        <Route path="/" element={<HomePage />} />
        
        {/* Workbench Dashboard App (with Sidebar, TopBar, and exit button) */}
        <Route path="/*" element={<DashboardLayout />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
