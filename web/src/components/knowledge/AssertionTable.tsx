import { BookOpen } from 'lucide-react'
import type { ContextAssertion } from '../../api/types'
import { EmptyState, IdChip, Table, type Column } from '../ui'
import { BindingChips, ConflictIcon, TrustBadge, TypeBadge, Validity } from './bits'

const columns: Column<ContextAssertion>[] = [
  {
    key: 'what',
    header: 'What the team knows',
    className: 'max-w-lg',
    cell: (a) => (
      <>
        <div className="line-clamp-2 text-[13px] font-medium leading-snug">{a.summary}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TypeBadge type={a.type} />
          <span className="text-xs text-muted">{a.topic}</span>
          <IdChip>{a.id}</IdChip>
          <ConflictIcon a={a} />
        </div>
      </>
    ),
  },
  { key: 'bound', header: 'Applies to', className: 'max-w-xs', cell: (a) => <BindingChips bound={a.bound_to} /> },
  { key: 'trust', header: 'Reliability', cell: (a) => <TrustBadge level={a.trust.level} /> },
  { key: 'valid', header: 'Valid', className: 'whitespace-nowrap', cell: (a) => <Validity a={a} /> },
  { key: 'src', header: 'Heard in', className: 'whitespace-nowrap text-xs text-muted', cell: (a) => `${a.sources.length} conversation${a.sources.length === 1 ? '' : 's'}` },
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
