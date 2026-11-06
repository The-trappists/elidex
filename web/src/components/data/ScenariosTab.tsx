import { Check, Copy, FileJson, Play, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { Scenario } from '../../api/types'
import { useLive } from '../../store/live'
import { Badge, Button, Field, IconButton, IdChip, JsonView, Modal, Select, Textarea, withToast } from '../ui'
import { CrudTab, originCol } from './CrudTab'

function JsonEditor({ scenario, onClose }: { scenario: Scenario | null; onClose: () => void }) {
  const [text, setText] = useState('')
  const [seen, setSeen] = useState<Scenario | null>(null)
  if (scenario !== seen) {
    setSeen(scenario)
    if (scenario) setText(JSON.stringify(scenario, null, 2))
  }
  const check = useMemo(() => {
    try {
      const v = JSON.parse(text)
      if (typeof v?.id !== 'string' || !v.id) return { error: 'Missing string "id".' }
      if (!Array.isArray(v.messages)) return { error: 'Missing array "messages".' }
      return { value: v as Scenario }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [text])

  const save = async () => {
    if (!check.value) return
    const ok = await withToast(async () => { await api.saveScenario(check.value!); return true }, 'Scenario saved')
    if (ok) onClose()
  }
  return (
    <Modal
      open={!!scenario}
      onClose={onClose}
      wide
      title={`Scenario ${scenario?.id ?? ''}`}
      footer={
        <>
          <span className={`mr-auto self-center text-xs ${check.error ? 'text-bad' : 'text-ok'}`}>{check.error ? check.error : 'Valid JSON'}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!check.value} onClick={save}>Save</Button>
        </>
      }
    >
      <Textarea rows={24} spellCheck={false} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="mt-2 text-[11px] text-muted">Saving with an existing id replaces that scenario. Change the id to save a new one.</p>
    </Modal>
  )
}

function GenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const configured = useLive((s) => s.settings?.llm_configured ?? false)
  const elements = useLive((s) => s.elements)
  const [entity, setEntity] = useState('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Scenario | null>(null)

  const generate = async () => {
    setBusy(true)
    const r = await withToast(() => api.generateScenario({ entity_id: entity || null, hint: hint.trim() || null }))
    setBusy(false)
    if (r) setResult(r)
  }
  const close = () => { setResult(null); onClose() }
  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title="Generate a scenario with the LLM"
      footer={
        result ? (
          <>
            <Button onClick={close}>Close</Button>
            <Button variant="primary" icon={<Play size={14} />} onClick={async () => { await withToast(() => api.runScenario(result.id), 'Scenario started'); close() }}>Run it now</Button>
          </>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" icon={<Sparkles size={14} />} disabled={!configured} loading={busy} onClick={generate}>Generate</Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2">
          <p className="text-sm">Saved as <IdChip>{result.id}</IdChip> with origin "generated": {result.messages.length} messages. You can also edit it later.</p>
          <JsonView value={result} className="max-h-[50vh]" />
        </div>
      ) : (
        <div className="space-y-3">
          {!configured && <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">No LLM is configured, so generation is disabled. Add a Gemini or Featherless key in <code>.env</code> (see <code>.env.example</code>) and restart the backend.</div>}
          <p className="text-xs text-muted">The LLM writes a short chat between personas about an incident on the chosen element. Check the result before relying on it.</p>
          <Field label="Entity" hint="Leave empty to let the generator pick one.">
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">Any element</option>
              {elements.map((e) => <option key={e.id} value={e.id}>{e.id} ({e.type}, {e.model})</option>)}
            </Select>
          </Field>
          <Field label="Hint" hint="Optional, e.g. 'a field technician fixes it, then an expert corrects him'">
            <Textarea rows={3} value={hint} onChange={(e) => setHint(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  )
}

export function ScenariosTab() {
  const scenarios = useLive((s) => s.scenarios)
  const runs = useLive((s) => s.runs)
  const [editing, setEditing] = useState<Scenario | null>(null)
  const [generating, setGenerating] = useState(false)
  const byId = Object.fromEntries(scenarios.map((s) => [s.id, s]))
  const active = runs.filter((r) => !r.done)

  const duplicate = (s: Scenario) => {
    let n = 2
    while (byId[`${s.id}-copy${n === 2 ? '' : n}`]) n++
    const id = `${s.id}-copy${n === 2 ? '' : n}`
    return withToast(() => api.saveScenario({ ...s, id, title: `${s.title} (copy)`, origin: 'manual' }), 'Scenario duplicated')
  }

  return (
    <>
      <div className="flex h-full flex-col">
        {active.length > 0 && (
          <div className="border-b border-line bg-info/10 px-4 py-2 text-xs">
            <b>Running:</b>{' '}
            {active.map((r) => (
              <span key={r.id} className="mr-3">
                {byId[r.scenario_id]?.title ?? r.scenario_id} ({r.next_seq}/{byId[r.scenario_id]?.messages.length ?? '?'} messages)
              </span>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <CrudTab<Scenario>
            noun="Scenario"
            rows={scenarios}
            onDelete={(s) => api.deleteScenario(s.id)}
            extraActions={<Button size="sm" icon={<Sparkles size={13} />} onClick={() => setGenerating(true)}>Generate with LLM</Button>}
            rowActions={(s) => (
              <>
                <IconButton title="Run" className="hover:!text-ok" onClick={() => withToast(() => api.runScenario(s.id), 'Scenario started')}><Play size={14} /></IconButton>
                <IconButton title="View / edit JSON" onClick={() => setEditing(s)}><FileJson size={14} /></IconButton>
                <IconButton title="Duplicate" onClick={() => duplicate(s)}><Copy size={14} /></IconButton>
              </>
            )}
            columns={[
              { key: 'title', header: 'Title', cell: (s) => (<div><div className="font-medium">{s.title}</div><IdChip>{s.id}</IdChip></div>) },
              { key: 'ch', header: 'Channel', cell: (s) => s.channel },
              { key: 'tags', header: 'Tags', cell: (s) => <div className="flex flex-wrap gap-1">{s.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div> },
              { key: 'n', header: 'Messages', cell: (s) => s.messages.length },
              { key: 'exp', header: 'Expected', cell: (s) => (s.expected ? <Check size={14} className="text-ok" /> : <span className="text-muted">—</span>) },
              originCol<Scenario>(),
            ]}
          />
        </div>
      </div>
      <JsonEditor scenario={editing} onClose={() => setEditing(null)} />
      <GenerateModal open={generating} onClose={() => setGenerating(false)} />
    </>
  )
}
