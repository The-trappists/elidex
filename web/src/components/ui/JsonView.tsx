import { cn } from '../../lib/cn'

/** Pretty JSON block (raw LLM output, assertions...). */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return <pre className={cn('overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed', className)}>{text}</pre>
}
