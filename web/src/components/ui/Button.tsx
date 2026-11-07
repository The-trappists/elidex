import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-sm hover:brightness-110 hover:shadow-[var(--glow)] active:brightness-95',
  secondary: 'bg-surface border border-line text-text hover:bg-surface-2 hover:border-accent/40',
  ghost: 'text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-bad text-white hover:brightness-110 active:brightness-95',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        VARIANT[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ className, ...rest }: ButtonProps) {
  return <Button variant="ghost" size="sm" className={cn('!px-1.5', className)} {...rest} />
}
