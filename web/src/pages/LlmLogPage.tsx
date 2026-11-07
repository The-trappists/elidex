import { PageIntro } from '../components/layout/PageIntro'
import { Archive, CheckCircle2, Download, FlaskConical, ScrollText, XCircle } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { LlmCall, LlmSummary } from '../api/types'
import { threadHref } from '../components/knowledge/bits'
import { CheckModal } from '../components/llm/CheckModal'
import { LlmDrawer } from '../components/llm/LlmDrawer'
import { callStatus, isProblem, recentProblems, RECENT_MS, STATUS_LABEL, type CallStatus } from '../components/llm/status'
import { Button, EmptyState, ErrorNote, Input, Modal, Select, Skeleton, Table, toast, type Column } from '../components/ui'
import { cn } from '../lib/cn'
import { describeCall, explainError, fmtTokens, purposeLabel } from '../lib/explain'
import { fmtDateTime, fmtMs, fmtTime } from '../lib/format'
import { useLive } from '../store/live'

/** One table row: the newest call of a group plus how many calls the group holds. */
interface Row {
  call: LlmCall
  count: number
}

type View = 'latest' | 'all'
type Range = '' | 'hour' | 'today'

const STATUS_ICON: Record<CallStatus, typeof CheckCircle2> = { ok: CheckCircle2, api_error: XCircle, parse_error: XCircle }

/** Answer time as text; only slow answers get a color. */
function Speed({ ms }: { ms: number | null }) {
  if (ms == null) return <span className="text-muted">—</span>
  return <span className={cn('text-xs tabular-nums', ms >= 10000 ? 'text-warn' : 'text-muted')}>{fmtMs(ms)}</span>
}

function useColumns(view: View): Column<Row>[] {
  const threads = useLive((s) => s.threads)
  const name = (c: LlmCall) => (c.thread_id ? threads[c.thread_id]?.subject || c.thread_id : undefined)
  const cols: Column<LlmCall>[] = [
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
          <span className={cn('inline-flex items-center gap-1 text-xs font-medium', s.cls)}>
            <Icon size={13} /> {s.label}
          </span>
        )
      },
    },
    { key: 'lat', header: 'Answer time', cell: (c) => <Speed ms={c.latency_ms} /> },
    { key: 'tok', header: 'Text volume', className: 'whitespace-nowrap text-xs text-muted', cell: (c) => fmtTokens(c) },
    {
      key: 'model',
      header: 'Model',
      cell: (c) => (
        <span className="flex flex-col gap-1">
          <span className="font-mono text-xs">{c.model}</span>
          {c.fallback_used && <span className="text-xs text-warn">backup used</span>}
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
  return cols.map((col) => ({
    ...col,
    cell: (r: Row) =>
      col.key === 'what' ? (
        <>
          {col.cell(r.call)}
          {r.count > 1 && (
            <div className="mt-0.5 text-xs text-muted tabular-nums">
              {view === 'latest' ? `${r.count - 1} earlier ${r.count === 2 ? 'request' : 'requests'} hidden` : `Same request ×${r.count}`}
            </div>
          )}
        </>
      ) : (
        col.cell(r.call)
      ),
  }))
}

const dl = (href: string, label: string) => (
  <a href={href} download>
    <Button size="sm" variant="ghost" icon={<Download size={13} />}>{label}</Button>
  </a>
)

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-muted">{label}</span>
    </span>
  )
}

export default function LlmLogPage() {
  const live = useLive((s) => s.llmCalls)
  const [fetched, setFetched] = useState<LlmCall[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [summary, setSummary] = useState<LlmSummary | null>(null)
  const [params, setParams] = useSearchParams()
  const openId = params.get('call')
  const [view, setView] = useState<View>('latest')
  const [purpose, setPurpose] = useState('')
  const [model, setModel] = useState('')
  const [range, setRange] = useState<Range>('')
  const [status, setStatus] = useState<CallStatus | 'problem' | ''>('')
  const [q, setQ] = useState('')
  const [check, setCheck] = useState(false)
  const [confirmClean, setConfirmClean] = useState(false)
  const [cleaning, setCleaning] = useState(false)

  const load = () => {
    setLoadError(null)
    api.llmCalls({ limit: 500 }).then(
      (c) => { setFetched(c); setLoaded(true) },
      (e) => { setLoadError(e instanceof Error ? e.message : String(e)); setLoaded(true) },
    )
    api.llmSummary().then(setSummary, () => {})
  }
  useEffect(load, [])

  const cleanUp = async () => {
    setCleaning(true)
    try {
      const s = await api.llmCompact()
      setSummary(s)
      setConfirmClean(false)
      toast.success(s.last_removed ? `Moved ${s.last_removed} older requests to the archive` : 'Nothing to clean up')
      load()
    } catch (e) {
      toast.error(e)
    }
    setCleaning(false)
  }

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

  const rows = useMemo<Row[]>(() => {
    const since = range === 'hour' ? Date.now() - RECENT_MS : range === 'today' ? new Date().setHours(0, 0, 0, 0) : 0
    const hits = calls.filter(
      (c) =>
        (!purpose || c.purpose === purpose) &&
        (!model || c.model === model) &&
        (!since || new Date(c.ts).getTime() >= since) &&
        (!status || (status === 'problem' ? callStatus(c) !== 'ok' : callStatus(c) === status)) &&
        (!q || (c.thread_id ?? '').toLowerCase().includes(q.toLowerCase())),
    )
    // Latest: one row per kind of request and conversation. Everything: only identical repeats are merged.
    const key = (c: LlmCall) => (view === 'latest' ? `${c.purpose}|${c.thread_id}` : `${c.purpose}|${c.thread_id}|${c.model}|${callStatus(c)}|${c.user}`)
    const groups = new Map<string, Row>()
    for (const c of hits) {
      const g = groups.get(key(c))
      if (g) g.count++
      else groups.set(key(c), { call: c, count: 1 }) // calls are newest first
    }
    // Problems first, then newest first.
    return [...groups.values()].sort((a, b) => Number(isProblem(b.call)) - Number(isProblem(a.call)) || b.call.ts.localeCompare(a.call.ts))
  }, [calls, view, purpose, model, range, status, q])

  const columns = useColumns(view)
  const stats = useMemo(() => {
    const failed = calls.filter(isProblem)
    // Failures that share the headline of the latest one (calls are newest first).
    const headline = (c?: LlmCall) => explainError(c?.error ?? c?.parse_error)?.title
    const same = failed.filter((c) => headline(c) === headline(failed[0]))
    const timed = calls.filter((c) => c.latency_ms != null && !c.error)
    return {
      total: calls.length,
      okPct: calls.length ? Math.round(((calls.length - failed.length) / calls.length) * 100) : 0,
      avg: timed.length ? Math.round(timed.reduce((n, c) => n + (c.latency_ms ?? 0), 0) / timed.length / 100) / 10 : 0,
      failed: failed.length,
      recent: recentProblems(calls).length,
      lastFailure: failed[0],
      sameAsLast: same.length,
      firstSame: same[same.length - 1]?.ts,
    }
  }, [calls])
  const byPurpose = summary?.by_purpose ?? Object.fromEntries(purposes.map((p) => [p, calls.filter((c) => c.purpose === p).length]))
  const filtered = !!(purpose || model || range || status || q)

  const chip = (k: CallStatus | 'problem' | '', label: string, n: number) => (
    <button
      key={k || 'all'}
      onClick={() => setStatus(k)}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
        status === k ? 'bg-surface-3 text-text' : 'text-muted hover:text-text',
      )}
    >
      {label}
      <span className="tabular-nums text-muted">{n}</span>
    </button>
  )
  const seg = (v: View, label: string) => (
    <button
      key={v}
      onClick={() => setView(v)}
      className={cn('rounded px-2.5 py-1 text-xs font-medium transition-colors', view === v ? 'bg-surface-3 text-text' : 'text-muted hover:text-text')}
    >
      {label}
    </button>
  )

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <PageIntro title="Understand what the AI did" description="Follow how conversations were read, what succeeded, and what needs attention." />
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-8 gap-y-1 px-1">
        <Figure value={summary?.total_kept ?? stats.total} label="requests kept" />
        <Figure value={stats.total ? `${stats.okPct}%` : "—"} label="went through" />
        <Figure value={stats.avg ? `${stats.avg} s` : "—"} label="average answer time" />
        <button className="group flex items-baseline gap-2" onClick={() => setStatus('problem')} disabled={!stats.failed}>
          <span className={cn('text-2xl font-semibold tabular-nums', stats.recent > 0 && 'text-bad')}>{summary?.errors_kept ?? stats.failed}</span>
          <span className="text-sm text-muted group-enabled:group-hover:text-text">problems · {stats.recent} in the last hour</span>
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-muted">
        <span className="flex flex-wrap items-center gap-1">
          By kind:
          {Object.entries(byPurpose).map(([p, n]) => (
            <button
              key={p}
              onClick={() => setPurpose(purpose === p ? '' : p)}
              className={cn('rounded border px-2 py-0.5 tabular-nums transition-colors', purpose === p ? 'border-accent text-text' : 'border-line hover:text-text')}
            >
              {purposeLabel(p)} {n}
            </button>
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <Archive size={13} />
          {summary?.last_compacted_at
            ? `Cleaned ${summary.last_removed} older ${summary.last_removed === 1 ? 'request' : 'requests'}, last at ${fmtTime(summary.last_compacted_at).slice(0, 5)}`
            : 'Not cleaned up yet'}
          {summary ? ` · ${summary.archived_total} archived in total` : ''}
        </span>
        <Button size="sm" icon={<Archive size={13} />} onClick={() => setConfirmClean(true)} disabled={!summary}>Clean up now</Button>
      </div>

      {stats.lastFailure && stats.recent > 0 && status === '' && (
        <ErrorNote
          explained={explainError(stats.lastFailure.error ?? stats.lastFailure.parse_error)!}
          raw={stats.lastFailure.error ?? stats.lastFailure.parse_error}
          count={stats.sameAsLast}
          since={stats.firstSame}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex gap-0.5 rounded-md border border-line p-0.5">
            {seg('latest', 'Latest only')}
            {seg('all', 'Show everything kept')}
          </div>
          <div className="flex gap-0.5 rounded-md border border-line p-0.5">
            {chip('', 'All', calls.length)}
            {chip('ok', 'Succeeded', calls.filter((c) => callStatus(c) === 'ok').length)}
            {chip('problem', 'Problems', stats.failed)}
          </div>
          <Select className="w-52" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="">Every kind of request</option>
            {purposes.map((p) => <option key={p} value={p}>{purposeLabel(p)}</option>)}
          </Select>
          <Select className="w-44" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">All models</option>
            {models.map((p) => <option key={p}>{p}</option>)}
          </Select>
          <Select className="w-36" value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Time range">
            <option value="">Any time</option>
            <option value="hour">Last hour</option>
            <option value="today">Today</option>
          </Select>
          <Input className="w-48" placeholder="Search a conversation" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-muted">{rows.length} {rows.length === 1 ? "row" : "rows"} shown</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Export</span>
            <div className="flex gap-1">
              {dl(api.exportLlmCallsUrl, 'Log')}
              {dl(api.exportSessionUrl, 'Session')}
              {dl(api.exportTranscriptUrl(), 'Transcripts')}
            </div>
            <span className="mx-1 h-5 w-px bg-line" />
            <Button size="sm" icon={<FlaskConical size={13} />} onClick={() => setCheck(true)}>Test the AI connection</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.call.id}
            selectedKey={openId}
            onRowClick={(r) => setParams({ call: r.call.id })}
            rowClassName={(r) => isProblem(r.call) && 'bg-bad/5'}
            empty={
              !loaded ? (
                <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : loadError ? (
                <EmptyState icon={<XCircle size={26} />} title="The AI activity could not be loaded" hint={loadError} action={<Button size="sm" onClick={load}>Try again</Button>} />
              ) : (
                <EmptyState
                  icon={<ScrollText size={26} />}
                  title={calls.length ? 'No request matches these filters' : 'No request to the AI yet'}
                  hint="Each time a conversation is read by the language model, a line appears here with what it did, how long it took and whether it worked."
                  action={filtered ? <Button size="sm" onClick={() => { setStatus(''); setPurpose(''); setModel(''); setRange(''); setQ('') }}>Clear filters</Button> : undefined}
                />
              )
            }
          />
        </div>
      </div>
      <LlmDrawer id={openId} call={openId ? calls.find((c) => c.id === openId) : undefined} onClose={() => setParams({})} />
      <CheckModal open={check} onClose={() => setCheck(false)} />
      <Modal
        open={confirmClean}
        onClose={() => setConfirmClean(false)}
        title="Clean up older requests"
        footer={<><Button onClick={() => setConfirmClean(false)}>Cancel</Button><Button variant="primary" loading={cleaning} onClick={cleanUp}>Clean up now</Button></>}
      >
        <p className="text-sm leading-relaxed">
          Only the newest request of each kind, conversation and model stays here, together with recent requests and recent problems.
          Older requests move to the archive file. Nothing is lost, and the Log export still has what is kept.
        </p>
      </Modal>
    </div>
  )
}
