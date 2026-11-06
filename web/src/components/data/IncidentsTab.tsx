import { Check } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { Incident, Severity } from '../../api/types'
import { fmtDateTime } from '../../lib/format'
import { SEVERITY_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { Badge, Button, Field, IconButton, IdChip, Input, Modal, Select, Textarea, withToast } from '../ui'
import { CrudTab, originCol } from './CrudTab'
import { ObservationsEditor, toObservations } from './ObservationsEditor'

function NewIncidentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const [entity, setEntity] = useState('')
  const [kind, setKind] = useState('link_flapping')
  const [severity, setSeverity] = useState<Severity>('major')
  const [summary, setSummary] = useState('')
  const [obs, setObs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const valid = entity && kind.trim() && summary.trim()

  const submit = async () => {
    setBusy(true)
    const r = await withToast(() => api.createIncident({ entity_id: entity, kind: kind.trim(), severity, summary: summary.trim(), observations: toObservations(obs) }), 'Incident created')
    setBusy(false)
    if (r) {
      onClose()
      setSummary('')
      setObs({})
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="New incident" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={submit}>Create</Button></>}>
      <div className="space-y-3">
        <p className="text-xs text-muted">Incidents are scripted ground truth: nothing here detects a fault. It only gives the conversations something to talk about.</p>
        <Field label="Entity *">
          <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Select…</option>
            <optgroup label="Elements">{elements.map((e) => <option key={e.id} value={e.id}>{e.id}</option>)}</optgroup>
            <optgroup label="Sites">{sites.map((s) => <option key={s.id} value={s.id}>{s.id} ({s.name})</option>)}</optgroup>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind *"><Input value={kind} onChange={(e) => setKind(e.target.value)} /></Field>
          <Field label="Severity">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {Object.entries(SEVERITY_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Summary *"><Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Observations</div>
          <ObservationsEditor value={obs} onChange={setObs} />
        </div>
      </div>
    </Modal>
  )
}

export function IncidentsTab() {
  const incidents = useLive((s) => s.incidents)
  const [creating, setCreating] = useState(false)
  const rows = Object.values(incidents).sort((a, b) => b.opened_at.localeCompare(a.opened_at))
  return (
    <>
      <CrudTab<Incident>
        noun="Incident"
        rows={rows}
        onAdd={() => setCreating(true)}
        onDelete={(i) => api.deleteIncident(i.id)}
        rowActions={(i) =>
          i.status === 'open' ? (
            <IconButton title="Resolve" className="hover:!text-ok" onClick={() => withToast(() => api.resolveIncident(i.id), 'Incident resolved')}>
              <Check size={14} />
            </IconButton>
          ) : null
        }
        columns={[
          { key: 'id', header: 'ID', cell: (i) => <IdChip>{i.id}</IdChip> },
          { key: 'entity', header: 'Entity', cell: (i) => i.entity_id },
          { key: 'kind', header: 'Kind', cell: (i) => i.kind },
          { key: 'sev', header: 'Severity', cell: (i) => <Badge className={SEVERITY_STYLE[i.severity].cls}>{SEVERITY_STYLE[i.severity].label}</Badge> },
          { key: 'status', header: 'Status', cell: (i) => <Badge className={i.status === 'open' ? 'bg-bad/15 text-bad' : 'bg-ok/15 text-ok'}>{i.status}</Badge> },
          { key: 'sum', header: 'Summary', className: 'max-w-sm text-xs text-muted', cell: (i) => i.summary },
          { key: 'at', header: 'Opened (sim)', className: 'whitespace-nowrap text-xs', cell: (i) => fmtDateTime(i.opened_at) },
          originCol<Incident>(),
        ]}
      />
      <NewIncidentModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
