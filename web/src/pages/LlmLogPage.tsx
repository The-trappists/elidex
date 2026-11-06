import { Download, FlaskConical, ScrollText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { LlmCall } from '../api/types'
import { threadHref } from '../components/knowledge/bits'
import { CheckModal } from '../components/llm/CheckModal'
import { LlmDrawer } from '../components/llm/LlmDrawer'
import { callStatus, fmtCost, STATUS_LABEL, type CallStatus } from '../components/llm/status'
import { Badge, Button, EmptyState, Input, Select, Table, toast, type Column } from '../components/ui'
import { fmtDateTime, fmtMs } from '../lib/format'
import { useLive } from '../store/live'

const columns: Column<LlmCall>[] = [
  { key: 'time', header: 'Time', className: 'whitespace-nowrap text-xs', cell: (c) => (<><div>{fmtDateTime(c.ts)}</div><div className="text-[11.5px] text-muted">sim {fmtDateTime(c.sim_time)}</div></>) },
  { key: 'purpose', header: 'Purpose', cell: (c) => <Badge>{c.purpose}</Badge> },
  { key: 'model', header: 'Model', className: 'font-mono text-xs', cell: (c) => (<span className="flex items-center gap-1.5">{c.model}{c.fallback_used && <Badge className="bg-warn/15 text-warn">fallback</Badge>}</span>) },
  { key: 'lat', header: 'Latency', className: 'whitespace-nowrap text-xs', cell: (c) => fmtMs(c.latency_ms) },
  { key: 'tok', header: 'Tokens in/out', className: 'whitespace-nowrap text-xs', cell: (c) => `${c.usage.prompt_tokens ?? '—'} / ${c.usage.completion_tokens ?? '—'}` },
  { key: 'cost', header: 'Cost', className: 'text-xs', cell: (c) => fmtCost(c.usage.cost) },
  { key: 'status', header: 'Status', cell: (c) => { const s = STATUS_LABEL[callStatus(c)]; return (<><Badge className={s.cls}>{s.label}</Badge>{c.error && <div className="mt-1 max-w-64 truncate text-xs text-bad" title={c.error}>{c.error}</div>}</>) } },
  { key: 'thread', header: 'Thread', className: 'max-w-48 truncate text-xs', cell: (c) => c.thread_id ? <Link className="text-accent hover:underline" to={threadHref(c.thread_id)} onClick={(e) => e.stopPropagation()}>{c.thread_id}</Link> : <span className="text-muted">—</span> },
]

const dl = (href: string, label: string) => (
  <a href={href} download>
    <Button size="sm" icon={<Download size={13} />}>{label}</Button>
  </a>
)

export default function LlmLogPage() {
  const live = useLive((s) => s.llmCalls)
  const [fetched, setFetched] = useState<LlmCall[]>([])
  const [params, setParams] = useSearchParams()
  const openId = params.get('call')
  const [purpose, setPurpose] = useState('')
  const [model, setModel] = useState('')
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState<CallStatus | ''>('')
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
      (!provider || (provider === 'fallback') === c.fallback_used) &&
      (!status || callStatus(c) === status) &&
      (!q || (c.thread_id ?? '').toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <Select className="w-36" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          <option value="">All purposes</option>
          {purposes.map((p) => <option key={p}>{p}</option>)}
        </Select>
        <Select className="w-48" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">All models</option>
          {models.map((p) => <option key={p}>{p}</option>)}
        </Select>
        <Select className="w-36" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">Any provider</option>
          <option value="primary">Primary</option>
          <option value="fallback">Fallback</option>
        </Select>
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value as CallStatus | '')}>
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Input className="w-48" placeholder="Search by thread" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-muted">{rows.length} of {calls.length}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {dl(api.exportLlmCallsUrl, 'Export JSONL')}
          {dl(api.exportSessionUrl, 'Export session')}
          {dl(api.exportTranscriptUrl(), 'Export all transcripts')}
          <Button size="sm" variant="primary" icon={<FlaskConical size={13} />} onClick={() => setCheck(true)}>Run LLM check</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        <Table
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          selectedKey={openId}
          onRowClick={(c) => setParams({ call: c.id })}
          rowClassName={(c) => !!c.error && 'bg-bad/10 shadow-[inset_3px_0_0_var(--bad)]'}
          empty={<EmptyState icon={<ScrollText size={28} />} title={calls.length ? 'No call matches the filters' : 'No LLM calls yet'} hint="Every prompt and response sent to a model is recorded here once a thread is processed with the LLM extractor." />}
        />
      </div>
      <LlmDrawer id={openId} call={openId ? calls.find((c) => c.id === openId) : undefined} onClose={() => setParams({})} />
      <CheckModal open={check} onClose={() => setCheck(false)} />
    </div>
  )
}
