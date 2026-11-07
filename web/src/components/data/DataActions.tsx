import { Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../../api/client'
import { REMOVABLE_ORIGINS } from '../../api/types'
import { cn } from '../../lib/cn'
import { useLive } from '../../store/live'
import { Button, Modal, toast, withToast } from '../ui'

function countGenerated() {
  const s = useLive.getState()
  const c = (xs: { origin: string }[]) => xs.filter((x) => REMOVABLE_ORIGINS.includes(x.origin as never)).length
  return { threads: c(Object.values(s.threads)), incidents: c(Object.values(s.incidents)), scenarios: c(s.scenarios) }
}

export function DataActions() {
  const [modal, setModal] = useState<'remove' | 'reset' | 'import' | null>(null)
  const [mode, setMode] = useState<'seed' | 'empty'>('seed')
  const [file, setFile] = useState<{ name: string; data: unknown } | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const close = () => setModal(null)

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true)
    const ok = await withToast(async () => { await fn(); return true }, msg)
    setBusy(false)
    if (ok) close()
  }

  const remove = async () => {
    setBusy(true)
    const r = await withToast(() => api.deleteGenerated())
    setBusy(false)
    if (r) {
      const parts = Object.entries(r.removed).map(([k, n]) => `${n} ${k}`)
      toast.success(parts.length ? `Removed ${parts.join(', ')}` : 'Nothing to remove')
      close()
    }
  }

  const pick = async (f: File | undefined) => {
    if (!f) return
    try {
      setFile({ name: f.name, data: JSON.parse(await f.text()) })
      setModal('import')
    } catch {
      toast.error('That file is not valid JSON.')
    }
    if (input.current) input.current.value = ''
  }

  const gen = modal === 'remove' ? countGenerated() : null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" icon={<Trash2 size={13} />} onClick={() => setModal('remove')}>Remove generated data</Button>
      <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => setModal('reset')}>Reset</Button>
      <a href={api.exportUrl} download><Button size="sm" icon={<Download size={13} />}>Export</Button></a>
      <Button size="sm" icon={<Upload size={13} />} onClick={() => input.current?.click()}>Import</Button>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

      <Modal open={modal === 'remove'} onClose={close} title="Remove generated data?" footer={<><Button onClick={close}>Cancel</Button><Button variant="danger" loading={busy} onClick={remove}>Remove</Button></>}>
        <div className="space-y-2 text-sm">
          <p>This deletes everything with origin <b>generated</b> (from scenario runs), <b>manual</b> (made by hand) or <b>slack</b> (read from Slack):</p>
          <ul className="list-disc pl-5 text-muted">
            <li>threads, with their messages and the knowledge only they produced</li>
            <li>incidents</li>
            <li>scenarios, personas and inventory with these origins</li>
          </ul>
          {gen && <p className="text-xs text-muted">Right now: {gen.threads} threads, {gen.incidents} incidents, {gen.scenarios} scenarios.</p>}
          <p className="text-muted">Elisa and synthetic seed data stay.</p>
        </div>
      </Modal>

      <Modal open={modal === 'reset'} onClose={close} title="Reset the workbench" footer={<><Button onClick={close}>Cancel</Button><Button variant="danger" loading={busy} onClick={() => run(() => api.reset(mode), 'Workbench reset')}>Reset</Button></>}>
        <div className="space-y-2 text-sm">
          {([
            ['seed', 'Back to the seed', 'Restores the starting data: inventory, personas, scenarios and the historical threads, already processed. Everything you added is lost.'],
            ['empty', 'Start empty', 'Keeps inventory, personas and scenarios, but drops threads, incidents, knowledge, jobs and runs. Use it to watch knowledge being built from scratch.'],
          ] as const).map(([k, title, text]) => (
            <label key={k} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3', mode === k ? 'border-accent bg-accent-soft' : 'border-line')}>
              <input type="radio" checked={mode === k} onChange={() => setMode(k)} />
              <span><b>{title}</b><span className="block text-xs text-muted">{text}</span></span>
            </label>
          ))}
        </div>
      </Modal>

      <Modal open={modal === 'import'} onClose={close} title="Import data?" footer={<><Button onClick={close}>Cancel</Button><Button variant="danger" loading={busy} onClick={() => run(() => api.import(file?.data), 'Data imported')}>Import and replace</Button></>}>
        <p className="text-sm">Import <b>{file?.name}</b>? It replaces the current workbench state with the content of this export file.</p>
      </Modal>
    </div>
  )
}
