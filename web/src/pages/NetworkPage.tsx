import { addDays, format } from 'date-fns'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Inspector } from '../components/graph/Inspector'
import { NetworkGraph } from '../components/graph/NetworkGraph'
import type { NodeKind } from '../components/graph/graphModel'
import { GraphWorkspace } from '../components/graph/GraphWorkspace'
import { Input } from '../components/ui'
import { Button } from '../components/ui'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

const HOUR = 3_600_000

export default function NetworkPage() {
  const [params, setParams] = useSearchParams()
  // Round to the second so memoized values do not recompute on every render.
  const nowSec = Math.floor((useSimNow(5000) ?? new Date()).getTime() / 1000)
  const now = useMemo(() => new Date(nowSec * 1000), [nowSec])
  const [t, setT] = useState<Date | null>(null) // null = follow sim now
  const [q, setQ] = useState('')
  const [knowledge, setKnowledge] = useState(true)
  const assertions = useLive((s) => s.assertions)
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const classes = useLive((s) => s.classes)

  const at = t ?? now
  const min = useMemo(() => {
    const from = Object.values(assertions).map((a) => new Date(a.valid_from).getTime())
    return Math.min(...from, now.getTime() - 30 * 24 * HOUR)
  }, [assertions, now])
  const max = addDays(now, 30).getTime()

  const selectedId = params.get('select')
  const kind: NodeKind | null = !selectedId
    ? null
    : elements.some((e) => e.id === selectedId)
      ? 'element'
      : sites.some((s) => s.id === selectedId)
        ? 'site'
        : classes[selectedId]
          ? 'class'
          : assertions[selectedId]
            ? 'assertion'
            : null
  const select = (id: string | null) => setParams(id ? { select: id } : {}, { replace: true })

  const rel = at.getTime() - now.getTime()
  const state = Math.abs(rel) < HOUR / 2 ? 'now' : rel < 0 ? 'past' : 'future'

  return (
    <GraphWorkspace
      title="Knowledge across the network"
      description="Explore equipment and the experience attached to it, now or at another point in time."
      selected={!!kind}
      onClear={() => select(null)}
      toolbar={
        <>
          <div className="flex w-full flex-wrap items-center gap-3">
            <div className="shrink-0 leading-tight">
              <div className="text-xs text-muted">Situation on</div>
              <div className="text-sm font-semibold tabular-nums">
                {format(at, 'EEE d MMM yyyy, HH:mm')}
                {state !== 'now' && <span className="ml-2 font-normal text-muted">({state === 'past' ? 'past' : 'future'})</span>}
              </div>
            </div>
            <input
              type="range"
              className="min-w-24 flex-1 accent-[var(--accent)]"
              min={min}
              max={max}
              step={HOUR}
              value={Math.min(Math.max(at.getTime(), min), max)}
              onChange={(e) => setT(new Date(Number(e.target.value)))}
              aria-label="Travel in time"
              title="Drag to see which knowledge was in force at another time"
            />
            <Button size="sm" disabled={!t} onClick={() => setT(null)}>
              Back to now
            </Button>
          </div>
        </>
      }
      canvas={
        <>
          <NetworkGraph
            at={at}
            layers={{ knowledge }}
            onLayersChange={(l) => setKnowledge(l.knowledge)}
            selectedId={selectedId}
            onSelect={(id) => select(id)}
          />
        </>
      }
      browse={
        <div className="p-4">
          <h3 className="mb-3 font-semibold">Find equipment or a site</h3>
          <Input aria-label="Search network" placeholder="Search by name, model or ID" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-3 divide-y divide-line">
            {[
              ...sites.map((s) => ({ id: s.id, title: s.name, detail: 'Site · ' + s.region })),
              ...elements.map((e) => ({
                id: e.id,
                title: e.id,
                detail: e.model + ' · ' + (sites.find((s) => s.id === e.site_id)?.name ?? 'No site'),
              })),
            ]
              .filter((x) => `${x.title} ${x.id} ${x.detail}`.toLowerCase().includes(q.toLowerCase()))
              .map((x) => (
                <button key={x.id} onClick={() => select(x.id)} className="w-full rounded-md py-3 text-left hover:bg-surface-2">
                  <span className="block text-sm font-medium">{x.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{x.detail}</span>
                </button>
              ))}
          </div>
        </div>
      }
      details={
        <>
          <Inspector id={selectedId} kind={kind} at={at} onSelect={(id) => select(id)} />
        </>
      }
    />
  )
}
