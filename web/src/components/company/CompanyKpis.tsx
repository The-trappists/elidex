import { Activity, AlertTriangle, Bot, BookOpenCheck, MessagesSquare, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import type { CompanyState } from '../../api/types'
import { useLive } from '../../store/live'
import { Stat } from '../ui'
import { callCount } from './status'

export function CompanyKpis({ c }: { c: CompanyState }) {
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
  const pct = useMemo(() => {
    const n = elements.length
    if (!n) return null
    const bad = Math.min(n, c.health.filter((h) => h.status !== 'healthy').length)
    return Math.round(((n - bad) / n) * 100)
  }, [elements, c.health])
  const tone = pct == null ? 'neutral' : pct >= 95 ? 'ok' : pct >= 80 ? 'warn' : 'bad'
  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${c.endless ? "lg:grid-cols-3 2xl:grid-cols-6" : "xl:grid-cols-5"}`}>
      <Stat icon={<MessagesSquare size={18} />} label="Chats running" value={running} hint="active or being processed" tone="accent" />
      <Stat icon={<BookOpenCheck size={18} />} label="Knowledge in force" value={valid} hint={`of ${total} items in total`} tone="accent" />
      <Stat icon={<AlertTriangle size={18} />} label="Incidents open" value={open} hint="not resolved yet" tone={open ? 'warn' : 'neutral'} />
      <Stat icon={<Activity size={18} />} label="Network health" value={pct ?? 0} text={pct == null ? "—" : undefined} suffix="%" hint={pct == null ? 'no elements loaded' : 'elements that are healthy'} tone={tone} />
      {c.endless && <Stat icon={<Sparkles size={18} />} label="Generated chats" value={c.generated_count} hint="made up live after the script" tone="accent" />}
      <Stat icon={<Bot size={18} />} label="Agent calls" value={callCount(c)} hint="by the autonomous system" tone="neutral" />
    </div>
  )
}
