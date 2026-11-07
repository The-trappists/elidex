import { useEffect, useMemo, useRef } from 'react'
import type { LiveThread, Message, Persona } from '../../api/types'
import { cn } from '../../lib/cn'
import { fmtDateTime } from '../../lib/format'
import { TYPE_STYLE } from '../../lib/semantic'
import { Avatar, EmptyState, IdChip } from '../ui'
import { MessageSquare } from 'lucide-react'
import type { Citation } from './citations'
import { Link } from 'react-router-dom'
import { assertionHref } from '../knowledge/bits'

const GROUP_GAP_MS = 5 * 60 * 1000

function group(messages: Message[]): Message[][] {
  const out: Message[][] = []
  for (const m of messages) {
    const g = out[out.length - 1]
    const prev = g?.[g.length - 1]
    if (prev && prev.author === m.author && new Date(m.sent_at).getTime() - new Date(prev.sent_at).getTime() < GROUP_GAP_MS) g.push(m)
    else out.push([m])
  }
  return out
}

export function MessageList({
  thread,
  personas,
  citations,
  hoverItem,
  onHoverItem,
}: {
  thread: LiveThread
  personas: Persona[]
  citations: Map<number, Citation>
  hoverItem: number | null
  onHoverItem: (i: number | null) => void
}) {
  const groups = useMemo(() => group(thread.messages), [thread.messages])
  const color = useMemo(() => Object.fromEntries(personas.map((p) => [p.name, p])), [personas])
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [thread.id, thread.messages.length])

  if (!thread.messages.length)
    return <EmptyState icon={<MessageSquare size={28} />} title="No messages yet" hint="Write the first message below. The pipeline reads the thread once it goes quiet." />

  return (
    <div className="h-full overflow-auto px-4 py-3">
      {groups.map((g) => {
        const p = color[g[0].author]
        const role = g[0].role ?? p?.role
        return (
          <div key={g[0].seq} className="mb-3 flex gap-3">
            <Avatar name={g[0].author} color={p?.avatar_color} size={34} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{g[0].author}</span>
                {role && <span className="text-[13px] text-muted">{role}</span>}
                <span className="text-[13px] text-muted">{fmtDateTime(g[0].sent_at)}</span>
              </div>
              {g.map((m) => {
                const c = citations.get(m.seq)
                return (
                  <div
                    key={m.seq}
                    onMouseEnter={c ? () => onHoverItem(c.itemIndex) : undefined}
                    onMouseLeave={c ? () => onHoverItem(null) : undefined}
                    className={cn('animate-item-in group relative mt-0.5 rounded-md border-l-[3px] py-0.5 pl-2 pr-2 transition', c ? 'hover:bg-surface-2' : 'border-transparent', c && hoverItem === c.itemIndex && 'bg-surface-2')}
                    style={c ? { borderLeftColor: TYPE_STYLE[c.type].hex } : undefined}
                  >
                    <div className="whitespace-pre-wrap break-words text-sm">{m.text}</div>
                    {c && (
                      <div className="mt-1 flex items-center gap-1.5 text-[13px]">
                        <span style={{ color: TYPE_STYLE[c.type].hex }}>→ {c.topic}</span>
                        {c.assertionId && (
                          <Link to={assertionHref(c.assertionId)}>
                            <IdChip className="hover:border-accent max-md:py-2">{c.assertionId}</IdChip>
                          </Link>
                        )}
                      </div>
                    )}
                    <span className="absolute right-2 top-1 hidden text-[13px] text-muted group-hover:block">#{m.seq}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
