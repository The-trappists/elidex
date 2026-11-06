import { addDays, format } from 'date-fns'
import { Clock, Network } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Inspector } from '../components/graph/Inspector'
import { NetworkGraph } from '../components/graph/NetworkGraph'
import type { NodeKind } from '../components/graph/graphModel'
import { Badge, Button, Panel } from '../components/ui'
import { cn } from '../lib/cn'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

const HOUR = 3_600_000

export default function NetworkPage() {
  const [params, setParams] = useSearchParams()
  const now = useSimNow(5000) ?? new Date()
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
    <div className="flex h-full min-h-0 gap-3 p-3">
      <Panel title="Network at time t" icon={<Network size={15} />} className="min-w-0 flex-1" bodyClassName="flex flex-col overflow-hidden">
        <div className="shrink-0 border-b border-line px-4 py-3">
          <div className="flex items-end gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Clock size={12} /> t =</div>
              <div className="text-2xl font-semibold tabular-nums leading-tight">{format(at, 'EEE d MMM yyyy, HH:mm')}</div>
            </div>
            <Badge className={cn(state === 'now' ? 'bg-ok/15 text-ok' : state === 'past' ? 'bg-surface-2 text-muted' : 'bg-info/15 text-info')}>
              {state === 'now' ? 'Now' : state === 'past' ? 'In the past' : 'In the future'}
            </Badge>
            <p className="hidden flex-1 text-xs text-muted xl:block">Move t to see which knowledge is valid on which element at that moment. Assertions outside their validity period fade out.</p>
            <Button className="ml-auto" size="sm" variant={t ? 'primary' : 'secondary'} disabled={!t} onClick={() => setT(null)}>
              Now
            </Button>
          </div>
          <input
            type="range"
            className="mt-2 w-full accent-[var(--accent)]"
            min={min}
            max={max}
            step={HOUR}
            value={Math.min(Math.max(at.getTime(), min), max)}
            onChange={(e) => setT(new Date(Number(e.target.value)))}
            aria-label="Time t"
          />
          <div className="flex justify-between text-[10px] text-muted">
            <span>{format(min, 'd MMM yyyy')}</span>
            <span>sim now + 30 days: {format(max, 'd MMM yyyy')}</span>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <NetworkGraph at={at} layers={{ knowledge }} onLayersChange={(l) => setKnowledge(l.knowledge)} selectedId={selectedId} onSelect={(id) => select(id)} />
        </div>
      </Panel>

      <Panel title="Inspector" className="w-[400px] shrink-0 2xl:w-[460px]">
        <Inspector id={selectedId} kind={kind} at={at} onSelect={(id) => select(id)} />
      </Panel>
    </div>
  )
}
