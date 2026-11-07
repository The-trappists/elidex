import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  count?: number
}

/** Underlined tabs: quiet, one accent for the active one. */
export function Tabs<T extends string>({ items, value, onChange, className }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-4 border-b border-line', className)}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px flex items-center gap-1.5 border-b-2 px-0.5 py-2 text-sm font-medium transition-colors',
            value === t.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
