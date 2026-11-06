import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Origin } from '../../api/types'
import { ORIGIN_STYLE } from '../../lib/semantic'
import { Badge, Button, EmptyState, IconButton, Modal, Table, Toggle, withToast, type Column } from '../ui'

export const originCol = <T extends { origin: Origin }>(): Column<T> => ({
  key: 'origin',
  header: 'Origin',
  cell: (r) => <Badge className={ORIGIN_STYLE[r.origin].cls}>{ORIGIN_STYLE[r.origin].label}</Badge>,
})

/** Table with "only generated" filter, Add / Edit / Delete (with confirmation). Forms are supplied by the caller. */
export function CrudTab<T extends { id: string; origin: Origin }>({
  noun,
  rows,
  columns,
  onAdd,
  onEdit,
  onDelete,
  extraActions,
  rowActions,
  intro,
}: {
  noun: string
  rows: T[]
  columns: Column<T>[]
  onAdd?: () => void
  onEdit?: (row: T) => void
  onDelete: (row: T) => Promise<unknown>
  extraActions?: ReactNode
  rowActions?: (row: T) => ReactNode
  intro?: ReactNode
}) {
  const [onlyGen, setOnlyGen] = useState(false)
  const [del, setDel] = useState<T | null>(null)
  const shown = onlyGen ? rows.filter((r) => r.origin === 'generated') : rows

  const actionCol: Column<T> = {
    key: 'actions',
    header: '',
    className: 'w-px whitespace-nowrap text-right',
    cell: (r) => (
      <div className="flex justify-end gap-0.5">
        {rowActions?.(r)}
        {onEdit && <IconButton title="Edit" onClick={() => onEdit(r)}><Pencil size={14} /></IconButton>}
        <IconButton title="Delete" className="hover:!text-bad" onClick={() => setDel(r)}><Trash2 size={14} /></IconButton>
      </div>
    ),
  }

  const confirm = async () => {
    if (!del) return
    await withToast(() => onDelete(del), `${noun} deleted`)
    setDel(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <Toggle checked={onlyGen} onChange={setOnlyGen} label="Only generated" />
        <span className="text-xs text-muted">{shown.length} shown</span>
        {intro}
        <div className="ml-auto flex gap-2">
          {extraActions}
          {onAdd && <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={onAdd}>Add {noun.toLowerCase()}</Button>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table
          columns={[...columns, actionCol]}
          rows={shown}
          rowKey={(r) => r.id}
          empty={<EmptyState title={rows.length ? `No generated ${noun.toLowerCase()}s` : `No ${noun.toLowerCase()}s yet`} hint={onAdd ? `Use "Add ${noun.toLowerCase()}" to create one.` : undefined} />}
        />
      </div>
      <Modal
        open={!!del}
        onClose={() => setDel(null)}
        title={`Delete ${noun.toLowerCase()} ${del?.id ?? ''}?`}
        footer={<><Button onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" onClick={confirm}>Delete</Button></>}
      >
        <p className="text-sm">This cannot be undone. Things that refer to it (links, bound knowledge) may be affected.</p>
      </Modal>
    </div>
  )
}
