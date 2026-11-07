import { MessagesSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Message } from '../../api/types'
import { fmtTime } from '../../lib/format'
import { SOURCE_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { Avatar, Badge, EmptyState } from '../ui'

const MAX = 300

/** Messages across all threads, oldest to newest, following the end unless the pointer is over the list. */
export function ConversationFeed() {
  const threads = useLive((s) => s.threads)
  const personas = useLive((s) => s.personas)
  const nav = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)

  const rows = useMemo(() => {
    const recent = Object.values(threads)
      .filter((t) => t.messages.length)
      .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
      .slice(0, 120)
    const all: (Message & { subject: string })[] = []
    for (const t of recent) for (const m of t.messages.slice(-3)) all.push({ ...m, subject: t.subject ?? t.id })
    return all.sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.seq - b.seq).slice(-MAX)
  }, [threads])
  const color = useMemo(() => Object.fromEntries(personas.map((p) => [p.name, p.avatar_color])), [personas])

  useEffect(() => {
    const el = ref.current
    if (el && !hover) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [rows, hover])

  if (!rows.length) return <EmptyState icon={<MessagesSquare size={24} />} title="No conversations yet" hint="Chats appear here as the company day starts them." />

  return (
    <div ref={ref} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="h-full overflow-auto" aria-live="off">
      <ul className="divide-y divide-line">
        {rows.map((m) => (
          <li key={`${m.thread_id}-${m.seq}`} className="animate-fade-in">
            <button onClick={() => nav(`/conversations/${encodeURIComponent(m.thread_id)}`)} className="flex w-full gap-2.5 px-3 py-2 text-left hover:bg-surface-2">
              <Avatar name={m.author} color={color[m.author]} size={26} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5 text-xs">
                  <span className="truncate font-medium">{m.author}</span>
                  {m.role && <span className="hidden truncate text-muted xl:inline">{m.role}</span>}
                  <Badge className="ml-auto shrink-0 bg-surface-2 text-muted">{SOURCE_STYLE[m.source].label}</Badge>
                </div>
                <div className="line-clamp-2 text-[13px] leading-snug">{m.text}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="tabular-nums">{fmtTime(m.sent_at).slice(0, 5)}</span>
                  <span className="truncate">{m.subject}</span>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
