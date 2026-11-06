import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  count?: number
}

export function Tabs<T extends string>({ items, value, onChange, className }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-lg border border-line bg-surface-2 p-0.5', className)}>
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition',
            value === t.id ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded bg-line/60 px-1 text-[11.5px] text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
