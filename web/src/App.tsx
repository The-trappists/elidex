import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/layout/Sidebar'
import { LlmErrorBanner } from './components/layout/LlmErrorBanner'
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

export default function App() {
  useEffect(() => connectLive(), [])
  const ready = useLive((s) => s.ready)
  return (
    <BrowserRouter>
      <div className="flex h-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <LlmErrorBanner />
          <main className="min-h-0 flex-1 overflow-hidden">
            {!ready ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">Connecting to the workbench backend…</div>
            ) : (
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
            )}
          </main>
        </div>
      </div>
      <Toaster />
    </BrowserRouter>
  )
}
