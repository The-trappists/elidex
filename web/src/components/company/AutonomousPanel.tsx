import { ArrowRight, Bot, Package } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentCall, CompanyCycle, CompanyState, HealthStatus } from '../../api/types'
import { cn } from '../../lib/cn'
import { Badge, Button, EmptyState, IdChip } from '../ui'
import { PackageDrawer } from './PackageDrawer'
import { HEALTH_STYLE, fmtHM } from './status'

function StatusPill({ s }: { s: HealthStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', HEALTH_STYLE[s].chip)}>
      <span className={cn('size-1.5 rounded-full', HEALTH_STYLE[s].dot)} />
      {HEALTH_STYLE[s].label}
    </span>
  )
}

function CycleCard({ c, active, onClick }: { c: CompanyCycle; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn('w-[118px] shrink-0 animate-fade-in rounded-lg border px-2.5 py-2 text-left transition-colors', active ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-surface-2')}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold tabular-nums">{fmtHM(c.at)}</span>
        <span className="text-[11px] text-muted">#{c.n}</span>
      </div>
      <dl className="mt-1 space-y-0.5 text-[11px] text-muted">
        <div className="flex justify-between"><dt>New</dt><dd className="font-medium tabular-nums text-text">+{c.package.new_ids.length}</dd></div>
        <div className="flex justify-between"><dt>Closed</dt><dd className="font-medium tabular-nums text-text">{c.package.closed_ids.length}</dd></div>
        <div className="flex justify-between"><dt>Calls</dt><dd className="font-medium tabular-nums text-text">{c.agent_call_ids.length}</dd></div>
        <div className="flex justify-between"><dt>Status</dt><dd className={cn('font-medium tabular-nums', c.status_changes.length ? 'text-accent' : 'text-text')}>{c.status_changes.length} changed</dd></div>
      </dl>
    </button>
  )
}

function Call({ call }: { call: AgentCall }) {
  const obs = Object.entries(call.observations).slice(0, 4)
  return (
    <li className="space-y-1.5 px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <IdChip>{call.entity_id}</IdChip>
        <StatusPill s={call.status_before} />
        <ArrowRight size={12} className="text-muted" />
        <StatusPill s={call.status_after} />
        <Badge className="ml-auto bg-surface-2 text-muted">{call.used_llm ? 'LLM' : 'Rules'}</Badge>
      </div>
      {obs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {obs.map(([k, v]) => (
            <span key={k} className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">
              {k}: <span className="text-text">{String(v)}</span>
            </span>
          ))}
        </div>
      )}
      <p className="text-[13px] leading-snug">{call.recommendation}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-muted">
        <span>
          Retrieved {call.hit_ids.length}, skipped {call.skipped}
        </span>
        {call.cited_assertion_ids.length > 0 && <span>· cited</span>}
        {call.cited_assertion_ids.map((id) => (
          <Link key={id} to={`/knowledge?assertion=${encodeURIComponent(id)}`}>
            <IdChip className="hover:border-accent hover:text-accent">{id}</IdChip>
          </Link>
        ))}
      </div>
    </li>
  )
}

/** The autonomous system: one card per 10-minute cycle, and the agent calls of the chosen cycle below. */
export function AutonomousPanel({ c }: { c: CompanyState }) {
  const [picked, setPicked] = useState<number | null>(null)
  const [drawer, setDrawer] = useState(false)
  const latest = c.cycles[c.cycles.length - 1]
  const n = picked != null && c.cycles.some((x) => x.n === picked) ? picked : latest?.n
  const cycle = c.cycles.find((x) => x.n === n)
  const calls = useMemo(() => {
    const ids = new Set(cycle?.agent_call_ids ?? [])
    return c.calls.filter((x) => x.cycle === n || ids.has(x.id))
  }, [c.calls, cycle, n])
  const reversed = useMemo(() => [...c.cycles].reverse(), [c.cycles])

  // A new cycle brings the view back to the latest one.
  useEffect(() => setPicked(null), [latest?.n])

  if (!c.cycles.length)
    return (
      <EmptyState
        icon={<Bot size={24} />}
        title="No sync yet"
        hint={`Every ${c.cycle_minutes} simulated minutes the autonomous system takes the knowledge package, asks the context layer about the elements it watches, and updates the network status.`}
      />
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-line p-3">
        {reversed.map((x) => (
          <CycleCard key={x.n} c={x} active={x.n === n} onClick={() => setPicked(x.n)} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2 text-xs">
        <span className="font-medium">Cycle #{cycle?.n}</span>
        <span className="text-muted">
          {fmtHM(cycle?.at)} · {cycle?.package.valid} of {cycle?.package.total} items valid
        </span>
        <Button size="sm" className="ml-auto" icon={<Package size={13} />} onClick={() => setDrawer(true)}>
          See what was handed over
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {calls.length ? (
          <ul className="divide-y divide-line">{calls.map((x) => <Call key={x.id} call={x} />)}</ul>
        ) : (
          <EmptyState title="No agent calls in this cycle" hint="Nothing the autonomous system watches needed a question this time." />
        )}
      </div>
      <PackageDrawer open={drawer} cycle={cycle?.n} onClose={() => setDrawer(false)} />
    </div>
  )
}
