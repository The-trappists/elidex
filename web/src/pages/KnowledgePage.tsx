import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AssertionType, TrustLevel } from '../api/types'
import { AgentTester } from '../components/knowledge/AgentTester'
import { AssertionDrawer } from '../components/knowledge/AssertionDrawer'
import { AssertionTable } from '../components/knowledge/AssertionTable'
import { ASSERTION_TYPES, isValidAt, TRUST_LEVELS } from '../components/knowledge/bits'
import { Timeline } from '../components/knowledge/Timeline'
import { Input, Select, Tabs, Toggle, Toolbar } from '../components/ui'
import { TRUST_STYLE, TYPE_STYLE } from '../lib/semantic'
import { useSimNow } from '../lib/useNow'
import { useLive } from '../store/live'

type Tab = 'table' | 'timeline' | 'agent'

export default function KnowledgePage() {
  const assertions = useLive((s) => s.assertions)
  const threads = useLive((s) => s.threads)
  const now = useSimNow(30_000)
  const [params, setParams] = useSearchParams()
  const openId = params.get('assertion')
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'agent' ? 'agent' : 'table')
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

  // A link such as /knowledge?tab=agent switches tab even when the page is already open.
  const tabParam = params.get('tab')
  useEffect(() => {
    if (tabParam === 'agent') setTab('agent')
  }, [tabParam])

  const open = (id: string) => setParams({ assertion: id })
  const close = () => setParams({})

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { id: 'table', label: 'Table', count: rows.length },
            { id: 'timeline', label: 'Timeline' },
            { id: 'agent', label: 'Agent tester' },
          ]}
        />
        {tab !== 'agent' && (
          <>
            <div className="relative ml-2 w-56">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
              <Input className="pl-8" placeholder="Search knowledge" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select className="w-36" value={type} onChange={(e) => setType(e.target.value as AssertionType | '')}>
              <option value="">All types</option>
              {ASSERTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_STYLE[t].label}</option>)}
            </Select>
            <Select className="w-36" value={trust} onChange={(e) => setTrust(e.target.value as TrustLevel | '')}>
              <option value="">All trust</option>
              {TRUST_LEVELS.map((t) => <option key={t} value={t}>{TRUST_STYLE[t].label}</option>)}
            </Select>
            <Select className="w-52" value={thread} onChange={(e) => setThread(e.target.value)}>
              <option value="">All source threads</option>
              {sourceThreads.map((t) => <option key={t} value={t}>{threads[t]?.subject ?? t}</option>)}
            </Select>
            <Toggle checked={validNow} onChange={setValidNow} label="Valid now" />
          </>
        )}
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto bg-bg">
        {tab === 'table' && <div className="min-h-full bg-surface"><AssertionTable rows={rows} selected={openId} onOpen={open} /></div>}
        {tab === 'timeline' && <Timeline rows={rows} now={now} onOpen={open} />}
        {tab === 'agent' && <AgentTester />}
      </div>
      <AssertionDrawer id={openId} assertion={openId ? assertions[openId] : undefined} onClose={close} />
    </div>
  )
}
