import { Activity, BookOpenCheck, Bot, Database, LogOut, MessagesSquare, Network, Presentation, Settings as SettingsIcon, Waypoints, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { recentProblems } from '../llm/status'
import { useWallNow } from '../../lib/useNow'
import { cn } from '../../lib/cn'
import { useLive } from '../../store/live'

export interface NavItem {
  to: string
  label: string
  title: string
  subtitle: string
  icon: LucideIcon
  end?: boolean
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Observe',
    items: [
      { to: '/overview', label: 'Overview', title: 'Overview', subtitle: 'Open incidents and what the pipeline did recently', icon: Activity, end: true },
      { to: '/conversations', label: 'Conversations', title: 'Conversations', subtitle: 'Read a conversation, then follow it through each pipeline step', icon: MessagesSquare },
      { to: '/network', label: 'Network', title: 'Network', subtitle: 'Equipment and the knowledge attached to it', icon: Network },
      { to: '/graph', label: 'Graph', title: 'Knowledge graph', subtitle: 'People, messages, knowledge and equipment, and how they connect', icon: Waypoints },
      { to: '/knowledge', label: 'Knowledge', title: 'Knowledge', subtitle: 'Everything the team has learned so far', icon: BookOpenCheck },
    ],
  },
  {
    label: 'Workshop',
    items: [
      { to: '/llm', label: 'AI activity', title: 'AI activity', subtitle: 'Every request sent to the language model', icon: Bot },
      { to: '/data', label: 'Data', title: 'Data', subtitle: 'Equipment, people and test scenarios', icon: Database },
      { to: '/settings', label: 'Settings', title: 'Settings', subtitle: 'How conversations are turned into knowledge', icon: SettingsIcon },
    ],
  },
]

export const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items)

export function Sidebar() {
  const openIncidents = useLive((s) => Object.values(s.incidents).filter((i) => i.status === 'open').length)
  const llmCalls = useLive((s) => s.llmCalls)
  const now = useWallNow()
  const llmErrors = useMemo(() => recentProblems(llmCalls, now.getTime()).length, [llmCalls, now])
  // Only things that need action get a badge.
  const badge: Record<string, number> = { '/overview': openIncidents, '/llm': llmErrors }
  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <img src="/elidex-logo.png" alt="ElidEx" className="size-7 object-contain" />
        <div className="flex flex-col">
          <span className="text-sm font-bold tracking-tight">Elid<span className="text-accent">Ex</span></span>
          <span className="text-[10px] text-muted -mt-0.5">Context Layer</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-5 overflow-auto px-2 py-2">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="mb-1 px-2.5 text-xs font-medium text-muted">{g.label}</div>
            <div className="flex flex-col gap-0.5">
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                      isActive ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
                    )
                  }
                >
                  <Icon size={16} />
                  {label}
                  {!!badge[to] && <span className="ml-auto rounded bg-bad/10 px-1.5 text-xs font-medium tabular-nums text-bad">{badge[to]}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Link to="/" className="m-2 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text" title="Return to ElidEx home">
        <LogOut size={16} />
        Exit to Home
      </Link>
      <a href="/demo/" className="mx-2 mb-2 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text">
        <Presentation size={16} />
        Product demo
      </a>
    </nav>
  )
}
