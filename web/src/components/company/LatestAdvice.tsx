import { Bot } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentCall, CompanyState } from '../../api/types'
import { useLive } from '../../store/live'
import { Button, Drawer, EmptyState } from '../ui'
import { fmtHM } from './status'

function AdviceRow({ call, topic }: { call: AgentCall; topic: string | undefined }) {
  return (
    <li className="px-4 py-3">
      <p className="text-[13px] leading-snug">{call.recommendation}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
        {topic && <span className="truncate">{topic}</span>}
        {topic && <span aria-hidden>·</span>}
        <span className="font-mono">{call.entity_id}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{fmtHM(call.at)}</span>
      </p>
    </li>
  )
}

/** Public demo: the latest three agent calls, with the full activity list in a drawer. */
export function LatestAdvice({ c }: { c: CompanyState }) {
  const assertions = useLive((s) => s.assertions)
  const [open, setOpen] = useState(false)
  const latest = useMemo(() => [...c.calls].slice(-3).reverse(), [c.calls])
  const all = useMemo(() => [...c.calls].reverse(), [c.calls])

  if (!latest.length) return <EmptyState icon={<Bot size={24} />} title="Play the day to see advice." />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="min-h-0 flex-1 divide-y divide-line">
        {latest.map((call) => (
          <AdviceRow key={call.id} call={call} topic={call.cited_assertion_ids.map((id) => assertions[id]?.topic).find(Boolean)} />
        ))}
      </ul>
      <div className="shrink-0 border-t border-line px-4 py-2">
        <Button size="sm" onClick={() => setOpen(true)}>See all advice</Button>
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} title="All agent activity" width="max-w-xl">
        {all.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {all.map((call) => (
              <AdviceRow key={call.id} call={call} topic={call.cited_assertion_ids.map((id) => assertions[id]?.topic).find(Boolean)} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No advice yet." />
        )}
      </Drawer>
    </div>
  )
}
