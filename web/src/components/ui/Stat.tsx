import { AlertTriangle, Lightbulb } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Explained } from '../../lib/explain'
import { cn } from '../../lib/cn'

/** Number that eases from its previous value to the new one. */
export function AnimatedNumber({ value, duration = 600 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(Math.round(a + (value - a) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <>{shown.toLocaleString('en')}</>
}

const TONES = {
  neutral: { ring: 'text-muted', chip: 'bg-surface-2 text-muted', bar: 'bg-line' },
  accent: { ring: 'text-accent', chip: 'bg-accent-soft text-accent', bar: 'bg-brand' },
  ok: { ring: 'text-ok', chip: 'bg-ok/15 text-ok', bar: 'bg-ok' },
  warn: { ring: 'text-warn', chip: 'bg-warn/15 text-warn', bar: 'bg-warn' },
  bad: { ring: 'text-bad', chip: 'bg-bad/15 text-bad', bar: 'bg-bad' },
} as const
export type Tone = keyof typeof TONES

/** KPI tile: icon, animated value, label and an optional one-line explanation. */
export function Stat({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
  onClick,
  suffix,
}: {
  icon: ReactNode
  label: string
  value: number
  hint?: string
  tone?: Tone
  onClick?: () => void
  suffix?: string
}) {
  const t = TONES[tone]
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        'group relative flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-lg border border-line bg-surface px-4 py-3 text-left shadow-[var(--shadow-sm)] lift',
        !onClick && 'cursor-default hover:!transform-none hover:!shadow-[var(--shadow-sm)]',
        onClick && 'hover:border-accent/50',
      )}
    >
      <span className={cn('absolute inset-x-0 top-0 h-0.5 opacity-70', t.bar)} />
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md transition-transform', t.chip)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold leading-none tracking-tight tabular-nums">
          <AnimatedNumber value={value} />
          {suffix && <span className="ml-0.5 text-sm font-medium text-muted">{suffix}</span>}
        </span>
        <span className="mt-1.5 block truncate text-xs font-medium">{label}</span>
        {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
      </span>
    </button>
  )
}

/** Human explanation of an error, with the raw technical text folded away. */
export function ErrorNote({ explained, raw, className, count, since }: { explained: Explained; raw?: string | null; className?: string; count?: number; since?: string }) {
  return (
    <div className={cn('rounded-md border border-bad/30 bg-bad/8 p-3 animate-slide-in', className)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-bad/15 text-bad">
          <AlertTriangle size={14} />
        </span>
        <div className="min-w-0 text-sm">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-bad">
            {explained.title}
            {count != null && count > 1 && (
              <span className="rounded-full bg-bad/15 px-2 py-0.5 text-xs font-medium">
                happened {count} times{since ? ` since ${new Date(since).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}` : ''}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] leading-snug">{explained.detail}</p>
          {explained.hint && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted">
              <Lightbulb size={12} className="mt-0.5 shrink-0 text-warn" />
              {explained.hint}
            </p>
          )}
          {raw && (
            <details className="mt-2 text-xs text-muted">
              <summary className="cursor-pointer select-none hover:text-text">Technical details</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-mono">{raw}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
