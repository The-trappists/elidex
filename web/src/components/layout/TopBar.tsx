import { Bot, ChevronDown, Moon, Pause, Play, PlayCircle, Hash, Sun, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { cn } from '../../lib/cn'
import { fmtDateTime, toNaiveIso } from '../../lib/format'
import { SOURCE_STYLE } from '../../lib/semantic'
import { useSimNow } from '../../lib/useNow'
import { useLive } from '../../store/live'
import { Badge, Button, withToast } from '../ui'

const SPEEDS = [1, 10, 60, 600]

function ScenarioLauncher() {
  const scenarios = useLive((s) => s.scenarios)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <Button variant="primary" icon={<PlayCircle size={16} />} onClick={() => setOpen((o) => !o)}>
        Run scenario <ChevronDown size={14} />
      </Button>
      {open && (
        <div className="absolute right-0 top-11 z-30 max-h-[70vh] w-96 overflow-auto rounded-xl border border-line bg-surface p-1.5 shadow-xl animate-slide-in">
          {scenarios.length === 0 && <div className="p-3 text-sm text-muted">No scenario yet. Add one in Data.</div>}
          {scenarios.map((s) => (
            <button
              key={s.id}
              className="flex w-full flex-col items-start gap-1 rounded-lg px-3 py-2 text-left hover:bg-surface-2"
              onClick={() => {
                setOpen(false)
                void withToast(() => api.runScenario(s.id), `Started: ${s.title}`)
              }}
            >
              <div className="flex w-full items-center gap-2">
                <span className="text-sm font-medium">{s.title}</span>
                <Badge className={cn('ml-auto', SOURCE_STYLE[s.channel].cls)}>{SOURCE_STYLE[s.channel].label}</Badge>
              </div>
              {s.description && <span className="line-clamp-2 text-xs text-muted">{s.description}</span>}
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
    return window.matchMedia('(prefers-color-scheme: dark)').matches
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

export function TopBar() {
  const clock = useLive((s) => s.clock)
  const settings = useLive((s) => s.settings)
  const slack = useLive((s) => s.slack)
  const connection = useLive((s) => s.connection)
  const now = useSimNow(500)
  const [dark, setDark] = useTheme()

  const mode = settings?.extractor_mode ?? 'auto'
  const llmOn = !!settings?.llm_configured && mode !== 'scripted'

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      {/* sim clock */}
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 py-1 pl-1 pr-3">
        <button
          className={cn('flex size-7 items-center justify-center rounded-md text-white', clock?.running ? 'bg-warn' : 'bg-ok')}
          title={clock?.running ? 'Pause the simulation' : 'Start the simulation'}
          onClick={() => void withToast(() => (clock?.running ? api.simPause() : api.simStart()))}
        >
          {clock?.running ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div className="leading-tight">
          <div className="font-mono text-sm font-medium tabular-nums">{now ? fmtDateTime(toNaiveIso(now)) + ':' + String(now.getSeconds()).padStart(2, '0') : '—'}</div>
          <div className="text-[11.5px] uppercase tracking-wide text-muted">simulated time</div>
        </div>
      </div>
      <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => void withToast(() => api.simSpeed(s))}
            className={cn('rounded-md px-2 py-1 font-mono text-xs', clock?.speed === s ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
          >
            ×{s}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Badge className={llmOn ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted'} title={settings?.llm_model ?? 'No LLM key: scripted extraction'}>
          <Bot size={12} /> {llmOn ? `LLM · ${settings?.llm_model}` : `Extractor · ${mode === 'llm' ? 'LLM (no key!)' : 'scripted'}`}
        </Badge>
        <Badge className={slack.connected ? 'bg-slack/15 text-slack' : 'bg-surface-2 text-muted'} title={slack.error ?? slack.channel ?? 'Slack bridge off'}>
          <Hash size={12} /> {slack.connected ? 'Slack on' : 'Slack off'}
        </Badge>
        <Badge className={connection === 'live' ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}>
          {connection === 'live' ? <Wifi size={12} /> : <WifiOff size={12} />} {connection}
        </Badge>
        <button className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text" onClick={() => setDark(!dark)} title="Toggle theme">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <ScenarioLauncher />
      </div>
    </header>
  )
}
