import { format } from 'date-fns'
import { Pause, Play, Square } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { companyActions } from './actions'
import type { CompanyState } from '../../api/types'
import { useSimNow } from '../../lib/useNow'
import { useConnections, useLiveAiReady } from '../../store/connections'
import { useLive } from '../../store/live'
import { cn } from '../../lib/cn'
import { Badge, Button, FilterMenu, Modal, Select, Toggle, withToast } from '../ui'
import { fmtHM } from './status'

const SPEEDS = [60, 120, 300, 600]
const DURATIONS = [
  { minutes: 480, label: '8 hours' },
  { minutes: 1440, label: '24 hours' },
  { minutes: 0, label: 'Endless (until stopped)' },
]
const WINDOW_MIN = 480 // endless mode shows the last 8 sim hours
const BUCKET_MIN = 10 // generated chats are drawn as one tick per 10 sim minutes
const STATUS_BADGE: Record<CompanyState['status'], { label: string; cls: string }> = {
  idle: { label: 'Not started', cls: 'bg-surface-2 text-muted' },
  running: { label: 'Running', cls: 'bg-ok/15 text-ok' },
  paused: { label: 'Paused', cls: 'bg-warn/15 text-warn' },
  finished: { label: 'Day finished', cls: 'bg-surface-2 text-muted' },
}
/** Public demo: the backend clamps a 0-minute day to 1 minute, so the scripted day is sent explicitly. */
const DEMO_START = { day_minutes: 120, speed: 120, reset: 'keep', use_llm: false, clear_archive: false } as const

/** Remaining sim time as mm:ss inside a progress ring. */
function SyncRing({ remainingS, totalS, small }: { remainingS: number | null; totalS: number; small?: boolean }) {
  const r = 20
  const c = 2 * Math.PI * r
  const frac = remainingS == null ? 0 : Math.max(0, Math.min(1, remainingS / totalS))
  const mm = remainingS == null ? '--' : String(Math.floor(remainingS / 60)).padStart(2, '0')
  const ss = remainingS == null ? '--' : String(Math.floor(remainingS % 60)).padStart(2, '0')
  return (
    <div className="flex items-center gap-2.5" title="Sim time until the autonomous system takes the next knowledge package">
      <div className={cn('relative', small ? 'size-8' : 'size-12')}>
        <svg viewBox="0 0 48 48" className={cn(small ? 'size-8' : 'size-12', '-rotate-90')}>
          <circle cx="24" cy="24" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="4" />
          <circle cx="24" cy="24" r={r} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} className="transition-[stroke-dashoffset] duration-700 ease-linear" />
        </svg>
        <span className={cn('absolute inset-0 flex items-center justify-center font-mono tabular-nums', small ? 'hidden' : 'text-[11px] font-medium')}>{mm}:{ss}</span>
      </div>
      <div className={cn('text-xs leading-tight text-muted', small ? 'tabular-nums' : 'hidden sm:block')}>
        {small ? <>Next check {mm}:{ss}</> : <>Next sync<br />in sim time</>}
      </div>
    </div>
  )
}

const fmtSpan = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.floor(min % 60)).padStart(2, '0')} min` : `${Math.floor(min)} min`)

/** Endless mode: no end, so a rolling window of the last 8 sim hours. Generated chats are aggregated per 10 minutes. */
function EndlessTimeline({ c, nowMs, compact }: { c: CompanyState; nowMs: number | null; compact?: boolean }) {
  const start = c.started_at ? new Date(c.started_at).getTime() : null
  const elapsed = start && nowMs ? Math.max(0, (nowMs - start) / 60_000) : 0
  const from = Math.max(0, elapsed - WINDOW_MIN)
  const span = Math.max(elapsed - from, 1)
  const x = (min: number) => `${((min - from) / span) * 100}%`
  const { scripted, buckets } = useMemo(() => {
    const scripted = c.timeline.filter((e) => e.kind !== 'generated' && e.at_min >= from && e.at_min <= elapsed)
    const by = new Map<number, number>()
    for (const e of c.timeline) if (e.kind === 'generated' && e.at_min >= from && e.at_min <= elapsed) by.set(Math.floor(e.at_min / BUCKET_MIN), (by.get(Math.floor(e.at_min / BUCKET_MIN)) ?? 0) + 1)
    return { scripted, buckets: [...by.entries()] }
  }, [c.timeline, from, elapsed])
  const day = Math.floor(elapsed / 1440) + 1
  return (
    <div>
      <div className="relative h-6" role="img" aria-label="Rolling timeline of the last 8 simulated hours">
        <div className="absolute inset-x-0 top-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full w-full rounded-full bg-accent/30" />
        </div>
        {buckets.map(([b, n]) => (
          <span key={b} title={`${n} generated chat${n === 1 ? '' : 's'} around +${fmtSpan(b * BUCKET_MIN)}`} className={cn('absolute top-2 w-1 -translate-x-1/2 rounded-sm bg-accent/50', n > 2 ? 'h-3 top-1.5' : 'h-2')} style={{ left: x(b * BUCKET_MIN + BUCKET_MIN / 2) }} />
        ))}
        {scripted.map((e) => (
          <span
            key={e.id}
            title={`+${fmtSpan(e.at_min)} · ${e.label}`}
            className={cn('absolute top-1 w-1 -translate-x-1/2 rounded-sm bg-accent', e.kind === 'incident_chat' ? 'h-4' : e.kind === 'chat' ? 'h-3 top-1.5' : 'h-2 top-2')}
            style={{ left: x(e.at_min) }}
          />
        ))}
        <span className="absolute right-0 top-0.5 h-5 w-0.5 rounded-sm bg-ok" title="Now" />
      </div>
      <div className={cn('flex justify-between gap-3 text-[11px] tabular-nums text-muted', compact && 'sr-only')}>
        <span>{from > 0 ? `-${Math.round(span / 60)} h` : 'Start'}</span>
        <span>
          Day {day}, {nowMs ? format(new Date(nowMs), 'HH:mm') : '--:--'} · running for {fmtSpan(elapsed)} · {c.generated_count} chats generated
        </span>
        <span>Now</span>
      </div>
    </div>
  )
}

/** The day as a bar: progress so far, and one tick per planned chat (filled once it started). */
function DayTimeline({ c, nowMs, compact }: { c: CompanyState; nowMs: number | null; compact?: boolean }) {
  const start = c.started_at ? new Date(c.started_at).getTime() : null
  const end = c.ends_at ? new Date(c.ends_at).getTime() : null
  const pct = start && end && nowMs ? Math.max(0, Math.min(100, ((nowMs - start) / (end - start)) * 100)) : c.status === 'finished' ? 100 : 0
  return (
    <div>
      <div className="relative h-6" role="img" aria-label={`Day progress ${Math.round(pct)}%`}>
        <div className="absolute inset-x-0 top-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-linear" style={{ width: `${pct}%` }} />
        </div>
        {c.timeline.map((e) => (
          <span
            key={e.id}
            title={`+${Math.floor(e.at_min / 60)}h${String(e.at_min % 60).padStart(2, '0')} · ${e.label}${e.started ? '' : ' (planned)'}`}
            className={cn(
              'absolute top-1 w-1 -translate-x-1/2 rounded-sm transition-colors',
              e.kind === 'incident_chat' ? 'h-4' : e.kind === 'chat' ? 'h-3 top-1.5' : 'h-2 top-2',
              e.started ? 'bg-accent' : 'bg-muted/40',
            )}
            style={{ left: `${(e.at_min / c.day_minutes) * 100}%` }}
          />
        ))}
      </div>
      <div className={cn('flex justify-between text-[11px] tabular-nums text-muted', compact && 'sr-only')}>
        <span>{fmtHM(c.started_at)}</span>
        <span>{c.timeline.length ? `${c.timeline.filter((e) => e.started).length} of ${c.timeline.length} chats started` : 'Planned chats appear here'}</span>
        <span>{fmtHM(c.ends_at)}</span>
      </div>
    </div>
  )
}

/** Public demo: a 4 px progress bar instead of the tick-by-tick timeline. */
function DemoProgress({ c, nowMs }: { c: CompanyState; nowMs: number | null }) {
  const start = c.started_at ? new Date(c.started_at).getTime() : null
  const end = c.ends_at ? new Date(c.ends_at).getTime() : null
  const pct = start && end && nowMs ? Math.max(0, Math.min(100, ((nowMs - start) / (end - start)) * 100)) : c.status === 'finished' ? 100 : 0
  const started = c.timeline.filter((e) => e.started).length
  return (
    <div className="mt-1.5">
      <div className="h-1 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Day progress ${Math.round(pct)}%`}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-linear" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-[11px] tabular-nums text-muted">
        <span>{fmtHM(c.started_at)}</span>
        <span>{c.timeline.length ? `${started} of ${c.timeline.length} conversations` : ''}</span>
        <span>{fmtHM(c.ends_at)}</span>
      </div>
    </div>
  )
}

export function CompanyHeader({ c, compact, publicDemo }: { c: CompanyState; compact?: boolean; publicDemo?: boolean }) {
  const now = useSimNow(500)
  const liveAi = useLiveAiReady()
  const refreshConnections = useConnections((state) => state.refresh)
  const [speed, setSpeed] = useState(120)
  const [dayMinutes, setDayMinutes] = useState(0)
  const [fresh, setFresh] = useState(true)
  const [llm, setLlm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const editable = c.status === 'idle' || c.status === 'finished'
  const st = STATUS_BADGE[c.status]

  useEffect(() => {
    void refreshConnections(true)
  }, [refreshConnections])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      // A 409 (already running) or any failure: re-read the real state so the buttons match it.
      if ((await withToast(fn)) === undefined) await useLive.getState().loadCompany()
    } finally {
      setBusy(false)
    }
  }
  const start = () => run(() => companyActions.start(publicDemo ? { ...DEMO_START, use_llm: liveAi } : { speed, day_minutes: dayMinutes, reset: fresh ? 'empty' : 'keep', use_llm: llm }))

  const remaining = c.next_cycle_at && now && c.status === 'running' ? Math.max(0, (new Date(c.next_cycle_at).getTime() - now.getTime()) / 1000) : null
  const clock = now ? now.toLocaleTimeString('en-GB') : '--:--:--'

  // Public demo: one compact control row, so the story and the graph keep the height.
  if (publicDemo)
    return (
      <div className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-xs font-medium text-muted">Company day</h1>
          <Badge className={st.cls}>{st.label}</Badge>
          <div role="timer" aria-label="Simulated clock" className="font-mono text-xl font-semibold leading-none tracking-tight tabular-nums">{clock}</div>
          <SyncRing remainingS={remaining} totalS={c.cycle_minutes * 60} small />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {editable && <Button icon={<Play size={15} />} onClick={start} loading={busy}>{c.status === 'finished' ? 'Play again' : 'Play day'}</Button>}
            {c.status === 'running' && <Button icon={<Pause size={15} />} onClick={() => run(companyActions.pause)} loading={busy}>Pause</Button>}
            {c.status === 'paused' && <Button variant="primary" icon={<Play size={15} />} onClick={() => run(companyActions.resume)} loading={busy}>Resume</Button>}
          </div>
        </div>
        {c.status !== 'idle' && <DemoProgress c={c} nowMs={now?.getTime() ?? null} />}
      </div>
    )

  const options = (
    <>
          <label className="flex items-center gap-2 text-sm text-muted">
            Speed
            <Select value={editable ? speed : c.speed} disabled={!editable} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Simulation speed" className="w-24">
              {SPEEDS.map((s) => (
                <option key={s} value={s}>{s}x</option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            Duration
            <Select value={editable ? dayMinutes : c.endless ? 0 : c.day_minutes} disabled={!editable} onChange={(e) => setDayMinutes(Number(e.target.value))} aria-label="Day duration" className="w-52 max-w-full">
              {DURATIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>{d.label}</option>
              ))}
            </Select>
          </label>
          <Toggle checked={editable ? fresh : false} onChange={setFresh} disabled={!editable} label="Fresh start (graph + archive)" />
          <Toggle checked={editable ? llm : c.use_llm} onChange={setLlm} disabled={!editable} label="Use LLM for agent calls" />
    </>
  )
  const timeline = c.endless ? <EndlessTimeline c={c} nowMs={now?.getTime() ?? null} compact={compact} /> : <DayTimeline c={c} nowMs={now?.getTime() ?? null} compact={compact} />
  return (
    <div className={cn('shrink-0 rounded-lg border border-line bg-surface', compact ? 'px-3 py-2' : 'px-4 py-3')}>
      <div className={cn('flex flex-wrap items-center gap-x-5', compact ? 'gap-y-2' : 'gap-y-3')}>
        <div>
          <div className="flex items-center gap-2 text-xs text-muted">
            Simulated clock
            <Badge className={st.cls}>{st.label}</Badge>
          </div>
          <div role="timer" aria-label="Simulated clock" className="font-mono text-2xl font-semibold sm:text-3xl leading-none tracking-tight tabular-nums">{clock}</div>
        </div>
        <SyncRing remainingS={remaining} totalS={c.cycle_minutes * 60} />
        <div className="flex flex-wrap items-center gap-2">
          {editable && <Button variant="primary" icon={<Play size={15} />} onClick={start} loading={busy}>{c.status === 'finished' ? 'Run another day' : 'Start the day'}</Button>}
          {c.status === 'running' && <Button icon={<Pause size={15} />} onClick={() => run(companyActions.pause)} loading={busy}>Pause</Button>}
          {c.status === 'paused' && <Button variant="primary" icon={<Play size={15} />} onClick={() => run(companyActions.resume)} loading={busy}>Resume</Button>}
          {(c.status === 'running' || c.status === 'paused') && <Button variant="danger" icon={<Square size={14} />} onClick={() => setConfirmStop(true)} aria-haspopup="dialog">Stop</Button>}
        </div>
        {compact && <div className="min-w-[140px] flex-1" title={`${c.timeline.length} planned chats`}>{timeline}</div>}
        {compact ? (
          <FilterMenu className="ml-auto" label="Options">{options}</FilterMenu>
        ) : (
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">{options}</div>
        )}
      </div>
      {!compact && <div className="mt-2">{timeline}</div>}
      <Modal
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Stop the company day?"
        footer={
          <>
            <Button onClick={() => setConfirmStop(false)}>Keep running</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmStop(false)
                void run(companyActions.stop)
              }}
            >
              Stop the day
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">The simulated day ends here. Conversations, knowledge and cycles so far are kept.</p>
      </Modal>
    </div>
  )
}
