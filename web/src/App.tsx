import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { Toaster } from './components/ui'
import ConversationsPage from './pages/ConversationsPage'
import DataPage from './pages/DataPage'
import KnowledgePage from './pages/KnowledgePage'
import LivePage from './pages/LivePage'
import LlmLogPage from './pages/LlmLogPage'
import NetworkPage from './pages/NetworkPage'
import SettingsPage from './pages/SettingsPage'
import { connectLive, useLive } from './store/live'

function AnimatedRoutes() {
  const { pathname } = useLocation()
  // The conversation detail keeps its list mounted: only animate when the top-level section changes.
  const section = pathname.split('/')[1] ?? ''
  return (
    <div key={section} className="h-full animate-page-in">
      <Routes>
        <Route path="/" element={<LivePage />} />
        <Route path="/conversations" element={<ConversationsPage />} />
        <Route path="/conversations/:threadId" element={<ConversationsPage />} />
        <Route path="/network" element={<NetworkPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/llm" element={<LlmLogPage />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  )
}

export default function App() {
  useEffect(() => connectLive(), [])
  const ready = useLive((s) => s.ready)
  return (
    <BrowserRouter>
      <div className="flex h-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-h-0 flex-1 overflow-hidden">
            {!ready ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
                <span className="size-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                Connecting to the workbench…
              </div>
            ) : (
              <AnimatedRoutes />
            )}
          </main>
        </div>
      </div>
      <Toaster />
    </BrowserRouter>
  )
}
