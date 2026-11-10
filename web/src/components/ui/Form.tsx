import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

// Full width unless the caller sets its own w-* class (clsx does not resolve Tailwind conflicts).
const width = (className?: string) => (/(^|\s)!?w-/.test(className ?? '') ? '' : 'w-full')

const BASE =
  'rounded-md border border-line-strong bg-surface px-2.5 text-sm text-text transition placeholder:text-muted hover:border-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(BASE, width(className), 'h-9', className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(BASE, width(className), 'py-2', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(BASE, width(className), 'h-9 pr-8', className)} {...rest}>
      {children}
    </select>
  )
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm', disabled && 'pointer-events-none opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-10 shrink-0 rounded-full border border-line-strong transition', checked ? 'bg-accent' : 'bg-surface-3')}
      >
        <span className={cn('absolute top-1 size-4 rounded-full border border-line-strong bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-1')} />
      </button>
      {label}
    </label>
  )
}
