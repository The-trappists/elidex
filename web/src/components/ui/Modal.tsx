import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { IconButton } from './Button'

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
}

/** Keeps a panel mounted while its exit animation plays. `closing` is true during that time. */
function usePresence(open: boolean, ms = 180) {
  const [mounted, setMounted] = useState(open)
  const [prev, setPrev] = useState(open)
  if (open !== prev) {
    setPrev(open)
    if (open) setMounted(true)
  }
  useEffect(() => {
    if (open || !mounted) return
    const t = window.setTimeout(() => setMounted(false), ms)
    return () => window.clearTimeout(t)
  }, [open, mounted, ms])
  return { mounted: mounted || open, closing: !open }
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEscape(open, onClose)
  const { mounted, closing } = usePresence(open)
  if (!mounted) return null
  return (
    <div className={cn('fixed inset-0 z-50 flex items-center justify-center bg-text/45 p-0 backdrop-blur-sm md:p-4', closing ? 'animate-fade-out' : 'animate-fade-in')} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn('flex max-h-[100dvh] w-full flex-col border border-line bg-surface md:max-h-[90vh] md:rounded-lg shadow-[var(--shadow-lg)]', closing ? 'animate-slide-out' : 'animate-slide-in', wide ? 'max-w-3xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-line px-5 py-3.5">
          <h3 className="font-semibold">{title}</h3>
          <IconButton className="ml-auto" onClick={onClose} aria-label="Close">
            <X size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/** Right-side panel for details (job, assertion, LLM call...). */
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
  side = 'right',
  flush,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  width?: string
  /** Which edge the panel slides from. */
  side?: 'left' | 'right'
  /** No padding around the content (for a nav list). */
  flush?: boolean
}) {
  useEscape(open, onClose)
  const { mounted, closing } = usePresence(open)
  if (!mounted) return null
  return (
    <div className={cn('fixed inset-0 z-40 flex bg-text/35 backdrop-blur-[3px]', closing ? 'animate-fade-out' : 'animate-fade-in', side === 'left' ? 'justify-start' : 'justify-end')} onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        className={cn('flex h-full w-full min-w-0 max-w-full flex-col border-line bg-surface shadow-[var(--shadow-lg)]', side === 'left' ? 'border-r' : 'border-l', closing ? 'animate-drawer-out' : 'animate-drawer-in', side === 'left' ? 'drawer-left' : 'drawer-panel', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1 font-semibold">{title}</div>
          <IconButton onClick={onClose} aria-label="Close">
            <X size={18} />
          </IconButton>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-auto', flush ? 'p-0' : 'p-4 md:p-5')}>{children}</div>
      </aside>
    </div>
  )
}
