// "Merged N similar": near-duplicate assertions the backend folded into one.
import { GitMerge } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { DedupeReport } from '../../api/types'
import { fmtDateTime } from '../../lib/format'
import { Badge, Drawer, IdChip } from '../ui'
import { assertionHref } from './bits'

export function MergesBadge() {
  const [report, setReport] = useState<DedupeReport | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { api.dedupe().then(setReport, () => setReport(null)) }, [])
  if (!report?.enabled || report.merged_total === 0) return null
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text" title="Near-duplicate knowledge that was merged">
        <GitMerge size={13} /> Merged {report.merged_total} similar
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} width="max-w-lg" title="Merged similar knowledge">
        <p className="mb-3 text-[13px] text-muted">Near-duplicates are folded into one item. Similarity threshold {Math.round(report.threshold * 100)}%.</p>
        {report.recent.length === 0 ? <p className="text-sm text-muted">No recent merges.</p> : (
          <ul className="space-y-2">
            {report.recent.map((m, i) => (
              <li key={i} className="rounded-md border border-line p-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted">Kept</span>
                  <Link to={assertionHref(m.kept_id)} onClick={() => setOpen(false)}><IdChip className="hover:border-accent">{m.kept_id}</IdChip></Link>
                  <span className="text-muted">merged</span>
                  <IdChip>{m.merged_id}</IdChip>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge>{m.method}</Badge> <span>{Math.round(m.similarity * 100)}% similar</span> <span>{fmtDateTime(m.at)}</span>
                </div>
                <p className="mt-1.5 break-words">{m.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </>
  )
}
