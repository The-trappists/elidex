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
      <thead className="sticky top-0 z-10 bg-surface-2 shadow-[0_1px_0_var(--line)]">
        <tr className="text-left text-xs uppercase tracking-wide text-muted">
          {columns.map((c) => (
            <th key={c.key} className={cn('px-3 py-2.5 font-semibold whitespace-nowrap', c.className)}>
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
              className={cn('border-b border-line/60 last:border-0 hover:bg-surface-2', onRowClick && 'cursor-pointer', rowClassName?.(r), selectedKey === k && 'bg-accent-soft hover:bg-accent-soft')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2.5 align-top', c.className)}>
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
