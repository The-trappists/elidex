// Inline "why the loop was unsure": the short version of the knowledge justification, with the full panel one click away.
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Justification } from '../../api/types'
import { JustificationPanel } from '../knowledge/JustificationPanel'

const cache = new Map<string, Justification>()

export function WhyUnsure({ id }: { id: string }) {
  const [state, setState] = useState<{ id: string; data?: Justification; error?: boolean }>({ id, data: cache.get(id) })
  const [tries, setTries] = useState(0)
  const [full, setFull] = useState(false)

  useEffect(() => {
    if (cache.has(id) && tries === 0) return
    let live = true
    api.justification(id).then(
      (data) => { cache.set(id, data); if (live) setState({ id, data }) },
      () => live && setState({ id, error: true }),
    )
    return () => { live = false }
  }, [id, tries])
  const retry = useCallback(() => { setState({ id }); setTries((t) => t + 1) }, [id])

  const cur = state.id === id ? state : { id, data: cache.get(id) }
  const j = cur.data
  return (
    <section aria-label="Why the loop was unsure" className="rounded-md border border-line p-3">
      <h4 className="text-[13px] font-medium text-muted">Why trust and confidence are what they are</h4>
      {cur.error ? (
        <p className="mt-1 text-[13px] text-muted">The reasoning is not available right now. <button className="text-accent hover:underline" onClick={retry}>Retry</button></p>
      ) : !j ? (
        <div className="mt-2 space-y-2" aria-busy="true">
          <div className="skeleton h-4 w-2/3 rounded" />
          <div className="skeleton h-4 w-full rounded" />
        </div>
      ) : (
        <div className="mt-1.5 space-y-1.5 text-[13px]">
          <p className="break-words"><b className="font-semibold">Confidence {Math.round(j.confidence * 100)}%.</b> {j.confidence_summary}</p>
          <ul className="space-y-1">
            {[...j.trust_factors, ...j.confidence_factors].filter((f) => f.effect === 'limits').slice(0, 3).map((f, i) => (
              <li key={i} className="flex items-start gap-2"><CircleAlert size={14} className="mt-0.5 shrink-0 text-warn" aria-label="Limits" /><span className="min-w-0 break-words"><span className="font-medium">{f.label}</span>{f.detail && <span className="text-muted"> · {f.detail}</span>}</span></li>
            ))}
            {[...j.trust_factors, ...j.confidence_factors].filter((f) => f.effect === 'supports').slice(0, 1).map((f, i) => (
              <li key={`s${i}`} className="flex items-start gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" aria-label="Supports" /><span className="min-w-0 break-words"><span className="font-medium">{f.label}</span>{f.detail && <span className="text-muted"> · {f.detail}</span>}</span></li>
            ))}
          </ul>
          <button className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-text" aria-expanded={full} onClick={() => setFull(!full)}>
            {full ? <ChevronDown size={12} /> : <ChevronRight size={12} />} All reasoning
          </button>
          {full && <JustificationPanel id={id} />}
        </div>
      )}
    </section>
  )
}
