import { addDays } from 'date-fns'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Pattern } from '../api/types'
import { Inspector } from '../components/graph/Inspector'
import type { NodeKind } from '../components/graph/graphModel'
import { GraphWorkspace } from '../components/graph/GraphWorkspace'
import { NetworkHealthStrip, SitesList } from '../components/network/NetworkChrome'
import { TopologyGraph, TopologyKey } from '../components/force/TopologyGraph'
import { knowledgeTargets } from '../components/force/models'
import { CorrelationsChip } from '../components/insights/CorrelationsChip'
import { PatternDrawer } from '../components/insights/PatternDrawer'
import { patternIndex } from '../components/insights/patternIndex'
import { usePatterns } from '../components/insights/usePatterns'
import { SimTimeline, TimeChip } from '../components/timeline/SimTimeline'
import { threadEntityIndex, type TimelineEvent } from '../components/timeline/timelineModel'
import { useTimelineEvents } from '../components/timeline/useTimeline'
import { useCompanyDay } from '../lib/useCompanyDay'
import { useSimNow } from '../lib/useNow'
import { useDemo } from '../store/demo'
import { useLive } from '../store/live'

const HOUR = 3_600_000

export default function NetworkPage() {
  const [params, setParams] = useSearchParams()
  // Round to the second so memoized values do not recompute on every render.
  const nowSec = Math.floor((useSimNow(5000) ?? new Date()).getTime() / 1000)
  const now = useMemo(() => new Date(nowSec * 1000), [nowSec])
  const [t, setT] = useState<Date | null>(null) // null = follow sim now
  const [drawer, setDrawer] = useState(false)
  const [focusPattern, setFocusPattern] = useState<Pattern | null>(null)
  const assertions = useLive((s) => s.assertions)
  const incidents = useLive((s) => s.incidents)
  const threads = useLive((s) => s.threads)
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const classes = useLive((s) => s.classes)
  const publicDemo = useDemo((s) => s.status?.enabled ?? false)
  const company = useCompanyDay()
  const events = useTimelineEvents()
  const { patterns } = usePatterns()
  const correlations = useMemo(() => patternIndex(patterns), [patterns])

  const at = t ?? now
  const min = useMemo(() => {
    const from = Object.values(assertions).map((a) => new Date(a.valid_from).getTime())
    return Math.min(...from, now.getTime() - 30 * 24 * HOUR)
  }, [assertions, now])
  const max = addDays(now, 30).getTime()

  const selectedId = params.get('select')
  const kind: NodeKind | null = !selectedId
    ? null
    : elements.some((e) => e.id === selectedId)
      ? 'element'
      : sites.some((s) => s.id === selectedId)
        ? 'site'
        : classes[selectedId]
          ? 'class'
          : assertions[selectedId]
            ? 'assertion'
            : null
  const select = (id: string | null) => setParams(id ? { select: id } : {}, { replace: true })
  // A group or a piece of knowledge is not drawn: light up the equipment it applies to instead.
  const highlightIds = useMemo(
    () => (selectedId && (kind === 'class' || kind === 'assertion') ? knowledgeTargets(selectedId, { elements, classes, assertions }) : []),
    [selectedId, kind, elements, classes, assertions],
  )

  const threadEntity = useMemo(() => threadEntityIndex(threads, incidents), [threads, incidents])
  const onTimelineSelect = (e: TimelineEvent) => {
    const id = e.kind === 'conversation' ? (e.entityId ?? (e.threadId ? threadEntity.get(e.threadId) : undefined)) : (e.assertionId ?? e.entityId)
    if (id) select(id)
  }

  const insight = focusPattern ? { problem: focusPattern.elements, suspect: focusPattern.suspects, links: focusPattern.links } : null

  return (
    <>
      <GraphWorkspace
        title="Network"
        description="Sites, equipment and what is happening."
        variant="compact"
        actions={
          <>
            <CorrelationsChip patterns={patterns} onOpen={() => setDrawer(true)} />
            <TimeChip at={at} now={now} follow={t === null} onReset={() => setT(null)} />
          </>
        }
        selected={!!kind}
        onClear={() => select(null)}
        toolbar={null}
        status={<NetworkHealthStrip company={company} incidents={incidents} at={at} now={now} />}
        timeline={
          <SimTimeline
            events={events}
            at={at}
            now={now}
            follow={t === null}
            onChange={setT}
            onReset={() => setT(null)}
            onSelect={onTimelineSelect}
            selectedId={selectedId}
            bounds={{ min, max }}
            company={company}
          />
        }
        legend={<TopologyKey compact />}
        canvas={
          <TopologyGraph
            at={at}
            selectedId={kind === 'element' || kind === 'site' ? selectedId : null}
            highlightIds={highlightIds}
            onSelect={select}
            correlations={correlations}
            insight={insight}
          />
        }
        browse={<SitesList at={at} selectedId={selectedId} onSelect={select} company={company} />}
        details={
          <Inspector
            id={selectedId}
            kind={kind}
            at={at}
            summary={publicDemo}
            onSelect={(id) => select(id)}
            patterns={patterns}
            onOpenPattern={(p) => {
              setFocusPattern(p)
              setDrawer(true)
            }}
          />
        }
      />
      <PatternDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        patterns={patterns}
        threads={threads}
        selectedId={focusPattern?.id}
        onFocus={setFocusPattern}
        publicDemo={publicDemo}
      />
    </>
  )
}
