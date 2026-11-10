import { useMemo } from 'react'
import type { AgentCall } from '../../api/types'
import { useLive } from '../../store/live'
import { buildTimelineEvents, type TimelineEvent } from './timelineModel'

const NO_CALLS: AgentCall[] = []

/** The timeline markers for the current store contents. */
export function useTimelineEvents(): TimelineEvent[] {
  const assertions = useLive((s) => s.assertions)
  const incidents = useLive((s) => s.incidents)
  const threads = useLive((s) => s.threads)
  const calls = useLive((s) => s.company?.calls) ?? NO_CALLS
  return useMemo(() => buildTimelineEvents({ assertions, incidents, threads, calls }), [assertions, incidents, threads, calls])
}
