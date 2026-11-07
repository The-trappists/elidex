// Patterns: problems that keep coming back, or that hit several elements at once and share something in the
// network. Built from captured human knowledge only; every cause is a hypothesis, never a rule for the agent.
import { ChevronDown, ChevronRight, Download, Lightbulb, Radar, RefreshCw } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Pattern, PatternFix, PatternLevel, PatternReport, PatternStrength } from '../api/types'
import { Badge, Button, Card, EmptyState, IdChip, Tabs, toast } from '../components/ui'
import { cn } from '../lib/cn'
import { fmtDateTime } from '../lib/format'
import { useLive } from '../store/live'

const LEVEL: Record<PatternLevel, { label: string; cls: string; hint: string }> = {
  insight: { label: 'Insight', cls: 'bg-warn/15 text-warn', hint: 'Seen several times, or on 3+ elements: worth a look' },
  watch: { label: 'Watch', cls: 'bg-info/15 text-info', hint: 'Seen once: kept as a possible path' },
  resolved: { label: 'Resolved', cls: 'bg-ok/15 text-ok', hint: 'A lasting fix was stated later' },
}

const STRENGTH: Record<PatternStrength, string> = {
  strong: 'bg-surface-2 text-text',
  medium: 'bg-surface-2 text-muted',
  weak: 'bg-surface-2 text-muted',
}

const FIX: Record<PatternFix['kind'], { label: string; cls: string }> = {
  temporary: { label: 'clears the symptom', cls: 'bg-warn/10 text-warn' },
  lasting: { label: 'lasting', cls: 'bg-ok/10 text-ok' },
  unknown: { label: 'other', cls: 'bg-surface-2 text-muted' },
}

export default function PatternsPage() {
  const assertions = useLive((s) => s.assertions)
  const [report, setReport] = useState<PatternReport | null>(null)
  const rows = report?.patterns ?? null
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<PatternLevel>('insight')

  const load = useCallback(() => {
    setLoading(true)
    api.patterns().then(setReport, (e) => toast.error(e)).finally(() => setLoading(false))
  }, [])

  // Patterns are derived from the knowledge: recompute when it changes.
  useEffect(load, [load, assertions])

  const counts = useMemo(() => {
    const c: Record<PatternLevel, number> = { insight: 0, watch: 0, resolved: 0 }
    for (const p of rows ?? []) c[p.level] += 1
    return c
  }, [rows])
  const shown = (rows ?? []).filter((p) => p.level === tab)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4">
        <Tabs<PatternLevel>
          className="border-b-0"
          value={tab}
          onChange={setTab}
          items={(['insight', 'watch', 'resolved'] as const).map((l) => ({ id: l, label: LEVEL[l].label, count: counts[l] }))}
        />
        <div className="ml-auto flex items-center gap-2 py-2">
          <Button size="sm" icon={<RefreshCw size={13} />} loading={loading} onClick={load}>Refresh</Button>
          <a href={api.patternsReportUrl()} download>
            <Button size="sm" icon={<Download size={13} />}>Report (.md)</Button>
          </a>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg p-4">
        <p className="mb-3 max-w-3xl text-xs leading-relaxed text-muted">
          {LEVEL[tab].hint}. Built only from what people reported in conversations and from field outcomes, plus the
          topology. Causes are hypotheses: nobody stated them, and the agent never uses them as rules.
          {report && <> Same problem under other words: meaning check {report.meaning}.</>}
        </p>
        {rows === null ? null : shown.length === 0 ? (
          <EmptyState
            icon={<Radar size={22} />}
            title={`No ${LEVEL[tab].label.toLowerCase()} patterns`}
            hint="Patterns appear when the same workaround is needed again, or when elements in separate conversations have trouble at the same time and share a neighbour, a site or a firmware."
          />
        ) : (
          <div className="flex max-w-4xl flex-col gap-3">
            {shown.map((p) => <PatternCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function PatternCard({ p }: { p: Pattern }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const element = (id: string) => <IdChip key={id} onClick={() => navigate(`/network?select=${encodeURIComponent(id)}`)}>{id}</IdChip>
  const knowledge = (id: string) => <IdChip key={id} onClick={() => navigate(`/knowledge?assertion=${encodeURIComponent(id)}`)}>{id}</IdChip>

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={LEVEL[p.level].cls}>{LEVEL[p.level].label}</Badge>
        <Badge>{p.kind === 'linked' ? 'Same time, shared neighbour' : 'Keeps coming back'}</Badge>
        <h3 className="text-sm font-semibold">{p.title}</h3>
      </div>
      <div className="mt-1 text-xs text-muted">
        {fmtDateTime(p.first_seen)} → {fmtDateTime(p.last_seen)}
      </div>
      {p.status_note && <div className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-xs">{p.status_note}</div>}

      <Section title="Elements">
        <div className="flex flex-wrap gap-1.5">{p.elements.map(element)}</div>
      </Section>

      {p.grouped.length > 0 && (
        <Section title="Counted as one problem">
          <ul className="flex flex-col gap-0.5 text-xs text-muted">
            {p.grouped.map((g) => <li key={g}>{g}</li>)}
          </ul>
        </Section>
      )}

      {p.factors.length > 0 && (
        <Section title="What they have in common">
          <ul className="flex flex-col gap-1 text-xs">
            {p.factors.map((f) => (
              <li key={`${f.kind}:${f.entity}`} className="flex flex-wrap items-center gap-1.5">
                <Badge className={STRENGTH[f.strength]}>{f.strength}</Badge>
                <span>{f.detail}</span>
                {f.kind === 'dependency' && f.reported === false && (
                  <Badge className="bg-warn/15 text-warn" title="Nobody mentioned this element in these conversations">hidden suspect</Badge>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.hypotheses.length > 0 && (
        <Section title="Hypotheses">
          <ul className="flex flex-col gap-2">
            {p.hypotheses.map((h, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <Lightbulb size={15} className="mt-0.5 shrink-0 text-accent" />
                <div>
                  <div>{h.text}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    <span className="font-medium">{h.strength}</span> · based on: {h.basis.join('; ')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(p.fixes.length > 0 || p.lasting_fixes.length > 0) && (
        <Section title="Fixes">
          <ul className="flex flex-col gap-1 text-xs">
            {p.fixes.map((f) => (
              <li key={`a:${f.assertion_id}:${f.action}`} className="flex flex-wrap items-center gap-1.5">
                <Badge className={FIX[f.kind].cls}>{FIX[f.kind].label}</Badge>
                <span>{f.action}</span>
                <span className="text-muted">applied {f.applied}× · {f.stated_by}</span>
                {knowledge(f.assertion_id)}
              </li>
            ))}
            {p.lasting_fixes.map((f) => (
              <li key={`l:${f.assertion_id}`} className="flex flex-wrap items-center gap-1.5">
                <Badge className={FIX.lasting.cls}>stated lasting fix</Badge>
                <span>{f.action}</span>
                <span className="text-muted">{f.stated_by}, {fmtDateTime(f.at)}</span>
                {knowledge(f.assertion_id)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.people.length > 0 && (
        <Section title="Who to ask">
          <div className="text-xs">{p.people.join(', ')}</div>
        </Section>
      )}

      <button
        className="mt-3 flex items-center gap-1 text-xs font-medium text-muted hover:text-text"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {p.occurrences.length} report{p.occurrences.length === 1 ? '' : 's'}
      </button>
      {open && (
        <table className="mt-2 w-full text-xs">
          <tbody>
            {p.occurrences.map((o, i) => (
              <tr key={i} className={cn('border-t border-line', i === 0 && 'border-t-0')}>
                <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums text-muted">{fmtDateTime(o.at)}</td>
                <td className="py-1.5 pr-3">{element(o.element)}</td>
                <td className="py-1.5 pr-3">
                  {o.topic}
                  <span className="text-muted">
                    {' '}· {o.kind === 'applied' ? 'workaround applied' : 'reported'}
                    {o.worked === true && ', worked'}
                    {o.worked === false && ', did not work'}
                    {o.by && ` · advice from ${o.by}`}
                  </span>
                </td>
                <td className="py-1.5 text-right">{knowledge(o.assertion_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 text-[11px] text-muted">{p.note}</div>
    </Card>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-medium text-muted">{title}</div>
      {children}
    </div>
  )
}
