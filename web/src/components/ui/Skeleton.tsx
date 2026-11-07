import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** A grey shimmering block; size it with className (e.g. "h-4 w-32"). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4 rounded-md', className)} />
}

/** Placeholder paragraph: a few shimmering lines. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  )
}

/** "In progress" state for a step that has not finished: spinner, a sentence, and a skeleton. */
export function InProgress({ children = 'In progress…' }: { children?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-info">
        <span className="size-3.5 animate-spin rounded-full border-2 border-info/30 border-t-info" />
        {children}
      </div>
      <SkeletonLines lines={2} />
    </div>
  )
}

/** Centered loading state for a page or panel. */
export function LoadingState({ label = 'Loading…', className }: { label?: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex h-full min-h-32 flex-col items-center justify-center gap-3 p-6 text-sm text-muted', className)}>
      <span className="size-7 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
      {label}
    </div>
  )
}
