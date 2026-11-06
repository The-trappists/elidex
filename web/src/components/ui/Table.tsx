import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  empty,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  selectedKey?: string | null
  empty?: ReactNode
}) {
  if (!rows.length && empty) return <>{empty}</>
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-surface">
        <tr className="border-b border-line text-left text-xs text-muted">
          {columns.map((c) => (
            <th key={c.key} className={cn('px-3 py-2 font-medium', c.className)}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const k = rowKey(r)
          return (
            <tr
              key={k}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn('border-b border-line/60 last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-2', selectedKey === k && 'bg-accent-soft')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2 align-top', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
