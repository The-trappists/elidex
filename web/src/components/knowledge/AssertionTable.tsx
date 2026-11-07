import { BookOpen, PlayCircle } from 'lucide-react'
import { api } from '../../api/client'
import { useLive } from '../../store/live'
import type { ContextAssertion } from '../../api/types'
import { Button, EmptyState, Table, withToast, type Column } from '../ui'
import { BindingChips, ConflictIcon, isOperatorEdited, OperatorChip, TrustBadge, TypeBadge, Validity } from './bits'

const columns: Column<ContextAssertion>[] = [
  {
    key: 'what',
    header: 'What the team knows',
    className: 'max-w-lg',
    cell: (a) => (
      <>
        <div className="line-clamp-2 text-sm font-medium leading-snug">{a.summary}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TypeBadge type={a.type} />
          {isOperatorEdited(a) && <OperatorChip />}
          <ConflictIcon a={a} />
        </div>
      </>
    ),
  },
  { key: 'bound', header: 'Applies to', className: 'max-w-xs', cell: (a) => <BindingChips bound={a.bound_to} /> },
  { key: 'trust', header: 'Reliability', cell: (a) => <TrustBadge level={a.trust.level} /> },
  { key: 'valid', header: 'Valid', className: 'whitespace-nowrap', cell: (a) => <Validity a={a} /> },
  {
    key: 'src',
    header: 'Heard in',
    className: 'whitespace-nowrap text-[13px] text-muted',
    cell: (a) => `${a.sources.length} conversation${a.sources.length === 1 ? '' : 's'}`,
  },
]

function NoKnowledge() {
  const any = useLive((s) => Object.keys(s.assertions).length > 0)
  const first = useLive((s) => s.scenarios[0])
  if (any)
    return (
      <EmptyState
        icon={<BookOpen size={28} />}
        title="Nothing matches the filters"
        hint="Clear the search or the type, trust, thread and validity filters."
      />
    )
  return (
    <EmptyState
      icon={<BookOpen size={28} />}
      title="No knowledge yet"
      hint="Knowledge appears here once a conversation goes quiet and is processed. Start the clock and run a scenario (top bar), or post messages in Conversations."
      action={
        first && (
          <Button
            variant="primary"
            icon={<PlayCircle size={15} />}
            onClick={() => void withToast(() => api.runScenario(first.id), `Started: ${first.title}`)}
          >
            Run "{first.title}"
          </Button>
        )
      }
    />
  )
}

export function AssertionTable({
  rows,
  selected,
  onOpen,
}: {
  rows: ContextAssertion[]
  selected: string | null
  onOpen: (id: string) => void
}) {
  if (!rows.length) return <NoKnowledge />
  return (
    <>
      <div className="space-y-3 p-4 lg:hidden">
        {rows.map((a) => (
          <button
            key={a.id}
            onClick={() => onOpen(a.id)}
            aria-pressed={selected === a.id}
            className="w-full rounded-xl border border-line bg-surface p-4 text-left hover:border-accent focus-visible:border-accent"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <TypeBadge type={a.type} />
              <TrustBadge level={a.trust.level} />
              <ConflictIcon a={a} />
            </div>
            <p className="text-sm font-medium leading-relaxed">{a.summary}</p>
            <div className="mt-3 text-xs text-muted">
              <Validity a={a} />
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs">
              <span className="text-muted">
                {a.sources.length} source conversation{a.sources.length === 1 ? '' : 's'}
              </span>
              <span className="font-medium text-accent">Read knowledge →</span>
            </div>
          </button>
        ))}
      </div>
      <div className="hidden lg:block">
        <Table
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          selectedKey={selected}
          onRowClick={(a) => onOpen(a.id)}
          empty={<NoKnowledge />}
        />
      </div>
    </>
  )
}
