// "Why this trust and confidence": the agents' reasoning for one assertion. Never blocks the rest of the panel.
import { CheckCircle2, CircleAlert, Minus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { FactorEffect, Justification, JustificationFactor, TrustLevel, VerdictNote } from '../../api/types'
import { TRUST_STYLE } from '../../lib/semantic'
import { Badge, IdChip } from '../ui'
import { assertionHref, threadHref } from './bits'

const EFFECT: Record<FactorEffect, { icon: typeof Minus; cls: string; word: string }> = {
  supports: { icon: CheckCircle2, cls: 'text-ok', word: 'Supports' },
  limits: { icon: CircleAlert, cls: 'text-warn', word: 'Limits' },
  neutral: { icon: Minus, cls: 'text-muted', word: 'Neutral' },
}

function Factors({ items }: { items: JustificationFactor[] }) {
  if (!items.length) return null
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((f, i) => {
        const e = EFFECT[f.effect] ?? EFFECT.neutral
        const Icon = e.icon
        return (
          <li key={i} className="flex items-start gap-2 text-[13px]">
            <Icon size={14} className={`mt-0.5 shrink-0 ${e.cls}`} aria-label={e.word} />
            <span className="min-w-0 break-words">
              <span className="font-medium">{f.label}</span>
              {f.detail && <span className="text-muted"> · {f.detail}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Verdict({ title, v }: { title: string; v: VerdictNote }) {
  return (
    <div className="text-[13px]">
      <span className="text-muted">{title}: </span>
      <Badge>{v.verdict}</Badge> <span className="break-words">{v.reason}</span>
      {v.other_assertion_id && (
        <>
          {' '}
          <Link to={assertionHref(v.other_assertion_id)}><IdChip className="hover:border-accent">{v.other_assertion_id}</IdChip></Link>
        </>
      )}
    </div>
  )
}

export function JustificationPanel({ id }: { id: string }) {
  const [state, setState] = useState<{ id: string; data?: Justification; error?: string }>({ id })
  const [tries, setTries] = useState(0)

  useEffect(() => {
    let live = true
    api.justification(id).then(
      (data) => live && setState({ id, data }),
      (e) => live && setState({ id, error: e instanceof Error ? e.message : 'Request failed' }),
    )
    return () => { live = false }
  }, [id, tries])
  const retry = useCallback(() => { setState({ id }); setTries((t) => t + 1) }, [id])

  const cur = state.id === id ? state : { id }
  const j = cur.data
  return (
    <section className="mt-5" aria-label="Why this trust and confidence">
      <h4 className="mb-1.5 text-[13px] font-medium text-muted">Why this trust and confidence</h4>
      {cur.error ? (
        <div className="rounded-md border border-line px-3 py-2 text-[13px]">
          <span className="text-muted">The reasoning is not available right now.</span>{' '}
          <button className="text-accent hover:underline" onClick={retry}>Retry</button>
        </div>
      ) : !j ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
        </div>
      ) : (
        <div className="space-y-4 rounded-md border border-line p-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Badge className={TRUST_STYLE[j.trust_level as TrustLevel]?.cls}>Trust: {TRUST_STYLE[j.trust_level as TrustLevel]?.label ?? j.trust_level}</Badge>
              <span className="min-w-0 break-words">{j.trust_summary}</span>
            </div>
            <Factors items={j.trust_factors} />
          </div>
          <div>
            <div className="flex items-center gap-2 text-[13px]">
              <span className="shrink-0 font-medium">Confidence {Math.round(j.confidence * 100)}%</span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.confidence * 100)} aria-label="Confidence">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(j.confidence * 100)}%` }} />
              </div>
            </div>
            <p className="mt-1.5 break-words text-[13px] text-muted">{j.confidence_summary}</p>
            <Factors items={j.confidence_factors} />
          </div>
          {(j.critic || j.judge.length > 0) && (
            <div className="space-y-1.5 border-t border-line pt-3">
              {j.critic && <Verdict title="Second check" v={j.critic} />}
              {j.judge.map((v, i) => <Verdict key={i} title="Judge" v={v} />)}
            </div>
          )}
          <div className="border-t border-line pt-3 text-[13px]">
            <span className="text-muted">Based on {j.n_sources} source{j.n_sources === 1 ? '' : 's'}</span>
            {j.source_thread_ids.length > 0 && (
              <span className="ml-2 inline-flex flex-wrap gap-x-3 gap-y-1">
                {j.source_thread_ids.map((t) => <Link key={t} className="break-all text-accent hover:underline" to={threadHref(t)}>{t}</Link>)}
              </span>
            )}
            {j.track_record && Object.keys(j.track_record).length > 0 && (
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                <dt className="col-span-2 font-medium text-muted">Track record</dt>
                {Object.entries(j.track_record).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-muted">{k.replace(/_/g, ' ')}</dt><dd className="break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
