import { BookOpen } from 'lucide-react'
import type { ContextAssertion } from '../../api/types'
import { EmptyState, IdChip, Table, type Column } from '../ui'
import { BindingChips, ConflictIcon, TrustBadge, TypeBadge, Validity } from './bits'

const columns: Column<ContextAssertion>[] = [
  { key: 'id', header: 'ID', cell: (a) => <IdChip>{a.id}</IdChip> },
  { key: 'type', header: 'Type', cell: (a) => <TypeBadge type={a.type} /> },
  { key: 'topic', header: 'Topic', className: 'font-medium', cell: (a) => a.topic },
  { key: 'summary', header: 'Summary', className: 'max-w-md', cell: (a) => <div className="line-clamp-2 text-xs text-muted">{a.summary}</div> },
  { key: 'bound', header: 'Bound to', className: 'max-w-xs', cell: (a) => <BindingChips bound={a.bound_to} /> },
  { key: 'trust', header: 'Trust', cell: (a) => <TrustBadge level={a.trust.level} /> },
  { key: 'valid', header: 'Validity', className: 'whitespace-nowrap', cell: (a) => <Validity a={a} /> },
  { key: 'src', header: 'Src', className: 'text-center text-xs', cell: (a) => a.sources.length },
  { key: 'conf', header: '', cell: (a) => <ConflictIcon a={a} /> },
]

export function AssertionTable({ rows, selected, onOpen }: { rows: ContextAssertion[]; selected: string | null; onOpen: (id: string) => void }) {
  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      selectedKey={selected}
      onRowClick={(a) => onOpen(a.id)}
      empty={<EmptyState icon={<BookOpen size={28} />} title="No knowledge to show" hint="Nothing matches the filters, or no conversation has been processed yet." />}
    />
  )
}
