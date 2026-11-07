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
    className: 'w-full min-w-[320px]',
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
      <ul className="divide-y divide-line/60 2xl:hidden">
        {rows.map((a) => (
          <li key={a.id}>
            <button
              onClick={() => onOpen(a.id)}
              aria-pressed={selected === a.id}
              className={`block w-full px-4 py-3 text-left hover:bg-surface-2 focus-visible:bg-surface-2 ${selected === a.id ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]' : ''}`}
            >
              <div className="line-clamp-2 text-sm font-medium leading-snug">{a.summary}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <TypeBadge type={a.type} />
                <TrustBadge level={a.trust.level} />
                {isOperatorEdited(a) && <OperatorChip />}
                <ConflictIcon a={a} />
                <Validity a={a} />
                <span className="text-xs text-muted">
                  · {a.sources.length} conversation{a.sources.length === 1 ? '' : 's'}
                </span>
              </div>
              {a.bound_to.length > 0 && (
                <div className="mt-1.5">
                  <BindingChips bound={a.bound_to} />
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden 2xl:block">
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
