import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ClassCriteria, ContextAssertion, Pattern } from '../../api/types'
import { MousePointerClick } from 'lucide-react'
import { fmtAgo } from '../../lib/format'
import { ORIGIN_STYLE, SEVERITY_STYLE, TYPE_STYLE } from '../../lib/semantic'
import { useLive } from '../../store/live'
import { CorrelationBlock } from '../insights/CorrelationBlock'
import { incidentOpenAt } from '../timeline/timelineModel'
import { useContextHits } from '../incidents/useContextHits'
import { Badge, Button, EmptyState, IdChip, Toggle } from '../ui'
import { ContextCard } from './ContextCard'
import { HumanActivity } from './HumanActivity'
import { Experts, Provenance, Reach, Timeline } from './GraphSections'
import { classMembers, classesOf, type NodeKind } from './graphModel'

const Section = ({ title, count, children, action }: { title: string; count?: number; children: ReactNode; action?: ReactNode }) => (
  <section className="border-b border-line px-4 py-3 last:border-0">
    <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <h4 className="text-xs font-medium text-muted">{title}</h4>
      {count !== undefined && <span className="rounded bg-surface-2 px-1 text-xs text-muted">{count}</span>}
      <div className="ml-auto">{action}</div>
    </div>
    {children}
  </section>
)

const None = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted">{children}</p>

const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex justify-between gap-3 py-0.5 text-xs">
    <span className="text-muted">{k}</span>
    <span className="text-right font-medium">{v}</span>
  </div>
)

const critText = (c: ClassCriteria) =>
  [c.type, c.model, c.install_year_min != null || c.install_year_max != null ? `installed ${c.install_year_min ?? '…'}–${c.install_year_max ?? '…'}` : null].filter(Boolean).join(' · ') || 'any element'

const bound = (a: ContextAssertion, id: string) => a.bound_to.some((b) => b.entity === id && b.role !== 'trigger')

export function Inspector({
  id,
  kind,
  at,
  onSelect,
  patterns,
  onOpenPattern,
}: {
  id: string | null
  kind: NodeKind | null
  at: Date
  onSelect: (id: string, kind: NodeKind) => void
  patterns?: Pattern[]
  onOpenPattern?: (p: Pattern) => void
}) {
  if (!id || !kind)
    return <EmptyState icon={<MousePointerClick size={26} />} title="Select a node" hint="Click an element, site, class or piece of knowledge in the graph to see what is known about it at the chosen time." />
  const props = { id, at, onSelect, patterns, onOpenPattern }
  return kind === 'element' ? <ElementInfo {...props} /> : kind === 'site' ? <SiteInfo {...props} /> : kind === 'class' ? <ClassInfo {...props} /> : <AssertionInfo {...props} />
}

type P = { id: string; at: Date; onSelect: (id: string, kind: NodeKind) => void; patterns?: Pattern[]; onOpenPattern?: (p: Pattern) => void }

/** What the open correlations say about this node. Hypotheses only; the drawer has the detail. */
function CorrelationSection({ id, patterns, onOpen }: { id: string; patterns?: Pattern[]; onOpen?: (p: Pattern) => void }) {
  return <CorrelationBlock id={id} patterns={patterns} onOpen={onOpen} className="border-b border-line px-4 py-3 last:border-0" />
}

function Title({ kind, title, sub }: { kind: string; title: string; sub?: ReactNode }) {
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="text-xs font-medium text-muted">{kind}</div>
      <div className="break-words text-base font-semibold">{title}</div>
      {sub && <div className="mt-1 flex flex-wrap items-center gap-1.5">{sub}</div>}
    </div>
  )
}

function ElementInfo({ id, at, onSelect, patterns, onOpenPattern }: P) {
  const nav = useNavigate()
  const el = useLive((s) => s.elements.find((e) => e.id === id))
  const sites = useLive((s) => s.sites)
  const classes = useLive((s) => s.classes)
  const incidents = useLive((s) => s.incidents)
  const threads = useLive((s) => s.threads)
  const [expired, setExpired] = useState(false)
  const { hits, loading } = useContextHits(id, at, expired)

  const mine = useMemo(() => Object.values(incidents).filter((i) => i.entity_id === id).sort((a, b) => b.opened_at.localeCompare(a.opened_at)), [incidents, id])
  const mentioning = useMemo(() => {
    if (!el) return []
    const keys = [el.id, ...el.aliases].filter(Boolean).map((k) => k.toLowerCase())
    return Object.values(threads).filter((t) => t.messages.some((m) => keys.some((k) => m.text.toLowerCase().includes(k))))
  }, [threads, el])

  if (!el) return <EmptyState title="Element not found" hint={id} />
  const site = sites.find((s) => s.id === el.site_id)
  const its = classesOf(el, Object.values(classes))
  return (
    <div>
      <Title kind="Equipment" title={el.id} sub={<Badge className={ORIGIN_STYLE[el.origin].cls}>{ORIGIN_STYLE[el.origin].label}</Badge>} />
      <CorrelationSection id={id} patterns={patterns} onOpen={onOpenPattern} />
      <Section title="Details">
        <Row k="Type" v={el.type.replace(/_/g, ' ')} />
        <Row k="Model" v={el.model} />
        <Row k="Installed" v={el.install_year} />
        <Row k="Firmware" v={el.firmware ?? '—'} />
        <Row k="Site" v={site ? <button className="text-accent hover:underline" onClick={() => onSelect(site.id, 'site')}>{site.name}</button> : (el.site_id ?? '—')} />
        {el.aliases.length > 0 && <Row k="Aliases" v={el.aliases.join(', ')} />}
      </Section>
      <Section title="Equipment groups" count={its.length}>
        {its.length ? <div className="flex flex-wrap gap-1.5">{its.map((c) => <IdChip key={c.id} onClick={() => onSelect(c.id, 'class')}>{c.label}</IdChip>)}</div> : <None>Not in any known class.</None>}
      </Section>
      <Section title="Context at the selected time" count={hits?.length} action={<Toggle checked={expired} onChange={setExpired} label={<span className="text-xs text-muted">Include expired</span>} />}>
        {hits === null || (loading && !hits.length) ? (
          <div className="h-16 animate-pulse rounded-md bg-surface-2" />
        ) : hits.length ? (
          <div className="space-y-2">{hits.map((h) => <ContextCard key={h.id} a={h} at={at} />)}</div>
        ) : (
          <None>Nothing known about {id} at this time.</None>
        )}
      </Section>
      <Section title="Human activity">
        <HumanActivity
          id={id}
          defaultQuery={`${el.type.replace(/_/g, ' ')} ${el.model} installed ${el.install_year}`}
          onSelectKnowledge={(aid) => { if (useLive.getState().assertions[aid]) onSelect(aid, 'assertion') }}
        />
      </Section>
      <Section title="History of advice">
        <Timeline entityId={id} at={at} onSelect={(aid) => onSelect(aid, 'assertion')} />
      </Section>
      <Section title="Who to ask">
        <Experts entityId={id} at={at} />
      </Section>
      <Section title="Incidents" count={mine.length}>
        {mine.length ? (
          <ul className="space-y-1.5">
            {mine.map((i) => {
              const open = incidentOpenAt(i, at)
              return (
                <li key={i.id} className="rounded-md border border-line p-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Badge className={SEVERITY_STYLE[i.severity].cls}>{SEVERITY_STYLE[i.severity].label}</Badge>
                    <span className="font-medium">{i.kind}</span>
                    <Badge className={open ? 'ml-auto bg-bad/15 text-bad' : 'ml-auto bg-ok/15 text-ok'}>{open ? 'open' : 'resolved'}</Badge>
                  </div>
                  <p className="mt-1 text-muted">{i.summary}</p>
                  <div className="mt-1 text-xs text-muted">{fmtAgo(i.opened_at, at)}</div>
                </li>
              )
            })}
          </ul>
        ) : <None>No incident on this element.</None>}
      </Section>
      <Section title="Conversations mentioning it" count={mentioning.length}>
        {mentioning.length ? (
          <ul className="space-y-1">
            {mentioning.map((t) => (
              <li key={t.id}>
                <button className="w-full truncate rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2" onClick={() => nav(`/conversations/${encodeURIComponent(t.id)}`)}>
                  {t.subject ?? t.id}
                </button>
              </li>
            ))}
          </ul>
        ) : <None>No conversation mentions {id}.</None>}
      </Section>
    </div>
  )
}

function SiteInfo({ id, at, onSelect, patterns, onOpenPattern }: P) {
  const site = useLive((s) => s.sites.find((x) => x.id === id))
  const elements = useLive((s) => s.elements)
  const assertions = useLive((s) => s.assertions)
  if (!site) return <EmptyState title="Site not found" hint={id} />
  const els = elements.filter((e) => e.site_id === id)
  const as = Object.values(assertions).filter((a) => bound(a, id))
  return (
    <div>
      <Title kind="Site" title={site.name} sub={<IdChip>{site.id}</IdChip>} />
      <CorrelationSection id={id} patterns={patterns} onOpen={onOpenPattern} />
      <Section title="Details">
        <Row k="Region" v={site.region ?? '—'} />
        <Row k="Origin" v={ORIGIN_STYLE[site.origin].label} />
        {site.lat != null && site.lon != null && <Row k="Position" v={`${site.lat.toFixed(3)}, ${site.lon.toFixed(3)}`} />}
      </Section>
      <Section title="Elements" count={els.length}>
        {els.length ? <div className="flex flex-wrap gap-1.5">{els.map((e) => <IdChip key={e.id} onClick={() => onSelect(e.id, 'element')}>{e.id}</IdChip>)}</div> : <None>No element on this site.</None>}
      </Section>
      <Section title="Knowledge about this site" count={as.length}>
        {as.length ? <div className="space-y-2">{as.map((a) => <ContextCard key={a.id} a={a} at={at} />)}</div> : <None>Nothing is bound to this site.</None>}
      </Section>
    </div>
  )
}

function ClassInfo({ id, at, onSelect, patterns, onOpenPattern }: P) {
  const cls = useLive((s) => s.classes[id])
  const elements = useLive((s) => s.elements)
  const assertions = useLive((s) => s.assertions)
  if (!cls) return <EmptyState title="Class not found" hint={id} />
  const members = classMembers(cls, elements)
  const as = Object.values(assertions).filter((a) => bound(a, id))
  return (
    <div>
      <Title kind="Class of elements" title={cls.label} sub={<IdChip>{cls.id}</IdChip>} />
      <CorrelationSection id={id} patterns={patterns} onOpen={onOpenPattern} />
      <Section title="Criteria"><p className="text-xs">{critText(cls.criteria)}</p></Section>
      <Section title="Members" count={members.length}>
        {members.length ? <div className="flex flex-wrap gap-1.5">{members.map((e) => <IdChip key={e.id} onClick={() => onSelect(e.id, 'element')}>{e.id}</IdChip>)}</div> : <None>No element matches this class.</None>}
      </Section>
      <Section title="Knowledge about this group of equipment" count={as.length}>
        {as.length ? <div className="space-y-2">{as.map((a) => <ContextCard key={a.id} a={a} at={at} />)}</div> : <None>No assertion is bound to this class.</None>}
      </Section>
    </div>
  )
}

function AssertionInfo({ id, at, onSelect, patterns, onOpenPattern }: P) {
  const nav = useNavigate()
  const a = useLive((s) => s.assertions[id])
  if (!a) return <EmptyState title="Knowledge not found" hint={id} />
  return (
    <div>
      <Title kind="Knowledge" title={a.topic} sub={<><Badge className={TYPE_STYLE[a.type].cls}>{TYPE_STYLE[a.type].label}</Badge><IdChip>{a.id}</IdChip></>} />
      <CorrelationSection id={id} patterns={patterns} onOpen={onOpenPattern} />
      <div className="p-4">
        <ContextCard a={a} at={at} />
        <Button className="mt-3 w-full" onClick={() => nav(`/knowledge?assertion=${encodeURIComponent(a.id)}`)}>Open in Knowledge</Button>
      </div>
      <Section title="Where it comes from">
        <Provenance assertionId={a.id} />
      </Section>
      <Section title="What it reaches">
        <Reach assertionId={a.id} onSelect={(el) => onSelect(el, 'element')} />
      </Section>
    </div>
  )
}
