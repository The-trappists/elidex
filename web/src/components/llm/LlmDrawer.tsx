import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { LlmCall } from '../../api/types'
import { fmtDateTime, fmtMs } from '../../lib/format'
import { Badge, Drawer, ErrorNote, IdChip } from '../ui'
import { describeCall, explainError, fmtTokens, purposeLabel } from '../../lib/explain'
import { useLive } from '../../store/live'
import { threadHref } from '../knowledge/bits'
import { CopyBlock } from './CopyBlock'
import { callStatus, fmtCost, STATUS_LABEL, tryParse } from './status'

const Meta = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="min-w-0">
    <div className="text-xs text-muted">{k}</div>
    <div className="truncate text-xs">{v}</div>
  </div>
)

export function LlmDrawer({ call, id, onClose }: { call: LlmCall | undefined; id: string | null; onClose: () => void }) {
  const parsed = useMemo(() => (call?.raw_response ? tryParse(call.raw_response) : null), [call])
  const st = call ? STATUS_LABEL[callStatus(call)] : null
  const threadName = useLive((s) => (call?.thread_id ? s.threads[call.thread_id]?.subject : undefined))

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width="max-w-6xl"
      title={
        call ? (
          <div className="flex items-center gap-2">
            <span className="truncate">{purposeLabel(call.purpose)}</span> {st && <Badge className={st.cls}>{st.label}</Badge>}
            {call.fallback_used && <Badge className="bg-warn/15 text-warn">fallback</Badge>}
          </div>
        ) : (
          'LLM call'
        )
      }
    >
      {!call ? (
        <div className="text-sm text-muted">Call "{id}" not found.</div>
      ) : (
        <>
          <p className="mb-4 text-[15px] font-medium leading-snug">{describeCall(call, threadName ?? undefined)}</p>
          {(call.error || call.parse_error) && <ErrorNote className="mb-4" explained={explainError(call.error ?? call.parse_error)!} raw={call.error ?? call.parse_error} />}
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-2 p-3 sm:grid-cols-4">
            <Meta k="Answer time" v={fmtMs(call.latency_ms)} />
            <Meta k="Text volume" v={fmtTokens(call)} />
            <Meta k="Model" v={call.model} />
            <Meta k="Conversation" v={call.thread_id ? <Link className="text-accent hover:underline" to={threadHref(call.thread_id)}>{threadName ?? call.thread_id}</Link> : '—'} />
          </div>
          <details className="mb-4 rounded-md border border-line px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-muted hover:text-text">Technical details</summary>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Meta k="Id" v={<IdChip>{call.id}</IdChip>} />
            <Meta k="Time (wall)" v={fmtDateTime(call.ts)} />
            <Meta k="Time (sim)" v={fmtDateTime(call.sim_time)} />
            <Meta k="Thread" v={call.thread_id ? <Link className="text-accent hover:underline" to={threadHref(call.thread_id)}>{call.thread_id}</Link> : '—'} />
            <Meta k="Provider" v={call.provider} />
            <Meta k="Base URL" v={<span title={call.base_url}>{call.base_url}</span>} />
            <Meta k="JSON mode" v={call.json_mode ?? '—'} />
            <Meta k="Cost" v={fmtCost(call.usage.cost)} />
            </div>
          </details>
          <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-2">
            <div className="min-w-0">
              <CopyBlock title="System prompt" text={call.system} collapsible />
              <CopyBlock title="User prompt" text={call.user} />
            </div>
            <div className="min-w-0">
              {call.raw_response != null ? <CopyBlock title="Raw response" text={call.raw_response} /> : <div className="mb-3 text-xs text-muted">No response received.</div>}
              {parsed &&
                (parsed.ok ? (
                  <CopyBlock title="Parsed JSON" text={JSON.stringify(parsed.value, null, 2)} />
                ) : (
                  <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-xs">
                    <b className="text-warn">Not valid JSON:</b> <span className="font-mono">{parsed.error}</span>
                    {call.parse_error && <div className="mt-1 text-muted">Backend: {call.parse_error}</div>}
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </Drawer>
  )
}
