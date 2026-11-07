import { CheckCircle2, Download, FlaskConical, Gauge, ScrollText, Send, XCircle } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { LlmCall } from '../api/types'
import { threadHref } from '../components/knowledge/bits'
import { CheckModal } from '../components/llm/CheckModal'
import { LlmDrawer } from '../components/llm/LlmDrawer'
import { callStatus, STATUS_LABEL, type CallStatus } from '../components/llm/status'
import { Badge, Button, EmptyState, ErrorNote, Input, Select, Stat, Table, toast, type Column } from '../components/ui'
import { cn } from '../lib/cn'
import { describeCall, explainError, fmtTokens, purposeLabel } from '../lib/explain'
import { fmtDateTime, fmtMs } from '../lib/format'
import { useLive } from '../store/live'

const STATUS_ICON: Record<CallStatus, typeof CheckCircle2> = { ok: CheckCircle2, api_error: XCircle, parse_error: XCircle }

/** A thin bar that shows how slow a call was compared with the slowest one on screen (log scale). */
function SpeedBar({ ms, max }: { ms: number | null; max: number }) {
  if (ms == null) return <span className="text-muted">—</span>
  // Log scale so one very slow call does not flatten every other bar.
  const pct = Math.max(6, Math.round((Math.log10(ms + 1) / Math.log10(Math.max(max, 10) + 1)) * 100))
  const tone = ms < 3000 ? 'bg-ok' : ms < 10000 ? 'bg-warn' : 'bg-bad'
  return (
    <div className="w-28">
      <div className="text-xs font-medium tabular-nums">{fmtMs(ms)}</div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full transition-all duration-700', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function useColumns(maxLatency: number): Column<LlmCall>[] {
  const threads = useLive((s) => s.threads)
  const name = (c: LlmCall) => (c.thread_id ? threads[c.thread_id]?.subject || c.thread_id : undefined)
  return [
    {
      key: 'time',
      header: 'When (real time)',
      className: 'whitespace-nowrap',
      cell: (c) => (
        <>
          <div className="text-[13px] font-medium">{formatDistanceToNowStrict(new Date(c.ts), { addSuffix: true })}</div>
          <div className="text-xs text-muted" title={c.sim_time ? `Simulated time: ${fmtDateTime(c.sim_time)}` : undefined}>{fmtDateTime(c.ts)}{c.sim_time && <span className="ml-1 opacity-70">· sim {fmtDateTime(c.sim_time).slice(5)}</span>}</div>
        </>
      ),
    },
    {
      key: 'what',
      header: 'What happened',
      className: 'max-w-[26rem]',
      cell: (c) => {
        const ex = explainError(c.error ?? c.parse_error)
        return (
          <>
            <div className="text-[13px] font-medium leading-snug">{describeCall(c, name(c))}</div>
            {ex ? <div className="mt-0.5 text-xs text-bad">{ex.title}</div> : <div className="mt-0.5 text-xs text-muted">{purposeLabel(c.purpose)}</div>}
          </>
        )
      },
    },
    {
      key: 'status',
      header: 'Result',
      cell: (c) => {
        const k = callStatus(c)
        const s = STATUS_LABEL[k]
        const Icon = STATUS_ICON[k]
        return (
          <Badge className={s.cls}>
            <Icon size={12} /> {s.label}
          </Badge>
        )
      },
    },
    { key: 'lat', header: 'Speed', cell: (c) => <SpeedBar ms={c.latency_ms} max={maxLatency} /> },
    { key: 'tok', header: 'Text volume', className: 'whitespace-nowrap text-xs text-muted', cell: (c) => fmtTokens(c) },
    {
      key: 'model',
      header: 'Model',
      cell: (c) => (
        <span className="flex flex-col gap-1">
          <span className="font-mono text-xs">{c.model}</span>
          {c.fallback_used && <Badge className="w-fit bg-warn/15 text-warn">backup used</Badge>}
        </span>
      ),
    },
    {
      key: 'thread',
      header: 'Conversation',
      className: 'max-w-48 truncate text-xs',
      cell: (c) =>
        c.thread_id ? (
          <Link className="text-accent hover:underline" to={threadHref(c.thread_id)} onClick={(e) => e.stopPropagation()}>
            {name(c)}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ]
}

const dl = (href: string, label: string) => (
  <a href={href} download>
    <Button size="sm" variant="ghost" icon={<Download size={13} />}>{label}</Button>
  </a>
)

export default function LlmLogPage() {
  const live = useLive((s) => s.llmCalls)
  const [fetched, setFetched] = useState<LlmCall[]>([])
  const [params, setParams] = useSearchParams()
  const openId = params.get('call')
  const [purpose, setPurpose] = useState('')
  const [model, setModel] = useState('')
  const [status, setStatus] = useState<CallStatus | 'problem' | ''>('')
  const [q, setQ] = useState('')
  const [check, setCheck] = useState(false)

  useEffect(() => {
    api.llmCalls({ limit: 500 }).then(setFetched, (e) => toast.error(e))
  }, [])

  useEffect(() => {
    if (openId && !fetched.some((c) => c.id === openId) && !live.some((c) => c.id === openId))
      api.llmCall(openId).then((c) => setFetched((f) => [...f, c]), () => {})
  }, [openId, fetched, live])

  const calls = useMemo(() => {
    const m = new Map<string, LlmCall>()
    for (const c of fetched) m.set(c.id, c)
    for (const c of live) m.set(c.id, c)
    return [...m.values()].sort((a, b) => b.ts.localeCompare(a.ts))
  }, [fetched, live])

  const purposes = useMemo(() => [...new Set(calls.map((c) => c.purpose))], [calls])
  const models = useMemo(() => [...new Set(calls.map((c) => c.model))], [calls])
  const rows = calls.filter(
    (c) =>
      (!purpose || c.purpose === purpose) &&
      (!model || c.model === model) &&
      (!status || (status === 'problem' ? callStatus(c) !== 'ok' : callStatus(c) === status)) &&
      (!q || (c.thread_id ?? '').toLowerCase().includes(q.toLowerCase())),
  )

  const maxLatency = useMemo(() => Math.max(0, ...rows.map((c) => c.latency_ms ?? 0)), [rows])
  const columns = useColumns(maxLatency)
  const stats = useMemo(() => {
    const failed = calls.filter((c) => callStatus(c) !== 'ok')
    // Failures that share the headline of the latest one (calls are newest first).
    const headline = (c?: LlmCall) => explainError(c?.error ?? c?.parse_error)?.title
    const same = failed.filter((c) => headline(c) === headline(failed[0]))
    const timed = calls.filter((c) => c.latency_ms != null && !c.error)
    return {
      total: calls.length,
      okPct: calls.length ? Math.round(((calls.length - failed.length) / calls.length) * 100) : 0,
      avg: timed.length ? Math.round(timed.reduce((n, c) => n + (c.latency_ms ?? 0), 0) / timed.length / 100) / 10 : 0,
      failed: failed.length,
      lastFailure: failed[0],
      sameAsLast: same.length,
      firstSame: same[same.length - 1]?.ts,
    }
  }, [calls])

  const chip = (k: CallStatus | 'problem' | '', label: string, n: number) => (
    <button
      key={k || 'all'}
      onClick={() => setStatus(k)}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all',
        status === k ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:border-accent/40 hover:text-text',
      )}
    >
      {label}
      <span className="rounded-full bg-surface-3 px-1.5 text-xs tabular-nums">{n}</span>
    </button>
  )

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex shrink-0 gap-3">
        <Stat icon={<Send size={18} />} label="Requests to the AI" value={stats.total} hint="since the server started" tone="accent" />
        <Stat icon={<CheckCircle2 size={18} />} label="Went through" value={stats.okPct} suffix="%" hint={stats.failed ? `${stats.failed} did not` : 'no failure'} tone={stats.okPct >= 90 ? 'ok' : stats.okPct >= 60 ? 'warn' : 'bad'} />
        <Stat icon={<Gauge size={18} />} label="Average answer time" value={stats.avg} suffix="s" hint="successful requests only" />
        <Stat icon={<XCircle size={18} />} label="Problems" value={stats.failed} hint={stats.failed ? 'click to see them' : 'all good'} tone={stats.failed ? 'bad' : 'ok'} onClick={stats.failed ? () => setStatus('problem') : undefined} />
      </div>

      {stats.lastFailure && status === '' && (
        <ErrorNote
          explained={explainError(stats.lastFailure.error ?? stats.lastFailure.parse_error)!}
          raw={stats.lastFailure.error ?? stats.lastFailure.parse_error}
          count={stats.sameAsLast}
          since={stats.firstSame}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex gap-1.5">
            {chip('', 'All', calls.length)}
            {chip('ok', 'Succeeded', calls.filter((c) => callStatus(c) === 'ok').length)}
            {chip('problem', 'Problems', stats.failed)}
          </div>
          <Select className="ml-2 w-52" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="">Every kind of request</option>
            {purposes.map((p) => <option key={p} value={p}>{purposeLabel(p)}</option>)}
          </Select>
          <Select className="w-44" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">All models</option>
            {models.map((p) => <option key={p}>{p}</option>)}
          </Select>
          <Input className="w-48" placeholder="Search a conversation" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-muted">{rows.length} shown</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Export</span>
            <div className="flex gap-1">
              {dl(api.exportLlmCallsUrl, 'Log')}
              {dl(api.exportSessionUrl, 'Session')}
              {dl(api.exportTranscriptUrl(), 'Transcripts')}
            </div>
            <span className="mx-1 h-5 w-px bg-line" />
            <Button size="sm" variant="primary" icon={<FlaskConical size={13} />} onClick={() => setCheck(true)}>Test the AI connection</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <Table
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            selectedKey={openId}
            onRowClick={(c) => setParams({ call: c.id })}
            rowClassName={(c) => !!(c.error ?? c.parse_error) && 'bg-bad/10 shadow-[inset_3px_0_0_var(--bad)]'}
            empty={<EmptyState icon={<ScrollText size={26} />} title={calls.length ? 'No request matches these filters' : 'No request to the AI yet'} hint="Each time a conversation is read by the language model, a line appears here with what it did, how long it took and whether it worked." action={calls.length ? <Button size="sm" onClick={() => { setStatus(''); setPurpose(''); setModel(''); setQ('') }}>Clear filters</Button> : undefined} />}
          />
        </div>
      </div>
      <LlmDrawer id={openId} call={openId ? calls.find((c) => c.id === openId) : undefined} onClose={() => setParams({})} />
      <CheckModal open={check} onClose={() => setCheck(false)} />
    </div>
  )
}
