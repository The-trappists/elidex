import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import { create } from 'zustand'
import { cn } from '../../lib/cn'
import { IconButton } from './Button'

type Kind = 'success' | 'error' | 'info'
export interface ToastOptions {
  /** A button inside the toast, e.g. Undo. Clicking it closes the toast. */
  action?: { label: string; onClick: () => void }
  /** How long the toast stays, in ms. */
  duration?: number
}
interface ToastItem {
  id: number
  kind: Kind
  text: string
  action?: ToastOptions['action']
}

const useToasts = create<{ items: ToastItem[]; push: (kind: Kind, text: string, opts?: ToastOptions) => void; close: (id: number) => void }>((set) => ({
  items: [],
  push: (kind, text, opts) => {
    const id = Date.now() + Math.random()
    set((s) => ({ items: [...s.items, { id, kind, text, action: opts?.action }] }))
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), opts?.duration ?? (kind === 'error' ? 7000 : 3500))
  },
  close: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))

/** toast.success('Saved'), toast.error(err), toast.info('...') from anywhere. */
export const toast = {
  success: (text: string) => useToasts.getState().push('success', text),
  info: (text: string, opts?: ToastOptions) => useToasts.getState().push('info', text, opts),
  error: (err: unknown) => useToasts.getState().push('error', err instanceof Error ? err.message : String(err)),
}

/** Wrap an async action: shows an error toast on failure, an optional success toast otherwise. */
export async function withToast<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn()
    if (success) toast.success(success)
    return r
  } catch (e) {
    toast.error(e)
    return undefined
  }
}

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info }
const COLOR = { success: 'text-ok', error: 'text-bad', info: 'text-info' }

export function Toaster() {
  const { items, close } = useToasts()
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => {
        const Icon = ICON[t.kind]
        return (
          <div key={t.id} className="flex items-start gap-2 rounded-md border border-line bg-surface p-3 text-sm shadow-[var(--shadow-md)] animate-slide-in">
            <Icon size={16} className={cn('mt-0.5 shrink-0', COLOR[t.kind])} />
            <span className="flex-1 break-words">{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onClick()
                  close(t.id)
                }}
                className="h-7 rounded-md px-2 text-sm font-medium text-accent hover:bg-accent-soft"
              >
                {t.action.label}
              </button>
            )}
            <IconButton onClick={() => close(t.id)} aria-label="Dismiss notification" className="!size-7">
              <X size={14} />
            </IconButton>
          </div>
        )
      })}
    </div>
  )
}
