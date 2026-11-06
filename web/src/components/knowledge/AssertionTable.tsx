import { BookOpen, PlayCircle } from 'lucide-react'
import { api } from '../../api/client'
import { useLive } from '../../store/live'
import type { ContextAssertion } from '../../api/types'
import { Button, EmptyState, IdChip, Table, withToast, type Column } from '../ui'
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

function NoKnowledge() {
  const any = useLive((s) => Object.keys(s.assertions).length > 0)
  const first = useLive((s) => s.scenarios[0])
  if (any) return <EmptyState icon={<BookOpen size={28} />} title="Nothing matches the filters" hint="Clear the search or the type, trust, thread and validity filters." />
  return (
    <EmptyState
      icon={<BookOpen size={28} />}
      title="No knowledge yet"
      hint="Assertions appear here once a conversation goes quiet and is processed. Start the clock and run a scenario (top bar), or post messages in Conversations."
      action={first && <Button variant="primary" icon={<PlayCircle size={15} />} onClick={() => void withToast(() => api.runScenario(first.id), `Started: ${first.title}`)}>Run "{first.title}"</Button>}
    />
  )
}

export function AssertionTable({ rows, selected, onOpen }: { rows: ContextAssertion[]; selected: string | null; onOpen: (id: string) => void }) {
  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      selectedKey={selected}
      onRowClick={(a) => onOpen(a.id)}
      empty={<NoKnowledge />}
    />
  )
}
