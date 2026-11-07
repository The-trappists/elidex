import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** Small pill. Pass a semantic class from lib/semantic.ts, e.g. TYPE_STYLE.workaround.cls. */
export function Badge({ className, children, title }: { className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium leading-none whitespace-nowrap', className ?? 'bg-surface-2 text-muted')}
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
      className={cn('inline-flex items-center rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text transition', onClick && 'cursor-pointer hover:border-accent hover:text-accent', className)}
    >
      {children}
    </span>
  )
}

export function Dot({ className }: { className?: string }) {
  return <span className={cn('inline-block size-2 rounded-full', className)} />
}
