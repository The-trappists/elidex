import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** Small pill. Pass a semantic class from lib/semantic.ts, e.g. TYPE_STYLE.workaround.cls. */
export function Badge({ className, children, title }: { className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1.5 rounded px-1.5 py-[3px] text-xs font-medium leading-none whitespace-nowrap', className ?? 'bg-surface-2 text-muted')}
    >
      {children}
    </span>
  )
}

/** Monospace chip for ids (TRN-042, ctx_0001, class:...). */
export function IdChip({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      className={cn('inline-flex items-center rounded-md border border-line bg-surface-2 px-1.5 py-1 font-mono text-xs text-text transition', onClick && 'cursor-pointer hover:border-accent hover:text-accent-2', className)}
    >
      {children}
    </span>
  )
}

/** Selectable filter chip (toggle) with an optional color dot and count. 32px tall for easy clicking. */
export function Chip({
  selected,
  onClick,
  dot,
  count,
  title,
  children,
}: {
  selected: boolean
  onClick: () => void
  dot?: string
  count?: number
  title?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
        selected ? 'border-line bg-surface-2 text-text' : 'border-transparent text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      {dot && <span className={cn('size-2 rounded-full', !selected && 'opacity-40')} style={{ background: dot }} />}
      {children}
      {count !== undefined && <span className="tabular-nums text-muted">{count}</span>}
    </button>
  )
}

export function Dot({ className }: { className?: string }) {
  return <span className={cn('inline-block size-2 rounded-full', className)} />
}
