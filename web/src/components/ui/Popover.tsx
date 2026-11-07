import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './Button'

/**
 * A "Filters" style button that opens a small panel. Use it to keep a filter bar on one row on narrow screens.
 * `count` shows how many filters are active. The panel is fixed to the viewport, so a scrolling bar never clips it.
 */
export function FilterMenu({ children, count = 0, label = 'Filters', icon, className }: { children: ReactNode; count?: number; label?: string; icon?: ReactNode; className?: string }) {
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const open = pos !== null
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setPos(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  const toggle = () => {
    if (open || !ref.current) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    const width = Math.min(300, window.innerWidth - 16)
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width })
  }
  return (
    <div className={cn('shrink-0', className)} ref={ref}>
      <Button aria-expanded={open} aria-haspopup="true" className="max-md:!h-9" icon={icon ?? <SlidersHorizontal size={14} />} onClick={toggle}>
        {label}
        {count > 0 && <span className="rounded bg-accent px-1.5 text-xs text-on-accent tabular-nums">{count}</span>}
      </Button>
      {pos && (
        <div style={pos} className="fixed z-30 flex max-h-[60vh] flex-col gap-2 overflow-auto rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow-lg)]">
          {children}
        </div>
      )}
    </div>
  )
}
