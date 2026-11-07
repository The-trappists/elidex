import type { ReactNode } from 'react'

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 p-6 text-center">
      {icon && <div className="flex size-14 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</div>}
      <div className="mt-1 text-sm font-semibold">{title}</div>
      {hint && <div className="max-w-sm text-xs leading-relaxed text-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
