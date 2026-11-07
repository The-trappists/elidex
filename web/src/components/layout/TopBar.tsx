import { ChevronDown, Clock3, LogOut, Moon, Pause, Play, PlayCircle, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../../api/client'
import { cn } from '../../lib/cn'
import { fmtDateTime, toNaiveIso } from '../../lib/format'
import { SOURCE_STYLE } from '../../lib/semantic'
import { useSimNow } from '../../lib/useNow'
import { useLive } from '../../store/live'
import { Button, IconButton, withToast } from '../ui'
import { ALL_NAV } from './Sidebar'

const SPEEDS = [1, 10, 60, 600]

function ScenarioLauncher() {
  const scenarios = useLive((s) => s.scenarios)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', escape)
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', escape) }
  }, [])
  return (
    <div className="relative" ref={ref}>
      <Button aria-expanded={open} aria-haspopup="true" icon={<PlayCircle size={15} />} onClick={() => setOpen((o) => !o)}>
        Run scenario <ChevronDown size={14} />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-30 max-h-[70vh] w-96 max-w-[calc(100vw-6rem)] overflow-auto rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-lg)]">
          {scenarios.length === 0 && <div className="p-3 text-sm text-muted">No scenario yet. Add one in Data.</div>}
          {scenarios.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              className="flex w-full flex-col items-start gap-1 rounded-md px-3 py-2 text-left transition hover:bg-surface-2"
              onClick={() => {
                setOpen(false)
                void withToast(() => api.runScenario(s.id), `Started: ${s.title}`)
              }}
            >
              <div className="flex w-full items-center gap-2">
                <span className="text-sm font-medium">{s.title}</span>
                <span className="ml-auto text-xs text-muted">{SOURCE_STYLE[s.channel].label}</span>
              </div>
              {s.description && <span className="text-xs leading-snug text-muted">{s.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const v = localStorage.getItem('theme')
      if (v) return v === 'dark'
    } catch {
      /* storage blocked */
    }
    // The workbench is dark-first; use dark unless the user has saved a choice.
    return true
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light')
    } catch {
      /* storage blocked */
    }
  }, [dark])
  return [dark, setDark] as const
}

function Dot({ on, bad }: { on: boolean; bad?: boolean }) {
  return <span className={cn('size-1.5 rounded-full', on ? 'bg-ok' : bad ? 'bg-bad' : 'bg-muted/50')} />
}

export function TopBar() {
  const clock = useLive((s) => s.clock)
  const settings = useLive((s) => s.settings)
  const slack = useLive((s) => s.slack)
  const connection = useLive((s) => s.connection)
  const now = useSimNow(500)
  const [dark, setDark] = useTheme()
  const [showClock, setShowClock] = useState(false)
  const { pathname } = useLocation()
  const page = ALL_NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to))) ?? ALL_NAV[0]

  const mode = settings?.extractor_mode ?? 'auto'
  const llmOn = !!settings?.llm_configured && mode !== 'scripted'

  return (
    <header className="app-topbar sticky top-0 z-20 flex min-h-20 shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold leading-tight">{page.title}</h1>
        <p className="hidden truncate text-xs text-muted lg:block">{page.subtitle}</p>
      </div>

      <div className="topbar-controls ml-auto flex flex-wrap items-center gap-3">
        <IconButton className="clock-toggle" onClick={() => setShowClock(!showClock)} aria-label="Simulation controls" aria-expanded={showClock}><Clock3 size={16} /></IconButton>
        {/* simulated clock */}
        <div className="simulation-controls flex flex-wrap items-center gap-2" data-open={showClock}>
          <IconButton
            variant="secondary"
            aria-label={clock?.running ? 'Pause the simulated clock' : 'Start the simulated clock'}
            onClick={() => void withToast(() => (clock?.running ? api.simPause() : api.simStart()))}
          >
            {clock?.running ? <Pause size={14} /> : <Play size={14} />}
          </IconButton>
          <div className="leading-tight">
            <div className="font-mono text-sm tabular-nums">{now ? fmtDateTime(toNaiveIso(now)) : '—'}</div>
            <div className="text-xs text-muted">Simulated time{clock?.running ? '' : ' · paused'}</div>
          </div>
          <div className="flex rounded-md border border-line p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => void withToast(() => api.simSpeed(s))}
                className={cn('rounded px-2 py-1 font-mono text-xs transition-colors', clock?.speed === s ? 'bg-surface-3 text-text' : 'text-muted hover:text-text')}
              >
                ×{s}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden items-center gap-3 text-xs text-muted xl:flex">
          <span className="flex items-center gap-1.5" title={settings?.llm_model ?? 'No LLM key: scripted extraction'}>
            <Dot on={llmOn} bad={mode === 'llm' && !llmOn} /> {llmOn ? settings?.llm_model : mode === 'llm' ? 'AI needs a key' : 'Scripted'}
          </span>
          <span className="flex items-center gap-1.5" title={slack.error ?? slack.channel ?? 'Slack bridge off'}>
            <Dot on={slack.connected} /> Slack
          </span>
        </div>

        <span
          role="status"
          aria-live="polite"
          title={connection === 'live' ? 'Connected to the workbench event stream' : 'Connection to the workbench lost. Retrying with backoff.'}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-200',
            connection === 'live' ? 'border-ok/30 bg-ok/10 text-ok' : connection === 'connecting' ? 'border-line bg-surface-2 text-muted' : 'border-bad/40 bg-bad/10 text-bad',
          )}
        >
          <span className={cn('size-1.5 rounded-full bg-current', connection !== 'live' && 'animate-pulse')} />
          {connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>

        <IconButton onClick={() => setDark(!dark)} aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
        <ScenarioLauncher />
        <Link
          to="/"
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:bg-surface-2 hover:text-text"
          title="Exit to ElidEx home page"
        >
          <LogOut size={14} />
          <span>Exit</span>
        </Link>
      </div>
    </header>
  )
}
