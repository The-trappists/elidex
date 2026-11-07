import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-2xl border border-line bg-surface shadow-[var(--shadow-sm)]', className)}>{children}</div>
}

/** Card with a header row (title, optional icon, right-side actions) and a scrollable body. */
export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        {icon && <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-accent">{icon}</span>}
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>
    </Card>
  )
}
