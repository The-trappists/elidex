import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** A titled block of monospace text with a copy button; optionally collapsible. */
export function CopyBlock({ title, text, collapsible, extra, tone }: { title: string; text: string; collapsible?: boolean; extra?: ReactNode; tone?: string }) {
  const [open, setOpen] = useState(!collapsible)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center gap-2">
        {collapsible ? (
          <button className="flex min-h-6 items-center gap-1 text-xs font-semibold text-muted hover:text-text" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {title}
          </button>
        ) : (
          <span className="text-xs font-semibold text-muted">{title}</span>
        )}
        <span className="text-xs text-muted">{text.length.toLocaleString()} chars</span>
        {extra}
        <button className="ml-auto flex min-h-6 items-center gap-1 px-1 text-xs text-muted hover:text-text" onClick={copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {open && <pre className={cn('max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed', tone)}>{text}</pre>}
    </div>
  )
}
