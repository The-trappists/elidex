import { PageIntro } from '../components/layout/PageIntro'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AssertionType, TrustLevel } from '../api/types'
import { AssertionDrawer } from '../components/knowledge/AssertionDrawer'
import { AssertionTable } from '../components/knowledge/AssertionTable'
import { ASSERTION_TYPES, isValidAt, TRUST_LEVELS } from '../components/knowledge/bits'
import { ExportMenu } from '../components/knowledge/ExportMenu'
import { MergesBadge } from '../components/knowledge/MergesDrawer'
import { Timeline } from '../components/knowledge/Timeline'
import { FilterMenu, Input, Select, Tabs, Toggle } from '../components/ui'
import { TRUST_STYLE, TYPE_STYLE } from '../lib/semantic'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

type Tab = 'table' | 'timeline'

export default function KnowledgePage() {
  const assertions = useLive((s) => s.assertions)
  const threads = useLive((s) => s.threads)
  const now = useSimNow(30_000)
  const [params, setParams] = useSearchParams()
  const openId = params.get('assertion')
  const [tab, setTab] = useState<Tab>('table')
  const [q, setQ] = useState('')
  const [type, setType] = useState<AssertionType | ''>('')
  const [trust, setTrust] = useState<TrustLevel | ''>('')
  const [validNow, setValidNow] = useState(false)
  const [thread, setThread] = useState('')

  const all = useMemo(() => Object.values(assertions), [assertions])
  const sourceThreads = useMemo(() => [...new Set(all.flatMap((a) => a.sources.map((s) => s.file)))].sort(), [all])
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return all
      .filter((a) => (!type || a.type === type) && (!trust || a.trust.level === trust) && (!validNow || isValidAt(a, now)) && (!thread || a.sources.some((s) => s.file === thread)))
      .filter((a) => !ql || `${a.id} ${a.topic} ${a.summary} ${a.bound_to.map((b) => b.entity).join(' ')}`.toLowerCase().includes(ql))
      .sort((a, b) => a.valid_from.localeCompare(b.valid_from))
  }, [all, q, type, trust, validNow, thread, now])

  const filterControls = (wide: string) => (
    <>
      <Select aria-label="Knowledge type" className={wide ? 'w-32' : ''} value={type} onChange={(e) => setType(e.target.value as AssertionType | '')}>
        <option value="">All types</option>
        {ASSERTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_STYLE[t].label}</option>)}
      </Select>
      <Select aria-label="Reliability" className={wide ? 'w-36' : ''} value={trust} onChange={(e) => setTrust(e.target.value as TrustLevel | '')}>
        <option value="">Any reliability</option>
        {TRUST_LEVELS.map((t) => <option key={t} value={t}>{TRUST_STYLE[t].label}</option>)}
      </Select>
      <Select aria-label="Source conversation" className={wide ? 'w-44' : ''} value={thread} onChange={(e) => setThread(e.target.value)}>
        <option value="">Any conversation</option>
        {sourceThreads.map((t) => <option key={t} value={t}>{threads[t]?.subject ?? t}</option>)}
      </Select>
      <Toggle checked={validNow} onChange={setValidNow} label="Valid now" />
    </>
  )
  const open = (id: string) => setParams((current) => {
    const next = new URLSearchParams(current)
    next.set('assertion', id)
    return next
  })
  const close = () => setParams((current) => {
    const next = new URLSearchParams(current)
    next.delete('assertion')
    return next
  })

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 [@media(max-height:700px)]:hidden">
        <PageIntro title="What the network remembers" description="Find advice, check its source and validity, or open the Agent tester to try it on a case." />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line bg-surface px-3 py-2 sm:flex md:px-4">
        <Tabs<Tab>
          className="min-w-0"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'table', label: 'Knowledge library', count: rows.length },
            { id: 'timeline', label: 'Timeline' },
          ]}
        />
        <div className="relative col-start-1 row-start-2 min-w-0 flex-1 sm:ml-1 sm:min-w-32 xl:max-w-64">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
          <Input className="pl-8" aria-label="Search knowledge" placeholder="Search knowledge" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="hidden shrink-0 items-center gap-2 min-[1366px]:flex">{filterControls('min-[1366px]')}</div>
        <FilterMenu className="col-start-2 row-start-2 min-[1366px]:hidden" count={[type, trust, thread].filter(Boolean).length + (validNow ? 1 : 0)}>{filterControls('')}</FilterMenu>
        <div className="col-start-2 row-start-1 ml-auto flex shrink-0 items-center gap-2">
          <MergesBadge />
          <ExportMenu />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg">
        {tab === 'table' && <div className="min-h-full bg-surface"><AssertionTable rows={rows} selected={openId} onOpen={open} /></div>}
        {tab === 'timeline' && <Timeline rows={rows} now={now} onOpen={open} />}
      </div>
      <AssertionDrawer id={openId} assertion={openId ? assertions[openId] : undefined} onClose={close} />
    </div>
  )
}
