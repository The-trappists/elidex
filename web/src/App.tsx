import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ALL_NAV, Sidebar } from './components/layout/Sidebar'
import { LlmErrorBanner } from './components/layout/LlmErrorBanner'
import { TopBar } from './components/layout/TopBar'
import { DemoGuide } from './components/demo/DemoGuide'
import { Toaster } from './components/ui'
import ConversationsPage from './pages/ConversationsPage'
import DataPage from './pages/DataPage'
import KnowledgePage from './pages/KnowledgePage'
import LivePage from './pages/LivePage'
import HomePage from './pages/HomePage'
import LlmLogPage from './pages/LlmLogPage'
import GraphPage from "./pages/GraphPage"
import NetworkPage from './pages/NetworkPage'
import NotFoundPage from './pages/NotFoundPage'
import ReviewPage from './pages/ReviewPage'
import SettingsPage from './pages/SettingsPage'
import { connectLive, useLive } from './store/live'
import { connectReview } from './store/review'

function DashboardLayout() {
  const ready = useLive((s) => s.ready)
  const { pathname } = useLocation()
  const section = pathname.split('/')[1] ?? ''
  const known = ALL_NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to))) ?? (pathname === '/' ? ALL_NAV[0] : undefined)
  useEffect(() => {
    document.title = known ? `${known.title} · Context Workbench` : 'Page not found · Context Workbench'
  }, [known])

  return (
    <div className="flex h-full animate-fade-in [animation-duration:300ms]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <LlmErrorBanner />
        <main className="min-h-0 flex-1 overflow-hidden">
          {!ready ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
              <span className="size-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              Connecting to the workbench…
            </div>
          ) : (
            <div key={section} className="h-full animate-page-in">
              <Routes>
                <Route path="/" element={<LivePage />} />
                <Route path="/overview" element={<LivePage />} />
                <Route path="/conversations" element={<ConversationsPage />} />
                <Route path="/conversations/:threadId" element={<ConversationsPage />} />
                <Route path="/review" element={<ReviewPage />} />
                <Route path="/network" element={<NetworkPage />} />
                <Route path="/graph" element={<GraphPage />} />
                <Route path="/knowledge" element={<KnowledgePage />} />
                <Route path="/llm" element={<LlmLogPage />} />
                <Route path="/data" element={<DataPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </div>
          )}
        </main>
      </div>
      {ready && <DemoGuide />}
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
