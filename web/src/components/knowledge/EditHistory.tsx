import { History, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fmtAgo } from '../../lib/format'
import { FIELD_LABEL, showValue } from '../../lib/preview'
import { useWallNow } from '../../lib/useNow'
import { useReview } from '../../store/review'
import { Badge, Button, withToast } from '../ui'

/** The operator edits of one assertion, newest first, each with its own Undo. */
export function EditHistory({ assertionId }: { assertionId: string }) {
  const rows = useReview((s) => s.history[assertionId])
  const [busy, setBusy] = useState<string | null>(null)
  const now = useWallNow(60_000)

  useEffect(() => {
    void useReview.getState().loadHistory(assertionId).catch(() => undefined)
  }, [assertionId])

  const undo = async (editId: string) => {
    setBusy(editId)
    await withToast(() => useReview.getState().undo(assertionId, editId), 'Edit undone. The earlier version is back.')
    setBusy(null)
  }

  return (
    <section id="edit-history" aria-label="Edit history" className="scroll-mt-4">
      <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
        <History size={13} /> Edit history{rows ? ` · ${rows.length}` : ''}
      </h4>
      {!rows ? (
        <div className="skeleton h-14 rounded-lg" />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted">No edits yet. Changes you apply show up here, and each one can be undone.</p>
      ) : (
        <ol className="divide-y divide-line rounded-lg border border-line">
          {rows.map((e) => (
            <li key={e.id} className="px-3 py-2.5 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted" title={e.ts}>{fmtAgo(e.ts, now)}</span>
                {e.undone && <Badge>Undone</Badge>}
                {e.note && <span className={e.undone ? 'min-w-0 truncate text-muted line-through' : 'min-w-0 truncate'}>{e.note}</span>}
                <span className="ml-auto">
                  {!e.undone && (
                    <Button size="sm" variant="ghost" loading={busy === e.id} icon={<Undo2 size={13} />} onClick={() => undo(e.id)} aria-label={`Undo edit from ${fmtAgo(e.ts, now)}`}>
                      Undo
                    </Button>
                  )}
                </span>
              </div>
              <dl className={e.undone ? 'mt-1.5 space-y-1 opacity-60' : 'mt-1.5 space-y-1'}>
                {Object.keys(e.after).map((k) => (
                  <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2 text-xs">
                    <dt className="text-muted">{FIELD_LABEL[k] ?? k}</dt>
                    <dd className="min-w-0 break-words">
                      <span className="text-muted line-through">{showValue(e.before[k])}</span> <span aria-hidden>→</span> <span>{showValue(e.after[k])}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
