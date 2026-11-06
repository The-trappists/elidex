import { MessagesSquare } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtTime } from '../../lib/format'
import { SOURCE_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { Avatar, Badge, EmptyState } from '../ui'

/** Last messages across all threads, newest at the bottom, auto-scrolled unless the user scrolled up. */
export function ChatTicker({ limit = 40 }: { limit?: number }) {
  const threads = useLive((s) => s.threads)
  const personas = useLive((s) => s.personas)
  const nav = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const msgs = useMemo(
    () =>
      Object.values(threads)
        .flatMap((t) => t.messages.map((m) => ({ m, t })))
        .sort((a, b) => a.m.sent_at.localeCompare(b.m.sent_at) || a.m.seq - b.m.seq)
        .slice(-limit),
    [threads, limit],
  )
  const last = msgs.length ? `${msgs[msgs.length - 1].t.id}#${msgs[msgs.length - 1].m.seq}` : ''

  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [last])

  if (!msgs.length) return <EmptyState icon={<MessagesSquare size={26} />} title="No messages yet" hint="Messages from running scenarios and Slack show up here as they are posted." />

  return (
    <div
      ref={box}
      className="h-full overflow-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      <ul className="space-y-0.5 p-2">
        {msgs.map(({ m, t }) => {
          const p = personas.find((x) => x.name === m.author)
          return (
            <li
              key={`${t.id}#${m.seq}`}
              onClick={() => nav(`/conversations/${encodeURIComponent(t.id)}`)}
              className="animate-slide-in flex cursor-pointer gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2"
            >
              <Avatar name={m.author} color={p?.avatar_color} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  <b className="truncate text-[12px]">{m.author}</b>
                  {m.role && <span className="truncate text-muted">{m.role}</span>}
                  <span className="ml-auto shrink-0 tabular-nums text-muted">{fmtTime(m.sent_at)}</span>
                </div>
                <p className="line-clamp-3 text-[12.5px] leading-snug">{m.text}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Badge className={SOURCE_STYLE[t.source].cls}>{SOURCE_STYLE[t.source].label}</Badge>
                  <span className="truncate text-[12px] text-muted">{t.subject ?? t.id}</span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
