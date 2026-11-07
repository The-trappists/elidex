import type { Message } from '../../api/types'
import { cn } from '../../lib/cn'

/** Source messages, quoted verbatim. */
export function QuotedMessages({ messages, className }: { messages: Message[]; className?: string }) {
  if (!messages.length) return null
  return (
    <div className={cn('space-y-1.5', className)}>
      {messages.map((m) => (
        <blockquote key={m.seq} className="rounded-r-md border-l-2 border-accent bg-surface-2 px-3 py-1.5 text-[13px] leading-snug">
          <span className="mr-1.5 font-mono text-xs text-muted">#{m.seq}</span>
          <b className="font-medium">{m.author}</b>
          <span className="text-muted">: </span>
          <span>{m.text}</span>
        </blockquote>
      ))}
    </div>
  )
}

/** One verbatim phrase, e.g. the evidence quote of a finding. */
export function QuoteLine({ text, className }: { text: string; className?: string }) {
  return (
    <blockquote className={cn('rounded-r-md border-l-2 border-line bg-surface-2 px-3 py-1.5 text-[13px] italic leading-snug text-text', className)}>
      “{text}”
    </blockquote>
  )
}
