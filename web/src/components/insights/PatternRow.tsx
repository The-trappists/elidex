// One insight in the list: a summary line, and when chosen, its hypotheses with the evidence behind them.
import { ExternalLink, Lightbulb, MessageSquare, Network, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { LiveThread, Pattern, PatternOccurrence } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtDate } from '../../lib/format'
import { buildPatternsExport, LEVEL_CLS, LEVEL_HELP, LEVEL_LABEL, seenText, STRENGTH_LABEL } from './meta'
import { ExportListMenu } from '../review/ExportListMenu'
import { assertionHref, CopyId, threadHref } from '../knowledge/bits'
import { Badge, Button, IdChip } from '../ui'

const networkHref = (id: string) => `/network?select=${encodeURIComponent(id)}`
const graphHref = (id: string) => `/graph?focus=${encodeURIComponent(id)}`
const SHOWN_REPORTS = 3

export function PatternRow({ p, active, isNew, onSelect, threads, publicDemo }: { p: Pattern; active: boolean; isNew: boolean; onSelect: () => void; threads: Record<string, LiveThread>; publicDemo?: boolean }) {
  return (
    <div className={cn('my-1 rounded-md', active && 'bg-accent-soft/40 ring-1 ring-accent/40', p.level === 'resolved' && !active && 'opacity-70')}>
      <button onClick={onSelect} aria-expanded={active} className="w-full rounded-md px-2 py-3 text-left hover:bg-surface-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', LEVEL_CLS[p.level])}>{LEVEL_LABEL[p.level]}</span>
          <span className="text-[11px] text-muted">{seenText(p)}</span>
          {isNew && <Badge className="bg-accent-soft text-accent">New</Badge>}
          <span className="ml-auto shrink-0 text-[11px] text-muted">{fmtDate(p.last_seen)}</span>
        </span>
        <span className="mt-1 block truncate font-mono text-xs text-muted">{p.elements.join(' · ')}</span>
        <span className="mt-0.5 block break-words text-sm leading-relaxed">{p.headline}</span>
      </button>
      {active && <Details p={p} threads={threads} publicDemo={publicDemo} />}
    </div>
  )
}

function Report({ o, threads, publicDemo }: { o: PatternOccurrence; threads: Record<string, LiveThread>; publicDemo?: boolean }) {
  return (
    <li className="rounded-md border border-line bg-surface p-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tabular-nums text-muted">{fmtDate(o.at)}</span>
        <Link to={networkHref(o.element)} title="Show on the Network page"><IdChip className="hover:border-accent">{o.element}</IdChip></Link>
        {o.kind === 'applied' && <Badge>Agent applied it</Badge>}
        {o.by && <span className="text-muted">{o.by}</span>}
      </div>
      <p className="mt-1 break-words">{o.action ?? o.topic}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {!publicDemo && <CopyId id={o.assertion_id} />}
        <Link className="inline-flex min-h-6 items-center gap-1 text-accent hover:underline" to={assertionHref(o.assertion_id)}><ExternalLink size={11} />Knowledge</Link>
        <Link className="inline-flex min-h-6 items-center gap-1 text-accent hover:underline" to={graphHref(o.assertion_id)}><Waypoints size={11} />Graph</Link>
        {o.sources.slice(0, 2).map((s) => (
          <Link key={s} className="inline-flex min-h-6 max-w-full items-center gap-1 text-accent hover:underline" to={threadHref(s)} title={s}>
            <MessageSquare size={11} /><span className="truncate">{threads[s]?.subject ?? 'Conversation'}</span>
          </Link>
        ))}
      </div>
    </li>
  )
}

function Details({ p, threads, publicDemo }: { p: Pattern; threads: Record<string, LiveThread>; publicDemo?: boolean }) {
  const [all, setAll] = useState(false)
  const reports = all ? p.occurrences : p.occurrences.slice(0, SHOWN_REPORTS)
  const first = p.occurrences[0]
  return (
    <div className="flex flex-col gap-3 border-t border-line px-2 pb-3 pt-2.5 text-xs">
      <p className="text-muted"><b className="font-semibold text-text">{LEVEL_LABEL[p.level]}.</b> {LEVEL_HELP[p.level]} Every cause below is a hypothesis to check, never a rule.</p>

      {p.hypotheses.slice(0, 3).map((h, i) => (
        <div key={i} className="rounded-md border border-line bg-surface p-2.5">
          <div className="flex gap-1.5">
            <Lightbulb size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <span className="min-w-0 break-words text-[13px]">{h.text}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
            <Badge title="How much of the evidence points this way">{STRENGTH_LABEL[h.strength]}</Badge>
          </div>
          {h.basis.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-9 text-muted">
              {h.basis.map((b, j) => <li key={j} className="break-words">{b}</li>)}
            </ul>
          )}
        </div>
      ))}

      <div>
        <h4 className="mb-1.5 font-medium text-muted">{p.occurrences.length} supporting report{p.occurrences.length === 1 ? '' : 's'}</h4>
        <ul className="space-y-1.5">{reports.map((o, i) => <Report key={`${o.assertion_id}-${i}`} o={o} threads={threads} publicDemo={publicDemo} />)}</ul>
        {p.occurrences.length > SHOWN_REPORTS && (
          <button className="mt-1.5 font-medium text-muted hover:text-text" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${p.occurrences.length}`}</button>
        )}
      </div>

      {p.fixes.length > 0 && (
        <div>
          <h4 className="mb-1 font-medium text-muted">Done so far</h4>
          <ul className="space-y-1">
            {p.fixes.map((f) => (
              <li key={f.assertion_id} className="break-words">
                {f.action.replace(/\.$/, '')} ({f.applied}×) <Link className="font-mono text-accent hover:underline" to={assertionHref(f.assertion_id)}>{f.assertion_id}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.people.length > 0 && <div><span className="font-medium text-muted">Who to ask: </span>{p.people.join(', ')}</div>}
      {p.grouped.length > 0 && <div className="text-muted">Counted as one problem: {p.grouped.join('; ')}</div>}

      <div className="flex flex-wrap items-center gap-1.5">
        {[...p.elements, ...p.suspects].map((id) => (
          <Link key={id} to={networkHref(id)} title="Show on the Network page"><IdChip className="hover:border-accent">{id}</IdChip></Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {first && <Link to={graphHref(first.assertion_id)}><Button size="sm" icon={<Waypoints size={13} />}>Show in graph</Button></Link>}
        <Link to={networkHref(p.suspects[0] ?? p.elements[0])}><Button size="sm" icon={<Network size={13} />}>Show on network</Button></Link>
        {!publicDemo && <ExportListMenu label="Export evidence" filename={p.id} build={(f) => buildPatternsExport([p], threads, f)} />}
        {!publicDemo && <CopyId id={p.id} />}
      </div>
      <div className="text-[11px] text-muted">{p.note}</div>
    </div>
  )
}
