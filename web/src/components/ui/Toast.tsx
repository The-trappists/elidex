import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import { create } from 'zustand'
import { cn } from '../../lib/cn'

type Kind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: Kind
  text: string
}

const useToasts = create<{ items: ToastItem[]; push: (kind: Kind, text: string) => void; close: (id: number) => void }>((set) => ({
  items: [],
  push: (kind, text) => {
    const id = Date.now() + Math.random()
    set((s) => ({ items: [...s.items, { id, kind, text }] }))
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500)
  },
  close: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))

/** toast.success('Saved'), toast.error(err), toast.info('...') from anywhere. */
export const toast = {
  success: (text: string) => useToasts.getState().push('success', text),
  info: (text: string) => useToasts.getState().push('info', text),
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
    <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {items.map((t) => {
        const Icon = ICON[t.kind]
        return (
          <div key={t.id} className="flex items-start gap-2 rounded-xl border border-line glass p-3 text-sm shadow-[var(--shadow-md)] animate-slide-in">
            <Icon size={16} className={cn('mt-0.5 shrink-0', COLOR[t.kind])} />
            <span className="flex-1 break-words">{t.text}</span>
            <button onClick={() => close(t.id)} className="text-muted hover:text-text">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
