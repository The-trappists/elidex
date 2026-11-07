import { useState } from 'react'
import { reviewApi } from '../../api/review'
import type { PipelineJob, TrustLevel } from '../../api/types'
import { TRUST_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { TRUST_LEVELS, TypeBadge } from '../knowledge/bits'
import { Button, Field, Input, Modal, Select, Textarea, withToast } from '../ui'

const list = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean)

/**
 * Correct one finding and run the pipeline again from the link step (the model is not asked again).
 * The old result of this job is replaced, so this sits behind a confirmation Modal.
 */
export function ItemEditor({ job, index, onClose }: { job: PipelineJob; index: number | null; onClose: () => void }) {
  const item = index != null ? job.items[index] : undefined
  if (!item || index == null) return null
  return <Body key={`${job.id}-${index}`} job={job} index={index} onClose={onClose} />
}

function Body({ job, index, onClose }: { job: PipelineJob; index: number; onClose: () => void }) {
  const item = job.items[index]
  const [summary, setSummary] = useState(item.summary)
  const [action, setAction] = useState(item.action ?? '')
  const [avoid, setAvoid] = useState(item.avoid.join('\n'))
  const [trust, setTrust] = useState<TrustLevel>(item.trust_level)
  const [elements, setElements] = useState(item.scope.instance_ids.join(', '))
  const [sites, setSites] = useState(item.scope.site_ids.join(', '))
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    const edited = {
      ...item,
      summary: summary.trim(),
      action: action.trim() || null,
      avoid: list(avoid, /\n/),
      trust_level: trust,
      scope: { ...item.scope, instance_ids: list(elements, /[,\s]+/), site_ids: list(sites, /[,\s]+/) },
    }
    const next = await withToast(
      () => reviewApi.rerun(job.id, { items: job.items.map((it, i) => (i === index ? edited : it)), from_stage: 'link' }),
      'Re-run from link done. The corrected finding is saved.',
    )
    setBusy(false)
    if (next) {
      useLive.setState((s) => ({ jobs: s.jobs.some((j) => j.id === next.id) ? s.jobs.map((j) => (j.id === next.id ? next : j)) : [...s.jobs, next] }))
      onClose()
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={<span className="flex items-center gap-2"><TypeBadge type={item.type} /> Edit finding, then re-run from link</span>}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!summary.trim()} onClick={run}>Re-run from link</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted">
          <b className="font-medium text-text">{item.topic}</b>. The linker and the store run again with your version. The model is not asked again.
          {job.assertion_ids.length > 0 && <> This replaces what this job saved ({job.assertion_ids.join(', ')}). The earlier version stays in the job history.</>}
        </p>
        <Field label="Summary"><Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        <Field label="Action"><Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="No action" /></Field>
        <Field label="Avoid" hint="One per line."><Textarea rows={2} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="Nothing to avoid" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Trust level">
            <Select value={trust} onChange={(e) => setTrust(e.target.value as TrustLevel)}>
              {TRUST_LEVELS.map((t) => <option key={t} value={t}>{TRUST_STYLE[t].label}</option>)}
            </Select>
          </Field>
          <Field label="Equipment ids" hint="Comma separated."><Input value={elements} onChange={(e) => setElements(e.target.value)} placeholder="RAD-176" /></Field>
          <Field label="Site ids" hint="Comma separated."><Input value={sites} onChange={(e) => setSites(e.target.value)} placeholder="SITE-ROV-008" /></Field>
        </div>
      </div>
    </Modal>
  )
}
