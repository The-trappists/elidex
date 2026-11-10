// One patterns call per page, debounced behind knowledge changes, with a `refreshing` flag for the team spinner.
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { demoPatterns, isDemo } from '../../api/fixtures/company'
import { useLive } from '../../store/live'
import { useGraphQuery } from '../graph/useGraphQuery'

export function usePatterns(reloadKey: string | number = 0, at?: string | null) {
  const key = `patterns-${reloadKey}-${at ?? 'now'}`
  const { data, error } = useGraphQuery(
    async () => ({ at: at ?? null, report: isDemo() ? demoPatterns(useLive, at) : await api.patterns(null, at) }),
    key,
    at ? 400 : 2000,
    at ? 2000 : 15000,
  )
  // A previous snapshot must not masquerade as evidence from the selected time.
  const report = data?.at === (at ?? null) ? data.report : null
  const [refreshing, setRefreshing] = useState(false)
  const lastKey = useRef(key)
  useEffect(() => {
    if (lastKey.current === key) return
    lastKey.current = key
    setRefreshing(true)
  }, [key])
  useEffect(() => {
    if (data) setRefreshing(false)
  }, [data])
  return {
    report,
    patterns: report?.patterns ?? [],
    error,
    loading: !report && !error,
    refreshing,
  }
}
