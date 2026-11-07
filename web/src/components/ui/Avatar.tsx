import { initials } from '../../lib/format'
import { cn } from '../../lib/cn'

export function Avatar({ name, color, size = 32, className }: { name: string; color?: string; size?: number; className?: string }) {
  return (
    <span
      title={name}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: color ?? '#64748b' }}
    >
      {initials(name)}
    </span>
  )
}
