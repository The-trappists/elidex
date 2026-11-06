import { Activity, BookOpenCheck, Bot, Database, MessagesSquare, Network, Settings as SettingsIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { useLive } from '../../store/live'

const NAV = [
  { to: '/', label: 'Live', icon: Activity, end: true },
  { to: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { to: '/network', label: 'Network', icon: Network },
  { to: '/knowledge', label: 'Knowledge', icon: BookOpenCheck },
  { to: '/llm', label: 'LLM log', icon: Bot },
  { to: '/data', label: 'Data', icon: Database },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

export function Sidebar() {
  const openIncidents = useLive((s) => Object.values(s.incidents).filter((i) => i.status === 'open').length)
  const activeThreads = useLive((s) => Object.values(s.threads).filter((t) => t.status === 'active' || t.status === 'processing').length)
  const badge: Record<string, number> = { '/': openIncidents, '/conversations': activeThreads }
  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
        <img src="/favicon.svg" alt="" className="size-7" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Context Workbench</div>
          <div className="text-[11px] text-muted">what the humans know</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-text',
              )
            }
          >
            <Icon size={17} />
            {label}
            {!!badge[to] && <span className="ml-auto rounded-full bg-bad px-1.5 text-[10px] font-semibold text-white">{badge[to]}</span>}
          </NavLink>
        ))}
      </div>
      <div className="border-t border-line p-3 text-[11px] text-muted">Since AI 2026 · Elisa challenge</div>
    </nav>
  )
}
