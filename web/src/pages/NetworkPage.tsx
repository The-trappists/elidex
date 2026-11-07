import { addDays, format } from 'date-fns'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Inspector } from '../components/graph/Inspector'
import { NetworkGraph } from '../components/graph/NetworkGraph'
import type { NodeKind } from '../components/graph/graphModel'
import { Button, Toolbar } from '../components/ui'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

const HOUR = 3_600_000

export default function NetworkPage() {
  const [params, setParams] = useSearchParams()
  // Round to the second so memoized values do not recompute on every render.
  const nowSec = Math.floor((useSimNow(5000) ?? new Date()).getTime() / 1000)
  const now = useMemo(() => new Date(nowSec * 1000), [nowSec])
  const [t, setT] = useState<Date | null>(null) // null = follow sim now
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
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <Toolbar className="flex-nowrap gap-4">
          <div className="shrink-0 leading-tight">
            <div className="text-xs text-muted">Situation on</div>
            <div className="text-sm font-semibold tabular-nums">
              {format(at, 'EEE d MMM yyyy, HH:mm')}
              {state !== 'now' && <span className="ml-2 font-normal text-muted">({state === 'past' ? 'past' : 'future'})</span>}
            </div>
          </div>
          <input
            type="range"
            className="min-w-0 flex-1 accent-[var(--accent)]"
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
        </Toolbar>
        <div className="relative min-h-0 flex-1 bg-bg">
          <NetworkGraph at={at} layers={{ knowledge }} onLayersChange={(l) => setKnowledge(l.knowledge)} selectedId={selectedId} onSelect={(id) => select(id)} />
        </div>
      </section>

      <aside className="w-80 shrink-0 overflow-auto border-l border-line bg-surface 2xl:w-96">
        <Inspector id={selectedId} kind={kind} at={at} onSelect={(id) => select(id)} />
      </aside>
    </div>
  )
}
