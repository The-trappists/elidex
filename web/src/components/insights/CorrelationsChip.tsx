import { Waypoints } from 'lucide-react'
import type { Pattern } from '../../api/types'
import { Button } from '../ui'

/** Heading action: how many open correlations there are, and the way into the drawer. Hidden when there are none. */
export function CorrelationsChip({ patterns, onOpen }: { patterns: Pattern[]; onOpen: () => void }) {
  const open = patterns.filter((p) => p.level !== 'resolved').length
  if (!open) return null
  return (
    <Button size="sm" icon={<Waypoints size={14} />} aria-haspopup="dialog" onClick={onOpen}>
      Correlations · {open}
    </Button>
  )
}
