import { useMemo } from 'react'
import type { CompanyState } from '../../api/types'
import { useLive } from '../../store/live'

/** What was learned since the last autonomous sync. */
export function useSinceSync(c: Pick<CompanyState, 'cycles' | 'started_at'>) {
  const assertions = useLive((s) => s.assertions)
  return useMemo(() => {
    const last = c.cycles.length ? c.cycles[c.cycles.length - 1].at : c.started_at
    const ids = new Set(Object.values(assertions).filter((a) => a.valid_to == null && (!last || a.valid_from > last)).map((a) => a.id))
    return { ids, count: ids.size, last }
  }, [assertions, c.cycles, c.started_at])
}

