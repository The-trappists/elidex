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
  rowClassName,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  selectedKey?: string | null
  empty?: ReactNode
  /** Extra classes per row, e.g. to flag failed rows. */
  rowClassName?: (row: T) => string | false | undefined
}) {
  if (!rows.length && empty) return <>{empty}</>
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
        <tr className="border-b border-line text-left text-[13px] text-muted">
          {columns.map((c) => (
            <th key={c.key} className={cn('px-3 py-2.5 font-semibold', c.className)}>
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
              className={cn('animate-item-in border-b border-line/50 transition-colors last:border-0', rowClassName?.(r), onRowClick && 'cursor-pointer hover:bg-surface-2', selectedKey === k && 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-3 align-top', c.className)}>
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
