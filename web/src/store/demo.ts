// State of the guided demo (the floating guide). It lives in the browser only: the backend knows nothing about it.
// The current step is kept here, not in the URL, because pages rewrite their own query string.
import { create } from 'zustand'

const KEY = 'demo-guide'

interface Saved {
  active: boolean
  collapsed: boolean
  step: number
  visited: Record<string, true>
}

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { active: false, collapsed: false, step: 0, visited: {}, ...(JSON.parse(raw) as Partial<Saved>) }
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return { active: false, collapsed: false, step: 0, visited: {} }
}

interface DemoState extends Saved {
  /** Show the guide, optionally on a given step. */
  open: (step?: number) => void
  close: () => void
  setStep: (i: number) => void
  setCollapsed: (v: boolean) => void
  markVisited: (id: string) => void
  /** Back to step 1 with nothing marked as seen. */
  restart: () => void
}

export const useDemo = create<DemoState>((set, get) => {
  const save = () => {
    const { active, collapsed, step, visited } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ active, collapsed, step, visited }))
    } catch {
      /* storage blocked: the guide still works for this tab */
    }
  }
  const update = (patch: Partial<Saved>) => {
    set(patch)
    save()
  }
  return {
    ...read(),
    open: (step) => update({ active: true, collapsed: false, ...(step === undefined ? {} : { step }) }),
    close: () => update({ active: false }),
    setStep: (step) => update({ step }),
    setCollapsed: (collapsed) => update({ collapsed }),
    markVisited: (id) => {
      if (!get().visited[id]) update({ visited: { ...get().visited, [id]: true } })
    },
    restart: () => update({ step: 0, visited: {}, collapsed: false }),
  }
})
