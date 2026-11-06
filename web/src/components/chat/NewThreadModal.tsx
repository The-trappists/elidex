import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { ThreadSource } from '../../api/types'
import { cn } from '../../lib/cn'
import { useLive } from '../../store/live'
import { Avatar, Button, Field, Input, Modal, Select, withToast } from '../ui'

export function NewThreadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const personas = useLive((s) => s.personas)
  const nav = useNavigate()
  const [source, setSource] = useState<ThreadSource>('teams')
  const [subject, setSubject] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const toggle = (name: string) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]))

  const submit = async () => {
    setBusy(true)
    const t = await withToast(() => api.createThread({ source, subject: subject.trim() || null, participants: picked }), 'Thread created')
    setBusy(false)
    if (t) {
      onClose()
      setSubject('')
      setPicked([])
      nav(`/conversations/${encodeURIComponent(t.id)}`)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New thread"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value as ThreadSource)}>
            <option value="teams">Teams</option>
            <option value="email">Email</option>
            <option value="slack">Slack</option>
          </Select>
        </Field>
        <Field label="Subject" hint="Optional. Shown in the thread list.">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Link flapping on TRN-042" />
        </Field>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Participants</div>
          {personas.length === 0 && <div className="text-xs text-muted">No personas yet. Add some in Data.</div>}
          <div className="grid grid-cols-2 gap-1.5">
            {personas.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.name)}
                className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm transition', picked.includes(p.name) ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
              >
                <Avatar name={p.name} color={p.avatar_color} size={24} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{p.name}</span>
                  <span className="block truncate text-[10px] text-muted">{p.role}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
