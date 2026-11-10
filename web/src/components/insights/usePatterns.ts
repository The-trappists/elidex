// One patterns call per page, debounced behind knowledge changes, with a `refreshing` flag for the team spinner.
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { demoPatterns, isDemo } from '../../api/fixtures/company'
import { useLive } from '../../store/live'
import { useGraphQuery } from '../graph/useGraphQuery'

export function usePatterns(reloadKey: string | number = 0) {
  const key = `patterns-${reloadKey}`
  const { data, error } = useGraphQuery(
    () => (isDemo() ? Promise.resolve(demoPatterns(useLive)) : api.patterns()),
    key,
    2000,
    15000,
  )
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
    report: data,
    patterns: data?.patterns ?? [],
    error,
    loading: !data && !error,
    refreshing,
  }
}
