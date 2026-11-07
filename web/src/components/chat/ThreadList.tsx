import { Mail, Hash, MessageSquare, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LiveThread, Origin, ThreadSource, ThreadStatus } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtDateTime } from '../../lib/format'
import { ORIGIN_STYLE, SOURCE_STYLE, THREAD_STATUS_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { Badge, Button, EmptyState, Input, Select } from '../ui'
import { NewThreadModal } from './NewThreadModal'

export const SourceIcon = ({ source, size = 14 }: { source: ThreadSource; size?: number }) => {
  const Icon = source === 'email' ? Mail : source === 'slack' ? Hash : MessageSquare
  return (
    <span className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md', SOURCE_STYLE[source].cls)} title={SOURCE_STYLE[source].label}>
      <Icon size={size} />
    </span>
  )
}

export const threadTitle = (t: LiveThread) => t.subject || t.id

export function ThreadList({ selectedId }: { selectedId: string | null }) {
  const threadsMap = useLive((s) => s.threads)
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [source, setSource] = useState<ThreadSource | ''>('')
  const [origin, setOrigin] = useState<Origin | ''>('')
  const [status, setStatus] = useState<ThreadStatus | ''>('')
  const [creating, setCreating] = useState(false)

  const threads = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return Object.values(threadsMap)
      .filter((t) => (!source || t.source === source) && (!origin || t.origin === origin) && (!status || t.status === status))
      .filter((t) => !ql || `${t.subject ?? ''} ${t.id} ${t.messages.map((m) => m.text).join(' ')}`.toLowerCase().includes(ql))
      .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at))
  }, [threadsMap, q, source, origin, status])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <Input className="pl-8" placeholder="Search threads" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Select className="h-8 !px-1.5 text-[13px]" value={source} onChange={(e) => setSource(e.target.value as ThreadSource | '')}>
            <option value="">All sources</option>
            {Object.entries(SOURCE_STYLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select className="h-8 !px-1.5 text-[13px]" value={origin} onChange={(e) => setOrigin(e.target.value as Origin | '')}>
            <option value="">All origins</option>
            {Object.entries(ORIGIN_STYLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select className="h-8 !px-1.5 text-[13px]" value={status} onChange={(e) => setStatus(e.target.value as ThreadStatus | '')}>
            <option value="">All status</option>
            {Object.entries(THREAD_STATUS_STYLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {threads.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={28} />}
            title={Object.keys(threadsMap).length ? 'No thread matches the filters' : 'No conversations yet'}
            hint="Run a scenario from Data, or start a thread by hand."
          />
        ) : (
          threads.map((t) => {
            const last = t.messages[t.messages.length - 1]
            return (
              <button
                key={t.id}
                data-thread-select
                onClick={() => nav(`/conversations/${encodeURIComponent(t.id)}`)}
                className={cn('animate-item-in flex w-full gap-2.5 border-b border-line/60 px-3 py-2.5 text-left transition hover:bg-surface-2', selectedId === t.id && 'bg-accent-soft')}
              >
                <SourceIcon source={t.source} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{threadTitle(t)}</span>
                    <span className="ml-auto shrink-0 text-[13px] text-muted">{t.last_message_at ? fmtDateTime(t.last_message_at).slice(5) : ''}</span>
                  </div>
                  <div className="truncate text-[13px] text-muted">{last ? `${last.author}: ${last.text}` : 'No messages yet'}</div>
                  <div className="mt-1 flex gap-1">
                    <Badge className={THREAD_STATUS_STYLE[t.status].cls}>{THREAD_STATUS_STYLE[t.status].label}</Badge>
                    <Badge className={ORIGIN_STYLE[t.origin].cls}>{ORIGIN_STYLE[t.origin].label}</Badge>
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
      <NewThreadModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
