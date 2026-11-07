import { useEffect, useRef, useState } from 'react'
import { useLive } from '../../store/live'

/**
 * Runs one knowledge-graph query and re-runs it (debounced) when its `key` changes or when the
 * assertions or the threads change, since the graph is rebuilt from both. `data` stays on the
 * previous answer while a refresh is in flight; it is null before the first answer and `error`
 * is set when the call failed. `maxWaitMs` caps the debounce so a constant stream of events cannot starve the refresh.
 */
export function useGraphQuery<T>(fetcher: (() => Promise<T>) | null, key: string, debounceMs = 400, maxWaitMs = Infinity) {
  const assertions = useLive((s) => s.assertions)
  const threads = useLive((s) => s.threads)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(fetcher)
  latest.current = fetcher
  const waitingSince = useRef<number | null>(null)

  useEffect(() => {
    if (!latest.current) {
      setData(null)
      return
    }
    let stale = false
    const now = Date.now()
    waitingSince.current ??= now
    const delay = Math.max(0, Math.min(debounceMs, waitingSince.current + maxWaitMs - now))
    const t = setTimeout(async () => {
      waitingSince.current = null
      try {
        const r = await latest.current!()
        if (!stale) {
          setData(r)
          setError(null)
        }
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : 'request failed')
      }
    }, delay)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [key, assertions, threads, debounceMs, maxWaitMs])

  return { data, error }
}
