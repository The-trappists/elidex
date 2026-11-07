import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:opacity-90 shadow-sm',
  secondary: 'bg-surface border border-line text-text hover:bg-surface-2',
  ghost: 'text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-surface border border-bad/40 text-bad hover:bg-bad hover:text-white hover:border-bad',
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
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-xs max-md:h-8' : 'h-8 px-3 text-sm',
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

/** Icon-only button: 32px hit area, and an aria-label is required. */
export function IconButton({ className, 'aria-label': label, title, ...rest }: Omit<ButtonProps, 'aria-label'> & { 'aria-label': string }) {
  return <Button variant="ghost" aria-label={label} title={title ?? label} className={cn('!size-8 !p-0', className)} {...rest} />
}
