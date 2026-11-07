// Export menu: a plain download link to GET /api/knowledge/export.
import { Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { Button } from '../ui'

const FORMATS = [
  { id: 'json', label: 'JSON', help: 'Every field, for programs' },
  { id: 'markdown', label: 'Markdown', help: 'A readable document' },
  { id: 'csv', label: 'CSV', help: 'One row per item, for spreadsheets' },
  { id: 'graphml', label: 'GraphML', help: 'The graph, for graph tools' },
  { id: 'jsonld', label: 'JSON-LD', help: 'Linked data with shared vocabulary' },
]

export function ExportMenu() {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const open = pos !== null
  const setOpen = (v: boolean) => {
    if (!v || !ref.current) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 288, window.innerWidth - 296)) }) // fixed, so a scrolling toolbar never clips it
  }
  const [validOnly, setValidOnly] = useState(true)
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
      <Button icon={<Download size={15} />} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} title="Export" aria-label="Export"><span className="hidden 2xl:inline">Export</span></Button>
      {open && (
        <div role="menu" style={pos ?? undefined} className="fixed z-30 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-line bg-surface p-1.5 shadow-[var(--shadow-lg)]">
          <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px]">
            <input type="checkbox" checked={validOnly} onChange={(e) => setValidOnly(e.target.checked)} /> Valid now only
          </label>
          <div className="my-1 border-t border-line" />
          {FORMATS.map((f) => (
            <a key={f.id} role="menuitem" download href={api.knowledgeExportUrl(f.id, validOnly)} onClick={() => setOpen(false)} className="block rounded-md px-2 py-1.5 hover:bg-surface-2">
              <span className="text-sm font-medium">{f.label}</span>
              <span className="block text-xs text-muted">{f.help}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
