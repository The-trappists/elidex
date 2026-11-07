import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** Bar under the top bar that holds a page's tabs, filters and actions. One height and one padding everywhere. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-5 py-2.5', className)}>{children}</div>
}

/** Heading of a page that scrolls as a whole (Settings): title, one-line description, actions. */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * Titled block. `card` is a bordered card for page bodies; `flat` is a divided block for side panels
 * (Inspector, drawers). Same heading weight in both, so a section looks like a section everywhere.
 */
export function Section({
  title,
  description,
  icon: Icon,
  count,
  actions,
  variant = 'card',
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  count?: number
  actions?: ReactNode
  variant?: 'card' | 'flat'
  children: ReactNode
  className?: string
}) {
  const head = (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', variant === 'flat' ? 'mb-2.5' : 'mb-4')}>
      {Icon && <Icon size={16} className="shrink-0 text-muted" aria-hidden />}
      <h3 className="text-sm font-semibold">{title}</h3>
      {count !== undefined && <span className="rounded bg-surface-2 px-1.5 text-xs tabular-nums text-muted">{count}</span>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      {description && <p className="basis-full text-xs text-muted">{description}</p>}
    </div>
  )
  if (variant === 'flat')
    return (
      <section className={cn('border-b border-line px-4 py-4 last:border-0', className)}>
        {head}
        {children}
      </section>
    )
  return (
    <section className={cn('rounded-lg border border-line bg-surface p-5', className)}>
      {head}
      {children}
    </section>
  )
}
