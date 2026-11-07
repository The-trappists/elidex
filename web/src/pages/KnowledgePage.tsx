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
import { Input, Select, Tabs, Toggle } from '../components/ui'
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

  const open = (id: string) => setParams({ assertion: id })
  const close = () => setParams({})

  return (
    <div className="flex h-full flex-col">
      <PageIntro title="What the network remembers" description="Find advice, check its source and validity, or open the Agent tester to try it on a case." />
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <Tabs<Tab>
          className="!overflow-visible"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'table', label: 'Knowledge library', count: rows.length },
            { id: 'timeline', label: 'Timeline' },
          ]}
        />
        {(
          <>
            <div className="relative ml-2 w-44">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
              <Input className="pl-8" aria-label="Search knowledge" placeholder="Search knowledge" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select aria-label="Knowledge type" className="w-32" value={type} onChange={(e) => setType(e.target.value as AssertionType | '')}>
              <option value="">All types</option>
              {ASSERTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_STYLE[t].label}</option>)}
            </Select>
            <Select aria-label="Reliability" className="w-36" value={trust} onChange={(e) => setTrust(e.target.value as TrustLevel | '')}>
              <option value="">Any reliability</option>
              {TRUST_LEVELS.map((t) => <option key={t} value={t}>{TRUST_STYLE[t].label}</option>)}
            </Select>
            <Select aria-label="Source conversation" className="w-44" value={thread} onChange={(e) => setThread(e.target.value)}>
              <option value="">Any conversation</option>
              {sourceThreads.map((t) => <option key={t} value={t}>{threads[t]?.subject ?? t}</option>)}
            </Select>
            <Toggle checked={validNow} onChange={setValidNow} label="Valid now" />
            <div className="ml-auto flex items-center gap-2">
              <MergesBadge />
              <ExportMenu />
            </div>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg">
        {tab === 'table' && <div className="min-h-full bg-surface"><AssertionTable rows={rows} selected={openId} onOpen={open} /></div>}
        {tab === 'timeline' && <Timeline rows={rows} now={now} onOpen={open} />}
      </div>
      <AssertionDrawer id={openId} assertion={openId ? assertions[openId] : undefined} onClose={close} />
    </div>
  )
}
