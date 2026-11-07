import type { ReactNode } from 'react'

/** A quiet, always-visible key. It explains the picture; it is not a control. */
export function GraphKey({ items }: { items: { label: string; swatch: ReactNode }[] }) {
  return (
    <ul className="graph-key" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label}>
          {i.swatch}
          <span>{i.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** A small shape: `radius` 99 gives a pill, `dashed` a dashed outline. */
export function Swatch({ color, radius = 3, dashed, fill }: { color: string; radius?: number; dashed?: boolean; fill?: boolean }) {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" className="shrink-0" aria-hidden>
      <rect
        x="1"
        y="1"
        width="14"
        height="10"
        rx={Math.min(radius, 5)}
        fill={fill ? color : 'var(--surface)'}
        stroke={color}
        strokeWidth="1.6"
        strokeDasharray={dashed ? '3 2' : undefined}
      />
    </svg>
  )
}

export function LineSwatch({ color = 'var(--g-link)', dash }: { color?: string; dash?: string }) {
  return (
    <svg width="18" height="8" className="shrink-0" aria-hidden>
      <line x1="1" y1="4" x2="17" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  )
}

/** A node shape as drawn on the force canvas. */
export function ShapeSwatch({ color, shape, dot }: { color: string; shape: 'circle' | 'square' | 'hexagon' | 'triangle' | 'diamond'; dot?: boolean }) {
  const common = { fill: 'var(--surface)', stroke: color, strokeWidth: 1.6 }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0" aria-hidden>
      {shape === 'circle' && <circle cx="7" cy="7" r="5.5" {...common} />}
      {shape === 'square' && <rect x="1.5" y="1.5" width="11" height="11" rx="2" {...common} />}
      {shape === 'hexagon' && <polygon points="12.5,7 9.75,11.76 4.25,11.76 1.5,7 4.25,2.24 9.75,2.24" {...common} />}
      {shape === 'triangle' && <polygon points="7,1.5 12.8,12 1.2,12" {...common} />}
      {shape === 'diamond' && <polygon points="7,0.8 13.2,7 7,13.2 0.8,7" {...common} />}
      {dot && <circle cx="7" cy="7" r="3" fill={color} stroke="none" />}
    </svg>
  )
}
