import { Activity, BookOpenCheck, Bot, Database, MessagesSquare, Network, Presentation, Settings as SettingsIcon, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
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
    label: 'Monitor',
    items: [
      { to: '/', label: 'Live', title: 'Live overview', subtitle: 'What is happening right now', icon: Activity, end: true },
      { to: '/conversations', label: 'Conversations', title: 'Conversations', subtitle: 'What people say and what we understood from it', icon: MessagesSquare },
      { to: '/network', label: 'Network', title: 'Network', subtitle: 'Equipment and the knowledge attached to it', icon: Network },
      { to: '/knowledge', label: 'Knowledge', title: 'Knowledge', subtitle: 'Everything the team has learned so far', icon: BookOpenCheck },
    ],
  },
  {
    label: 'Workshop',
    items: [
      { to: '/llm', label: 'AI activity', title: 'AI activity', subtitle: 'Every request sent to the language model, in plain words', icon: Bot },
      { to: '/data', label: 'Data', title: 'Data', subtitle: 'Equipment, people and test scenarios', icon: Database },
      { to: '/settings', label: 'Settings', title: 'Settings', subtitle: 'How conversations are turned into knowledge', icon: SettingsIcon },
    ],
  },
]

export const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items)

export function Sidebar() {
  const openIncidents = useLive((s) => Object.values(s.incidents).filter((i) => i.status === 'open').length)
  const activeThreads = useLive((s) => Object.values(s.threads).filter((t) => t.status === 'active' || t.status === 'processing').length)
  const llmErrors = useLive((s) => s.llmCalls.filter((c) => c.error || c.parsed_ok === false).length)
  const badge: Record<string, { n: number; tone: string }> = {
    '/': { n: openIncidents, tone: 'bg-bad text-white' },
    '/conversations': { n: activeThreads, tone: 'bg-ok/20 text-ok' },
    '/llm': { n: llmErrors, tone: 'bg-warn/20 text-warn' },
  }
  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-line bg-surface/80 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4">
        <img src="/favicon.svg" alt="" className="size-9 rounded-xl shadow-[var(--glow)]" />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">Context Workbench</div>
          <div className="text-xs text-muted">what the humans know</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-5 overflow-auto px-3 py-3">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted/80">{g.label}</div>
            <div className="flex flex-col gap-0.5">
              {g.items.map(({ to, label, icon: Icon, end }) => {
                const b = badge[to]
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200',
                        isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:translate-x-0.5 hover:bg-surface-2 hover:text-text',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className={cn('absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-all duration-300', isActive ? 'opacity-100' : 'h-0 opacity-0')} />
                        <Icon size={17} className="transition-transform duration-200 group-hover:scale-110" />
                        {label}
                        {!!b?.n && <span className={cn('ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums', b.tone)}>{b.n}</span>}
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <a
        href="/demo/"
        className="mx-3 flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-text"
      >
        <Presentation size={17} />
        Product demo
      </a>
      <div className="m-3 rounded-xl border border-line bg-surface-2/60 p-3 text-xs leading-snug text-muted">
        <div className="font-semibold text-text">Since AI 2026</div>
        Elisa challenge · capturing human knowledge for autonomous networks
      </div>
    </nav>
  )
}
