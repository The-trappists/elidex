// Small download menu: the caller builds the text for each format from data that is already loaded.
import { Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { downloadText, EXPORT_FORMATS, type ExportFormat } from '../../lib/download'
import { Button } from '../ui'

export function ExportListMenu({ label = 'Export', disabled, filename, build }: { label?: string; disabled?: boolean; filename: string; build: (f: ExportFormat) => string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <Button size="sm" icon={<Download size={14} />} disabled={disabled} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>{label}</Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-1.5 shadow-[var(--shadow-lg)]">
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f.id}
              role="menuitem"
              className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
              onClick={() => { downloadText(`${filename}.${f.ext}`, f.mime, build(f.id)); setOpen(false) }}
            >
              <span className="text-sm font-medium">{f.label}</span>
              <span className="block text-xs text-muted">{f.help}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
