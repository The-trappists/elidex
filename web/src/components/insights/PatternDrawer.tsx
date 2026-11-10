import { Link } from 'react-router-dom'
import type { LiveThread, Pattern } from '../../api/types'
import { Drawer } from '../ui'
import { PatternRow } from './PatternRow'

/** The correlation list beside the graph: the same rows as the Insights page, without leaving the map. */
export function PatternDrawer({
  open,
  onClose,
  patterns,
  threads,
  selectedId,
  onFocus,
  publicDemo,
}: {
  open: boolean
  onClose: () => void
  patterns: Pattern[]
  threads: Record<string, LiveThread>
  selectedId?: string | null
  onFocus: (p: Pattern) => void
  publicDemo?: boolean
}) {
  return (
    <Drawer open={open} onClose={onClose} title="Correlations" width="max-w-xl">
      <div className="divide-y divide-line">
        {patterns.length ? (
          patterns.map((p) => (
            <PatternRow key={p.id} p={p} active={p.id === selectedId} isNew={false} threads={threads} onSelect={() => onFocus(p)} publicDemo={publicDemo} />
          ))
        ) : (
          <p className="py-6 text-sm text-muted">No correlations yet.</p>
        )}
      </div>
      {!publicDemo && (
        <Link to="/insights" className="mt-4 inline-flex text-sm text-accent hover:underline">
          Open all correlations →
        </Link>
      )}
    </Drawer>
  )
}
