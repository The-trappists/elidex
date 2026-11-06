import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { ContextHit } from '../../api/types'
import { toNaiveIso } from '../../lib/format'
import { simNow, useLive } from '../../store/live'

/**
 * Context for one entity, refetched (debounced) whenever the assertion set, the entity or `at` changes.
 * `at` null means the current sim time.
 */
export function useContextHits(entityId: string | null, at: Date | null, includeExpired = false, debounceMs = 500) {
  const assertions = useLive((s) => s.assertions)
  const [hits, setHits] = useState<ContextHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  // Rounded to the minute: a ticking sim clock must not reset the debounce forever.
  const atKey = at ? Math.floor(at.getTime() / 60000) : null

  useEffect(() => {
    if (!entityId) {
      setHits(null)
      return
    }
    let stale = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const when = at ?? simNow(useLive.getState())
        const r = await api.context(entityId, when ? toNaiveIso(when) : null, includeExpired)
        if (!stale) setHits(r)
      } catch {
        if (!stale) setHits([])
      } finally {
        if (!stale) setLoading(false)
      }
    }, debounceMs)
    return () => {
      stale = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, atKey, includeExpired, assertions, debounceMs])

  return { hits, loading }
}
