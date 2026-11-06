import { OBSERVABLE_FIELDS } from '../../api/types'
import { Input, Select } from '../ui'

export const OBS_OPTIONS: Record<string, string[] | 'number'> = {
  sfp_replaced: ['true', 'false'],
  interface_status: ['UP', 'DOWN'],
  optical_levels: ['normal', 'low', 'high'],
  traffic_counters: 'number',
  alarms: ['active', 'cleared'],
}

/** Raw string values ('' = not observed) -> typed observations for the API. */
export function toObservations(raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [f, v] of Object.entries(raw)) {
    if (v === '') continue
    if (f === 'sfp_replaced') out[f] = v === 'true'
    else if (f === 'traffic_counters') {
      if (!Number.isNaN(Number(v))) out[f] = Number(v)
    } else out[f] = v
  }
  return out
}

export function ObservationsEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(OBSERVABLE_FIELDS).map(([f, desc]) => {
        const opts = OBS_OPTIONS[f]
        return (
          <div key={f} className="grid grid-cols-[9rem_1fr] items-center gap-2" title={desc}>
            <code className="text-xs">{f}</code>
            {opts === 'number' ? (
              <Input type="number" className="h-8" placeholder="not observed" value={value[f] ?? ''} onChange={(e) => onChange({ ...value, [f]: e.target.value })} />
            ) : (
              <Select className="h-8 text-xs" value={value[f] ?? ''} onChange={(e) => onChange({ ...value, [f]: e.target.value })}>
                <option value="">not observed</option>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )
      })}
    </div>
  )
}
