import { initials } from '../../lib/format'
import { cn } from '../../lib/cn'

const FALLBACK = '#475569'

/** Relative luminance of a #rrggbb color (WCAG). Unknown formats count as dark. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** Darkens a #rrggbb color by mixing it with black. */
function darken(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const ch = [0, 2, 4].map((i) => Math.round(parseInt(m[1].slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0'))
  return `#${ch.join('')}`
}

/** Initials on a colored tile. The text is white or near-black, whichever gives the higher contrast (4.5:1 or more). */
export function Avatar({ name, color, size = 32, className }: { name: string; color?: string; size?: number; className?: string }) {
  let bg = color ?? FALLBACK
  let L = luminance(bg)
  let white = 1.05 / (L + 0.05)
  let dark = (L + 0.05) / 0.062
  // Mid-tone colors fail with both: darken the tile a little so white text reaches 4.5:1.
  for (let i = 0; i < 6 && Math.max(white, dark) < 4.5; i++) {
    bg = darken(bg, 0.12)
    L = luminance(bg)
    white = 1.05 / (L + 0.05)
    dark = (L + 0.05) / 0.062
  }
  return (
    <span
      title={name}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-md font-semibold', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: bg, color: white >= dark ? '#ffffff' : '#111318' }}
    >
      {initials(name)}
    </span>
  )
}
