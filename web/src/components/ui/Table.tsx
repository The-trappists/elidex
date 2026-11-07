import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { useMediaQuery } from '../../lib/useMediaQuery'

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
  stackBelow = 768,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  selectedKey?: string | null
  empty?: ReactNode
  /** Extra classes per row, e.g. to flag failed rows. */
  rowClassName?: (row: T) => string | false | undefined
  /** Under this width (px) the rows become cards: the first column is the title, the others get a label. 0 keeps the table. */
  stackBelow?: number
}) {
  const stacked = useMediaQuery(`(max-width: ${stackBelow - 1}px)`) && stackBelow > 0
  if (!rows.length && empty) return <>{empty}</>
  if (stacked) {
    return (
      <ul className="divide-y divide-line/60">
        {rows.map((r) => {
          const k = rowKey(r)
          return (
            <li
              key={k}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn('flex flex-col gap-2 px-3 py-3', rowClassName?.(r), onRowClick && 'cursor-pointer active:bg-surface-2', selectedKey === k && 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]')}
            >
              {columns.map((c, i) => (
                <div key={c.key} className={cn(i > 0 && 'flex items-baseline gap-2 text-xs')}>
                  {i > 0 && <span className="w-24 shrink-0 text-muted">{c.header}</span>}
                  <div className="min-w-0 flex-1 break-words">{c.cell(r)}</div>
                </div>
              ))}
            </li>
          )
        })}
      </ul>
    )
  }
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
