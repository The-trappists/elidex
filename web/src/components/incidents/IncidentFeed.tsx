import { CheckCircle2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { Incident } from '../../api/types'
import { useSimNow } from '../../lib/useNow'
import { useLive } from '../../store/live'
import { Button, EmptyState, Modal, withToast } from '../ui'
import { AgentModal } from './AgentModal'
import { IncidentCard } from './IncidentCard'

/** Open incidents first, then recently resolved ones (dimmed). */
export function IncidentFeed({ resolvedLimit = 6 }: { resolvedLimit?: number }) {
  const incidents = useLive((s) => s.incidents)
  const now = useSimNow(5000) ?? new Date()
  const [ask, setAsk] = useState<Incident | null>(null)
  const [del, setDel] = useState<Incident | null>(null)

  const { open, resolved } = useMemo(() => {
    const all = Object.values(incidents)
    return {
      open: all.filter((i) => i.status === 'open').sort((a, b) => b.opened_at.localeCompare(a.opened_at)),
      resolved: all
        .filter((i) => i.status === 'resolved')
        .sort((a, b) => (b.resolved_at ?? b.opened_at).localeCompare(a.resolved_at ?? a.opened_at))
        .slice(0, resolvedLimit),
    }
  }, [incidents, resolvedLimit])

  if (!open.length && !resolved.length)
    return <EmptyState icon={<CheckCircle2 size={26} />} title="No incidents" hint="Scripted incidents appear here when a scenario runs. Each one shows what the team already knows about the affected element." />

  const card = (i: Incident) => (
    <IncidentCard key={i.id} incident={i} now={now} onAsk={() => setAsk(i)} onResolve={() => void withToast(() => api.resolveIncident(i.id), 'Incident resolved')} onDelete={() => setDel(i)} />
  )

  return (
    <div className="space-y-2.5 p-3">
      {open.map(card)}
      {!open.length && <div className="rounded-xl border border-dashed border-line p-3 text-center text-xs text-muted">All clear: no open incident.</div>}
      {resolved.length > 0 && (
        <>
          <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Recently resolved</div>
          {resolved.map(card)}
        </>
      )}
      <AgentModal incident={ask} onClose={() => setAsk(null)} />
      <Modal
        open={!!del}
        onClose={() => setDel(null)}
        title="Delete incident?"
        footer={
          <>
            <Button onClick={() => setDel(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const d = del
                setDel(null)
                if (d) await withToast(() => api.deleteIncident(d.id), 'Incident deleted')
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm">
          This removes the incident on <b>{del?.entity_id}</b>. The conversation and the knowledge extracted from it stay.
        </p>
      </Modal>
    </div>
  )
}
