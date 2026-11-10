import { create } from 'zustand'
import { req } from '../api/client'

export interface DemoStatus {
  enabled: boolean
}

export const useDemo = create<{
  status: DemoStatus | null
  sfpCaseComplete: boolean
  active: boolean
  collapsed: boolean
  step: number
  visited: Record<string, boolean>
  open: (n?: number) => void
  close: () => void
  setStep: (n: number) => void
  setCollapsed: (b: boolean) => void
  markVisited: (id: string) => void
  restart: () => void
}>(() => ({
  status: null,
  sfpCaseComplete: false,
  active: false,
  collapsed: false,
  step: 0,
  visited: {},
  open: (n?: number) => useDemo.setState({ active: true, ...(n !== undefined ? { step: n } : {}) }),
  close: () => useDemo.setState({ active: false }),
  setStep: (n) => useDemo.setState({ step: n }),
  setCollapsed: (b) => useDemo.setState({ collapsed: b }),
  markVisited: (id) => useDemo.setState((s) => ({ visited: { ...s.visited, [id]: true } })),
  restart: () => useDemo.setState({ active: true, collapsed: false, step: 0, visited: {} }),
}))

// Deduplicate in-flight requests across StrictMode mounts, but refresh on every
// dashboard entry: the previous workspace cookie may have expired on the homepage.
let bootstrap: Promise<DemoStatus> | undefined
export function bootstrapDemo(): Promise<DemoStatus> {
  bootstrap ??= refreshDemo().finally(() => {
    bootstrap = undefined
  })
  return bootstrap
}

export async function refreshDemo(): Promise<DemoStatus> {
  const status = await req<DemoStatus>('GET', '/demo')
  useDemo.setState({ status })
  return status
}
