import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { TYPE_STYLE } from '../../lib/semantic'
import type { AssertionType } from '../../api/types'

function Shape({ kind }: { kind: 'tn' | 'ru' | 'rt' | 'site' | 'class' | 'diamond' }) {
  const c = 'fill-[var(--g-element)] stroke-none'
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" className="shrink-0">
      {kind === 'tn' && <rect x="2" y="3" width="12" height="8" rx="2" className={c} />}
      {kind === 'ru' && <polygon points="8,1 14,13 2,13" className={c} />}
      {kind === 'rt' && <polygon points="4,1 12,1 15,7 12,13 4,13 1,7" className={c} />}
      {kind === 'site' && <rect x="1" y="2" width="14" height="10" rx="2" fill="none" stroke="var(--g-link)" strokeDasharray="3 2" />}
      {kind === 'class' && <rect x="1" y="3" width="14" height="8" rx="4" fill="none" stroke="var(--g-class)" strokeWidth="1.5" />}
      {kind === 'diamond' && <polygon points="8,1 14,7 8,13 2,7" fill="var(--g-assertion)" />}
    </svg>
  )
}

function Line({ dash }: { dash?: string }) {
  return (
    <svg width="16" height="6" className="shrink-0">
      <line x1="0" y1="3" x2="16" y2="3" stroke="var(--g-link)" strokeWidth="2" strokeDasharray={dash} />
    </svg>
  )
}

export function GraphLegend({ knowledge }: { knowledge: boolean }) {
  const [open, setOpen] = useState(false)
  const Row = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="flex items-center gap-1.5">
      {icon}
      <span>{children}</span>
    </div>
  )
  return (
    <div className="absolute bottom-2 left-2 rounded-xl border border-line bg-surface/90 text-xs text-muted shadow-sm backdrop-blur">
      <button className="flex w-full items-center gap-1 px-2.5 py-1.5 font-medium text-text" onClick={() => setOpen(!open)}>
        Legend {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-2.5 pb-2">
          <Row icon={<Shape kind="tn" />}>Transmission node</Row>
          <Row icon={<Shape kind="ru" />}>Radio unit</Row>
          <Row icon={<Shape kind="rt" />}>Router / switch</Row>
          <Row icon={<Shape kind="site" />}>Site</Row>
          <Row icon={<Line />}>Fibre</Row>
          <Row icon={<Line dash="4 3" />}>Microwave</Row>
          <Row icon={<Line dash="1 3" />}>Backhaul</Row>
          <Row icon={<span className="inline-block size-3 rounded-full border-2 border-bad" />}>Open incident</Row>
          {knowledge && (
            <>
              <Row icon={<Shape kind="class" />}>Class of elements</Row>
              {(Object.keys(TYPE_STYLE) as AssertionType[]).map((t) => (
                <Row key={t} icon={<span className="inline-block size-2.5 rotate-45" style={{ background: TYPE_STYLE[t].hex }} />}>
                  {TYPE_STYLE[t].label}
                </Row>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
