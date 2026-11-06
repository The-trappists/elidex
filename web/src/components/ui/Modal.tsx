import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
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
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={cn('flex max-h-[90vh] w-full flex-col rounded-xl border border-line bg-surface shadow-2xl animate-slide-in', wide ? 'max-w-3xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-line px-5 py-3.5">
          <h3 className="font-semibold">{title}</h3>
          <button className="ml-auto text-muted hover:text-text" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
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
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25" onMouseDown={onClose}>
      <aside
        className={cn('flex h-full w-full flex-col border-l border-line bg-surface shadow-2xl animate-slide-in', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1 font-semibold">{title}</div>
          <button className="text-muted hover:text-text" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </aside>
    </div>
  )
}
