import { Send } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { LiveThread } from '../../api/types'
import { useLive } from '../../store/live'
import { Button, Input, Select, Textarea, withToast } from '../ui'

const CUSTOM = '__custom__'

export function Composer({ thread }: { thread: LiveThread }) {
  const personas = useLive((s) => s.personas)
  const slackOn = useLive((s) => s.slack.connected && !!s.settings?.slack_mirror)
  const [who, setWho] = useState('')
  const [custom, setCustom] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  // Default to the first participant that is a persona, else the first persona.
  const personaId =
    who && who !== CUSTOM
      ? who
      : who === CUSTOM
        ? ''
        : (personas.find((p) => thread.participants.includes(p.name))?.id ?? personas[0]?.id ?? '')
  const isCustom = who === CUSTOM || (!personaId && !personas.length)
  const canSend = text.trim() && (isCustom ? custom.trim() : personaId) && !busy

  const send = async () => {
    if (!canSend) return
    setBusy(true)
    const ok = await withToast(() =>
      api.postMessage(thread.id, isCustom ? { author: custom.trim(), text: text.trim() } : { persona_id: personaId, text: text.trim() }),
    )
    setBusy(false)
    if (ok) setText('')
  }

  return (
    <div className="border-t border-line p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted">Send as</span>
        <Select className="h-8 w-48 text-xs" value={isCustom ? CUSTOM : personaId} onChange={(e) => setWho(e.target.value)}>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.role})
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </Select>
        {isCustom && <Input className="h-8 w-44 text-xs" placeholder="Author name" value={custom} onChange={(e) => setCustom(e.target.value)} />}
        {slackOn && <span className="ml-auto text-[12.5px] text-slack">Will be mirrored to Slack</span>}
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          className="resize-none"
          placeholder="Write a message. Enter sends, Shift+Enter adds a line."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <Button variant="primary" icon={<Send size={14} />} disabled={!canSend} loading={busy} onClick={send}>
          Send
        </Button>
      </div>
    </div>
  )
}
