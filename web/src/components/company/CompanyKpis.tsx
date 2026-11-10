import { Activity, AlertTriangle, Bot, BookOpenCheck, MessagesSquare, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import type { CompanyState } from '../../api/types'
import { useLive } from '../../store/live'
import { Stat } from '../ui'
import { callCount, healthCounts } from './status'

export function CompanyKpis({ c, compact, publicDemo }: { c: CompanyState; compact?: boolean; publicDemo?: boolean }) {
  const threads = useLive((s) => s.threads)
  const assertions = useLive((s) => s.assertions)
  const incidents = useLive((s) => s.incidents)
  const elements = useLive((s) => s.elements)
  const running = useMemo(() => Object.values(threads).filter((t) => t.status === 'active' || t.status === 'processing').length, [threads])
  const { valid, total } = useMemo(() => {
    const all = Object.values(assertions)
    return { valid: all.filter((a) => a.valid_to == null).length, total: all.length }
  }, [assertions])
  const open = useMemo(() => Object.values(incidents).filter((i) => i.status === 'open').length, [incidents])
  const counts = useMemo(() => healthCounts(c, elements), [c, elements])
  const pct = useMemo(() => {
    const n = counts.healthy + counts.degraded + counts.down + counts.recovering
    return n ? Math.round((counts.healthy / n) * 100) : null
  }, [counts])
  const tone = pct == null ? 'neutral' : pct >= 95 ? 'ok' : pct >= 80 ? 'warn' : 'bad'

  // Public demo: four tiles, the health number appears here only (the network strip shows counts).
  if (publicDemo)
    return (
      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4 md:gap-3 [&>button]:py-2">
        <Stat icon={<AlertTriangle size={18} />} label="Open incidents" value={open} tone={open ? 'warn' : 'neutral'} />
        <Stat icon={<BookOpenCheck size={18} />} label="Knowledge in force" value={valid} tone="accent" />
        <Stat icon={<Activity size={18} />} label="Network health" value={pct ?? 0} text={pct == null ? '—' : undefined} suffix="%" tone={tone} />
        <Stat icon={<Bot size={18} />} label="Agent calls" value={callCount(c)} tone="neutral" />
      </div>
    )

  const size = compact ? 14 : 18
  const wrap = compact ? 'flex shrink-0 gap-2 overflow-x-auto' : `grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 ${c.endless ? 'lg:grid-cols-3 2xl:grid-cols-6' : 'xl:grid-cols-5'}`
  return (
    <div className={wrap}>
      <Stat compact={compact} icon={<MessagesSquare size={size} />} label="Chats running" value={running} hint="active or being processed" tone="accent" />
      <Stat compact={compact} icon={<BookOpenCheck size={size} />} label="Knowledge in force" value={valid} hint={`of ${total} items in total`} tone="accent" />
      <Stat compact={compact} icon={<AlertTriangle size={size} />} label="Incidents open" value={open} hint="not resolved yet" tone={open ? 'warn' : 'neutral'} />
      <Stat compact={compact} icon={<Activity size={size} />} label="Network health" value={pct ?? 0} text={pct == null ? '—' : undefined} suffix="%" hint={pct == null ? 'no elements loaded' : 'elements that are healthy'} tone={tone} />
      {c.endless && <Stat compact={compact} icon={<Sparkles size={size} />} label="Generated chats" value={c.generated_count} hint="made up live after the script" tone="accent" />}
      <Stat compact={compact} icon={<Bot size={size} />} label="Agent calls" value={callCount(c)} hint="by the autonomous system" tone="neutral" />
    </div>
  )
}
