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

export function NetworkKey() {
  return (
    <GraphKey
      items={[
        { label: 'Site', swatch: <Swatch color="var(--g-link)" radius={4} /> },
        { label: 'Equipment', swatch: <Swatch color="var(--g-element)" radius={99} fill /> },
        { label: 'Equipment group', swatch: <Swatch color="var(--g-class)" radius={99} /> },
        { label: 'Knowledge', swatch: <Swatch color="var(--g-assertion)" radius={3} /> },
        { label: 'Fibre', swatch: <LineSwatch /> },
        { label: 'Microwave', swatch: <LineSwatch dash="4 3" /> },
        { label: 'Open incident', swatch: <Swatch color="var(--bad)" radius={99} /> },
      ]}
    />
  )
}
