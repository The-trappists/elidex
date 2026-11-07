// Review state for the operator console: flags ("Needs a look") and assertion edit history.
// Flags are loaded once from GET /api/review/flags, then kept fresh by the SSE event "review.flag".
// Dismiss is optimistic: the flag is hidden at once and the API is called about 6 s later, unless
// the toast Undo is clicked (there is no un-dismiss endpoint).
import { create } from 'zustand'
import { toast } from '../components/ui'
import { api } from '../api/client'
import { FIXTURES_ENV, fixtureFlagBus, fixtureLiveFlag, isSample, onSampleChange, reviewApi, type AssertionEdit } from '../api/review'
import type { ContextAssertion, OperatorEdit, ReviewFlag } from '../api/types'

export const DISMISS_DELAY_MS = 6000

interface ReviewState {
  flags: ReviewFlag[]
  loaded: boolean
  sample: boolean
  /** Flags that arrived live in this session (highlighted until the next load). */
  fresh: Record<string, true>
  /** Dismissals waiting for their delay: flag id to timer. */
  pending: Record<string, number>
  history: Record<string, AssertionEdit[]>

  load: () => Promise<void>
  upsert: (f: ReviewFlag, live?: boolean) => void
  dismiss: (id: string) => void
  undoDismiss: (id: string) => void
  loadHistory: (assertionId: string) => Promise<void>
  edit: (assertionId: string, body: OperatorEdit) => Promise<ContextAssertion>
  undo: (assertionId: string, editId?: string) => Promise<void>
}

const byNewest = (a: ReviewFlag, b: ReviewFlag) => b.created_at.localeCompare(a.created_at)

export const useReview = create<ReviewState>((set, get) => ({
  flags: [],
  loaded: false,
  sample: isSample(),
  fresh: {},
  pending: {},
  history: {},

  load: async () => {
    const [open, done] = await Promise.all([reviewApi.flags({ dismissed: false }), reviewApi.flags({ dismissed: true })])
    set({ flags: [...open, ...done].sort(byNewest), loaded: true, sample: isSample() })
  },

  upsert: (f, live = false) =>
    set((s) => {
      const i = s.flags.findIndex((x) => x.id === f.id)
      const flags = i >= 0 ? s.flags.map((x, j) => (j === i ? f : x)) : [f, ...s.flags]
      return { flags: flags.sort(byNewest), fresh: live && i < 0 ? { ...s.fresh, [f.id]: true } : s.fresh }
    }),

  dismiss: (id) => {
    if (get().pending[id]) return
    const timer = window.setTimeout(async () => {
      try {
        await reviewApi.dismiss(id)
        set((s) => {
          const { [id]: _t, ...pending } = s.pending
          void _t
          return { pending, flags: s.flags.map((f) => (f.id === id ? { ...f, dismissed: true } : f)) }
        })
      } catch (e) {
        set((s) => {
          const { [id]: _t, ...pending } = s.pending
          void _t
          return { pending }
        })
        toast.error(e)
      }
    }, DISMISS_DELAY_MS)
    set((s) => ({ pending: { ...s.pending, [id]: timer } }))
    toast.info('Dismissed. It will not be shown again.', { duration: DISMISS_DELAY_MS, action: { label: 'Undo', onClick: () => get().undoDismiss(id) } })
  },

  undoDismiss: (id) => {
    const t = get().pending[id]
    if (!t) return
    window.clearTimeout(t)
    set((s) => {
      const { [id]: _t, ...pending } = s.pending
      void _t
      return { pending }
    })
  },

  loadHistory: async (assertionId) => {
    const h = await reviewApi.history(assertionId)
    set((s) => ({ history: { ...s.history, [assertionId]: h.sort((a, b) => b.ts.localeCompare(a.ts)) } }))
  },

  edit: async (assertionId, body) => {
    const a = await reviewApi.editAssertion(assertionId, body)
    await get().loadHistory(assertionId)
    return a
  },

  undo: async (assertionId, editId) => {
    await reviewApi.undo(assertionId, editId)
    await get().loadHistory(assertionId)
  },
}))

/** Flags that still need a look: not dismissed (a pending dismissal counts as dismissed). */
export const isOpen = (f: ReviewFlag, pending: Record<string, number>) => !f.dismissed && !pending[f.id]

/** Selector for the sidebar badge. */
export const useOpenFlagCount = () => useReview((s) => s.flags.filter((f) => isOpen(f, s.pending)).length)

/** Load flags and listen for new ones. Called once from App. */
export function connectReview(): () => void {
  let es: EventSource | null = null
  let liveTimer: number | undefined
  const stopSample = onSampleChange(() => useReview.setState({ sample: true }))
  const stopBus = (() => {
    fixtureFlagBus.add((f) => useReview.getState().upsert(f, true))
    return () => fixtureFlagBus.clear()
  })()

  const load = () => useReview.getState().load().catch(() => useReview.setState({ loaded: true }))
  void load()

  if (FIXTURES_ENV) {
    // Show the live update without a backend: one flag arrives a few seconds after load.
    liveTimer = window.setTimeout(() => useReview.getState().upsert(fixtureLiveFlag(), true), 10_000)
  } else {
    es = new EventSource(api.streamUrl)
    es.onopen = () => void load()
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as { type: string; data: ReviewFlag }
        if (e.type === 'review.flag') useReview.getState().upsert(e.data, true)
      } catch {
        /* not ours */
      }
    }
  }
  return () => {
    es?.close()
    window.clearTimeout(liveTimer)
    stopSample()
    stopBus()
  }
}
