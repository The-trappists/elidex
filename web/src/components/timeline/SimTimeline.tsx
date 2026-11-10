// The simulation timeline band: one axis, three lanes of markers, a draggable time cursor and a card that says
// what happened. It drives the page's `at`; it never fetches anything itself.
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CompanyState } from '../../api/types'
import { cn } from '../../lib/cn'
import { Button } from '../ui'
import {
  allDomain,
  clampDomain,
  clusterEvents,
  dayDomain,
  offWindow,
  TIMELINE_KINDS,
  timelineTicks,
  type Domain,
  type TimelineCluster,
  type TimelineEvent,
  type TimelineKind,
} from './timelineModel'

const KIND_LABEL: Record<TimelineKind, string> = {
  knowledge: 'Knowledge',
  closed: 'Closed',
  incident: 'Incident',
  resolved: 'Resolved',
  conversation: 'Conversation',
  agent: 'Agent',
}

const KIND_EVENT: Record<TimelineKind, string> = {
  knowledge: 'Knowledge captured',
  closed: 'Knowledge closed',
  incident: 'Incident opened',
  resolved: 'Incident resolved',
  conversation: 'Conversation',
  agent: 'Agent call',
}

const KIND_COLOR: Record<TimelineKind, string> = {
  knowledge: 'var(--k-knowledge)',
  closed: 'var(--muted)',
  incident: 'var(--bad)',
  resolved: 'var(--ok)',
  conversation: 'var(--k-conversation)',
  agent: 'var(--k-event)',
}

/** Lane and sub-row per kind, so a capture and a closure at the same minute do not sit on each other. */
const LANE: Record<TimelineKind, { lane: number; sub: number }> = {
  knowledge: { lane: 0, sub: 0 },
  closed: { lane: 0, sub: 1 },
  incident: { lane: 1, sub: 0 },
  resolved: { lane: 1, sub: 1 },
  conversation: { lane: 2, sub: 0 },
  agent: { lane: 2, sub: 1 },
}

const sameCluster = (a: TimelineCluster | null, b: TimelineCluster | null) =>
  !!a && !!b && a.kind === b.kind && a.first === b.first && a.last === b.last

function KindMark({ kind }: { kind: TimelineKind }) {
  const color = KIND_COLOR[kind]
  const common = { fill: kind === 'incident' || kind === 'resolved' ? color : 'var(--surface)', stroke: color, strokeWidth: 1.6 }
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="sim-mark">
      {kind === 'knowledge' && <circle cx="6" cy="6" r="4.6" {...common} fill={color} stroke="none" />}
      {kind === 'closed' && <circle cx="6" cy="6" r="4.4" fill="none" stroke={color} strokeWidth="1.6" strokeDasharray="2 1.5" />}
      {kind === 'incident' && <polygon points="6,1.2 11,10.8 1,10.8" {...common} />}
      {kind === 'resolved' && <circle cx="6" cy="6" r="4.6" {...common} />}
      {kind === 'conversation' && <rect x="1.8" y="1.8" width="8.4" height="8.4" rx="1.6" {...common} />}
      {kind === 'agent' && <polygon points="6,0.8 11.2,6 6,11.2 0.8,6" {...common} />}
    </svg>
  )
}

export interface SimTimelineProps {
  events: TimelineEvent[]
  at: Date
  now: Date
  /** `at` follows the sim clock (no cursor of its own). */
  follow: boolean
  onChange: (at: Date) => void
  onReset: () => void
  onSelect?: (event: TimelineEvent) => void
  selectedId?: string | null
  bounds?: { min: number; max: number }
  company?: CompanyState | null
  className?: string
}

export function SimTimeline({ events, at, now, follow, onChange, onReset, onSelect, selectedId, bounds, company, className }: SimTimelineProps) {
  const nowMs = now.getTime()
  const day = useMemo(() => dayDomain(nowMs, company ?? null), [nowMs, company])
  const all = useMemo(() => allDomain(events, nowMs), [events, nowMs])
  const limits = useMemo<Domain>(() => {
    const start = Math.min(bounds?.min ?? all.start, all.start)
    const end = Math.max(bounds?.max ?? all.end, all.end)
    return { start, end }
  }, [bounds?.min, bounds?.max, all])

  const [preset, setPreset] = useState<'day' | 'all' | 'custom'>('day')
  const [domain, setDomain] = useState<Domain>(day)
  const [width, setWidth] = useState(0)
  const [pinned, setPinned] = useState<TimelineCluster | null>(null)
  const [hover, setHover] = useState<TimelineCluster | null>(null)
  const [more, setMore] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; moved: boolean } | null>(null)
  const autoSwitched = useRef(false)

  // A snapshot whose events sit outside today's window: show them once instead of an empty band.
  useEffect(() => {
    if (autoSwitched.current || preset !== 'day' || !events.length) return
    if (events.some((e) => e.at >= day.start && e.at <= day.end)) return
    autoSwitched.current = true
    setPreset('all')
  }, [events, day, preset])

  useEffect(() => {
    if (preset === 'day') setDomain(day)
  }, [preset, day])
  useEffect(() => {
    if (preset === 'all') setDomain(all)
  }, [preset, all])

  // A selection or a chip can move `at` outside the window: recentre on it, keeping the span.
  useEffect(() => {
    if (preset === 'all') return
    const t = at.getTime()
    if (t >= domain.start && t <= domain.end) return
    const span = domain.end - domain.start
    setDomain(clampDomain({ start: t - span / 2, end: t + span / 2 }, limits))
    setPreset('custom')
  }, [at, domain, preset, limits])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const minGap = width > 0 && width < 768 ? 34 : 26
  const clusters = useMemo(() => clusterEvents(events, domain, width || 640, minGap), [events, domain, width, minGap])
  const ticks = useMemo(() => timelineTicks(domain, width || 640), [domain, width])
  const off = useMemo(() => offWindow(events, domain), [events, domain])

  const span = Math.max(1, domain.end - domain.start)
  const pct = (t: number) => ((t - domain.start) / span) * 100
  const px = (t: number) => (pct(t) / 100) * width

  const timeAt = (clientX: number) => {
    const el = trackRef.current
    if (!el) return at.getTime()
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return domain.start + ratio * span
  }
  const moveTo = (t: number) => onChange(new Date(Math.min(limits.end, Math.max(limits.start, t))))

  const nearest = (t: number): TimelineCluster | null => {
    let best: TimelineCluster | null = null
    let bestD = Infinity
    for (const c of clusters) {
      const d = Math.abs(px(c.at) - px(t))
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return bestD <= 16 ? best : null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d) {
      if (!d.moved && Math.abs(e.clientX - d.x) > 3) d.moved = true
      if (d.moved) moveTo(timeAt(e.clientX))
      return
    }
    setHover(nearest(timeAt(e.clientX)))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) return
    const t = timeAt(e.clientX)
    moveTo(t)
    const c = nearest(t)
    setPinned(c)
    if (c) onSelect?.(c.events[0])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const t = at.getTime()
    const step = e.shiftKey ? 15 * 60_000 : 60_000
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moveTo(t - step)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      moveTo(t + step)
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      moveTo(t - 3_600_000)
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      moveTo(t + 3_600_000)
    } else if (e.key === 'Home') {
      e.preventDefault()
      moveTo(domain.start)
    } else if (e.key === 'End') {
      e.preventDefault()
      moveTo(domain.end)
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault()
      onReset()
      setPinned(null)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const c = nearest(at.getTime())
      if (c) {
        setPinned(c)
        onSelect?.(c.events[0])
      }
    } else if (e.key === 'Escape') {
      setPinned(null)
    }
  }

  const zoom = (factor: number, anchor = at.getTime()) => {
    const next = span * factor
    const ratio = Math.min(1, Math.max(0, (anchor - domain.start) / span))
    setDomain(clampDomain({ start: anchor - ratio * next, end: anchor + (1 - ratio) * next }, limits))
    setPreset('custom')
  }

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
        zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, domain.start + ratio * span)
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        const shift = (e.deltaX / Math.max(1, el.clientWidth)) * span
        setDomain(clampDomain({ start: domain.start + shift, end: domain.end + shift }, limits))
        setPreset('custom')
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const recenterNow = () => {
    setDomain(clampDomain({ start: nowMs - span / 2, end: nowMs + span / 2 }, limits))
    setPreset('custom')
  }
  const zoomTo = (c: TimelineCluster) => {
    const next = Math.max(30 * 60_000, (c.last - c.first) * 3)
    setDomain(clampDomain({ start: c.at - next / 2, end: c.at + next / 2 }, limits))
    setPreset('custom')
    setPinned(null)
  }

  const shown = pinned ?? hover
  const shownLeft = width ? Math.min(Math.max(px(shown?.at ?? 0) - 130, 8), Math.max(8, width - 268)) : 8
  const nowIn = nowMs >= domain.start && nowMs <= domain.end
  const first = shown?.events[0]

  return (
    <div className={cn('sim-timeline', className)}>
      <div className="sim-head">
        <div className="sim-presets" role="group" aria-label="Timeline range">
          <button type="button" className="sim-btn" aria-pressed={preset === 'day'} onClick={() => setPreset('day')}>
            Day
          </button>
          <button type="button" className="sim-btn" aria-pressed={preset === 'all'} onClick={() => setPreset('all')}>
            All
          </button>
        </div>
        <div className="sim-zoom" role="group" aria-label="Zoom the timeline">
          <button type="button" className="sim-btn" aria-label="Zoom out" onClick={() => zoom(1.6)}>
            −
          </button>
          <button type="button" className="sim-btn" aria-label="Zoom in" onClick={() => zoom(1 / 1.6)}>
            +
          </button>
        </div>
        {off.earlier > 0 && (
          <button type="button" className="sim-off" onClick={() => setPreset('all')}>
            ‹ {off.earlier} earlier
          </button>
        )}
        {off.later > 0 && (
          <button type="button" className="sim-off" onClick={() => setPreset('all')}>
            {off.later} later ›
          </button>
        )}
        <span className="sim-head-now">
          {follow ? 'Now' : 'Viewing'} · {format(at, 'd MMM yyyy, HH:mm')}
        </span>
      </div>

      <div className="sim-scrubber">
        <input
          className="sim-range"
          type="range"
          min={domain.start}
          max={domain.end}
          step={1000}
          value={Math.min(domain.end, Math.max(domain.start, at.getTime()))}
          aria-label="Time travel"
          aria-valuetext={format(at, 'EEE d MMM yyyy, HH:mm:ss')}
          title="Drag to view the graph at any time. Use arrow keys for minutes, Shift for 15 minutes."
          style={{ '--scrub-progress': `${Math.min(100, Math.max(0, pct(at.getTime())))}%` } as React.CSSProperties}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setPinned(null)
            setHover(null)
            moveTo(Number(e.target.value))
          }}
        />
      </div>

      <div
        ref={trackRef}
        className="sim-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => setHover(null)}
      >
        {nowIn && (
          <>
            <div className="sim-now-line" style={{ left: `${pct(nowMs)}%` }} />
            <span className="sim-now-pill" style={{ left: `${pct(nowMs)}%` }}>
              now
            </span>
          </>
        )}
        {!follow && (
          <>
            <div className="sim-at-line" style={{ left: `${pct(at.getTime())}%` }} />
            <span className="sim-at-pill" style={{ left: `${pct(at.getTime())}%` }}>
              {format(at, 'HH:mm')}
            </span>
          </>
        )}

        {clusters.map((c) => {
          const pos = LANE[c.kind]
          return (
            <span
              key={`${c.kind}:${c.first}:${c.last}`}
              className={cn('sim-marker', sameCluster(pinned, c) && 'is-pinned', selectedId && c.events.some((e) => e.id === selectedId) && 'is-selected')}
              style={{ left: `${pct(c.at)}%`, top: `calc(var(--lane-h) * ${pos.lane} + var(--sub-h) * ${pos.sub})` }}
              aria-hidden="true"
            >
              <KindMark kind={c.kind} />
              {c.events.length > 1 && <span className="sim-count">{c.events.length}</span>}
            </span>
          )
        })}

        <div className="sim-ticks" aria-hidden>
          {ticks.map((t) => (
            <span key={t.at} className={cn('sim-tick', t.major && 'is-major')} style={{ left: `${pct(t.at)}%` }}>
              {t.label}
            </span>
          ))}
        </div>

        {!nowIn && (
          <button type="button" className={cn('sim-now-jump', nowMs < domain.start ? 'is-left' : 'is-right')} onClick={recenterNow}>
            {nowMs < domain.start ? '‹ now' : 'now ›'}
          </button>
        )}

        {shown && (
          <div
            className={cn('sim-card', pinned && 'is-pinned')}
            style={{ left: shownLeft }}
            role={pinned ? 'dialog' : 'tooltip'}
            aria-label={pinned ? 'Timeline event' : undefined}
          >
            <div className="sim-card-head">
              <span>{KIND_EVENT[shown.kind]}</span>
              <span className="tabular-nums">{format(shown.at, 'HH:mm')}</span>
            </div>
            {shown.events.length > 1 ? (
              <>
                <p className="sim-card-title">
                  {shown.events.length} events · {format(shown.first, 'HH:mm')}–{format(shown.last, 'HH:mm')}
                </p>
                <ul className="sim-card-list">
                  {shown.events.slice(0, 3).map((e) => (
                    <li key={e.id}>{e.title}</li>
                  ))}
                </ul>
                {shown.events.length > 3 && <p className="sim-card-more">+{shown.events.length - 3} more</p>}
                <Button size="sm" onClick={() => zoomTo(shown)}>
                  Zoom in
                </Button>
              </>
            ) : (
              <>
                <p className="sim-card-title">{first?.title}</p>
                {first?.detail && <p className="sim-card-detail">{first.detail}</p>}
                {first?.source && <p className="sim-card-source">{first.source}</p>}
                {first?.kind === 'conversation' && first.threadId && (
                  <Link className="sim-card-link" to={`/conversations/${encodeURIComponent(first.threadId)}`}>
                    Open conversation
                  </Link>
                )}
                {(first?.kind === 'knowledge' || first?.kind === 'closed') && first.assertionId && (
                  <Link className="sim-card-link" to={`/knowledge?assertion=${encodeURIComponent(first.assertionId)}`}>
                    Open rule
                  </Link>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="sim-legend">
        {(more ? TIMELINE_KINDS : TIMELINE_KINDS.slice(0, 3)).map((k) => (
          <span key={k}>
            <KindMark kind={k} />
            {KIND_LABEL[k]}
          </span>
        ))}
        <button type="button" className="sim-more" aria-expanded={more} onClick={() => setMore(!more)}>
          More
        </button>
      </div>
      {!clusters.length && <p className="sim-empty">No events in this range.</p>}
    </div>
  )
}

/** The heading chip: what time the page is showing, and the way back to now. */
export function TimeChip({ at, now, follow, onReset }: { at: Date; now: Date; follow: boolean; onReset: () => void }) {
  const rel = at.getTime() - now.getTime()
  const state = Math.abs(rel) < 30 * 60_000 ? 'now' : rel < 0 ? 'past' : 'future'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs" aria-live="polite">
        <span className={cn('size-1.5 rounded-full', follow ? 'bg-accent' : 'bg-warn')} aria-hidden />
        {follow ? 'As of now' : `As of ${format(at, 'd MMM yyyy, HH:mm')}`}
        {!follow && state !== 'now' && <span className="text-muted">{state}</span>}
      </span>
      {!follow && (
        <Button size="sm" onClick={onReset}>
          Back to now
        </Button>
      )}
    </div>
  )
}
