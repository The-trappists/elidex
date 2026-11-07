import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-line bg-surface shadow-sm', className)}>{children}</div>
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
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3.5">
        {icon && <span className="text-muted">{icon}</span>}
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>
    </Card>
  )
}
