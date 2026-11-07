import { useEffect, useRef, useState } from 'react'
import { simNow, useLive } from '../../store/live'
import { fmtDateTime } from '../../lib/format'
import { plural } from '../../lib/explain'

const STEP_MS = 380 // time between status lines (about 2 s for the whole sequence)
const WAIT_MAX_MS = 4000 // longest wait for the live store before opening anyway

/** Full-screen boot sequence shown after the home click. Click or Esc skips it. Numbers are read from the live store when each line appears. */
export function BootSequence({ onDone }: { onDone: () => void }) {
  const reduced = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches).current
  const ready = useLive((s) => s.ready)
  const [lines, setLines] = useState<string[]>(['Connecting...'])
  const [steps, setSteps] = useState(0) // finished steps, 0..TOTAL
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const gap = reduced ? 70 : STEP_MS
    const tick = () => {
      const s = useLive.getState()
      const n = steps
      if (!s.ready) return // never claim a connection that is not there
      const clock = simNow(s)
      const text = [
        'Connected to the live stream',
        `Loading the network graph: ${plural(s.elements.length, 'element')}, ${plural(s.sites.length, 'site')}`,
        `Indexing knowledge: ${plural(Object.keys(s.assertions).length, 'assertion')}`,
        `Reading conversations: ${plural(Object.keys(s.threads).length, 'thread')}, ${plural(s.personas.length, 'persona')}`,
        `Syncing the simulated clock: ${clock ? fmtDateTime(clock.toISOString()) : 'not started'}`,
      ]
      if (n < text.length) {
        setLines((l) => (n === 0 ? [text[0]] : [...l, text[n]]))
        setSteps(n + 1)
      } else done.current()
    }
    const t = setTimeout(tick, steps === 0 ? 250 : steps === 5 ? 450 : gap)
    return () => clearTimeout(t)
  }, [steps, reduced, ready])

  // Still not connected after the longest wait: open the dashboard anyway.
  useEffect(() => {
    if (ready) return
    const t = setTimeout(() => done.current(), WAIT_MAX_MS)
    return () => clearTimeout(t)
  }, [ready])

  return (
    <div
      role="dialog"
      aria-label="Opening the workbench"
      onClick={onDone}
      className="animate-fade-in fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center gap-8 bg-bg px-6 text-text"
    >
      <div className="flex items-center gap-3">
        <img src="/elidex-logo.png" alt="" className="size-10 object-contain" />
        <span className="font-display text-3xl font-semibold tracking-tight">
          Elid<span className="text-accent">Ex</span>
        </span>
      </div>
      <div className="h-1 w-72 max-w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${(steps / 5) * 100}%`, transition: reduced ? 'none' : 'width 380ms ease-out' }}
        />
      </div>
      <ul className="h-28 w-80 max-w-full space-y-1.5 overflow-hidden font-mono text-xs text-muted" aria-live="polite">
        {lines.slice(-5).map((l, i, a) => (
          <li key={l} className={i === a.length - 1 ? 'animate-item-in text-text' : ''}>
            <span className="mr-2 text-accent">{i === a.length - 1 && steps < 5 ? '>' : '✓'}</span>
            {l}
          </li>
        ))}
      </ul>
      <span className="text-xs text-muted">Click anywhere or press Esc to skip</span>
    </div>
  )
}
