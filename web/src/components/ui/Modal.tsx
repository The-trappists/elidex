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
    <div className={cn('fixed inset-0 z-50 flex items-center justify-center bg-[#05060e]/55 p-4 backdrop-blur-sm', closing ? 'animate-fade-out' : 'animate-fade-in')} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn('flex max-h-[90vh] w-full flex-col rounded-lg border border-line bg-surface shadow-[var(--shadow-lg)]', closing ? 'animate-slide-out' : 'animate-slide-in', wide ? 'max-w-3xl' : 'max-w-lg')}
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
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  width?: string
}) {
  useEscape(open, onClose)
  const { mounted, closing } = usePresence(open)
  if (!mounted) return null
  return (
    <div className={cn('fixed inset-0 z-40 flex justify-end bg-[#05060e]/45 backdrop-blur-[3px]', closing ? 'animate-fade-out' : 'animate-fade-in')} onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        className={cn('flex h-full w-full flex-col border-l border-line bg-surface shadow-[var(--shadow-lg)]', closing ? 'animate-drawer-out' : 'animate-drawer-in', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1 font-semibold">{title}</div>
          <IconButton onClick={onClose} aria-label="Close">
            <X size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </aside>
    </div>
  )
}
