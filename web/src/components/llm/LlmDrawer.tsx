import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { LlmCall } from '../../api/types'
import { fmtDateTime, fmtMs } from '../../lib/format'
import { Badge, Drawer, IdChip } from '../ui'
import { threadHref } from '../knowledge/bits'
import { CopyBlock } from './CopyBlock'
import { callStatus, fmtCost, STATUS_LABEL, tryParse } from './status'

const Meta = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wide text-muted">{k}</div>
    <div className="truncate text-xs">{v}</div>
  </div>
)

export function LlmDrawer({ call, id, onClose }: { call: LlmCall | undefined; id: string | null; onClose: () => void }) {
  const parsed = useMemo(() => (call?.raw_response ? tryParse(call.raw_response) : null), [call])
  const st = call ? STATUS_LABEL[callStatus(call)] : null

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width="max-w-6xl"
      title={
        call ? (
          <div className="flex items-center gap-2">
            <Badge>{call.purpose}</Badge> <span className="truncate font-mono text-sm">{call.model}</span> {st && <Badge className={st.cls}>{st.label}</Badge>}
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
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-2 p-3 sm:grid-cols-4">
            <Meta k="Id" v={<IdChip>{call.id}</IdChip>} />
            <Meta k="Time (wall)" v={fmtDateTime(call.ts)} />
            <Meta k="Time (sim)" v={fmtDateTime(call.sim_time)} />
            <Meta k="Thread" v={call.thread_id ? <Link className="text-accent hover:underline" to={threadHref(call.thread_id)}>{call.thread_id}</Link> : '—'} />
            <Meta k="Provider" v={call.provider} />
            <Meta k="Base URL" v={<span title={call.base_url}>{call.base_url}</span>} />
            <Meta k="JSON mode" v={call.json_mode ?? '—'} />
            <Meta k="Latency" v={fmtMs(call.latency_ms)} />
            <Meta k="Tokens in / out" v={`${call.usage.prompt_tokens ?? '—'} / ${call.usage.completion_tokens ?? '—'}`} />
            <Meta k="Cost" v={fmtCost(call.usage.cost)} />
          </div>
          {call.error && <div className="mb-4 whitespace-pre-wrap rounded-lg border border-bad/40 bg-bad/10 p-3 font-mono text-xs text-bad">{call.error}</div>}
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
                  <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">
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
