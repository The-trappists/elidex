import { create } from 'zustand'
import { connectionsApi, describeConnectionError, type ConnectionsSnapshot } from '../api/connections'

interface ConnectionsState {
  snapshot: ConnectionsSnapshot | null
  loading: boolean
  error: string | null
  refresh: (force?: boolean) => Promise<ConnectionsSnapshot | null>
  apply: (snapshot: ConnectionsSnapshot) => void
  clearError: () => void
}

let inFlight: Promise<ConnectionsSnapshot | null> | null = null
// A mutation that lands while a read is in flight is newer than that read.
let revision = 0

export const useConnections = create<ConnectionsState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  apply: (snapshot) => {
    revision += 1
    set({ snapshot, loading: false, error: null })
  },
  clearError: () => set({ error: null }),
  refresh: (force = false) => {
    const current = get()
    if (!force && current.snapshot) return Promise.resolve(current.snapshot)
    if (inFlight) return inFlight
    const started = revision
    set({ loading: true, error: null })
    inFlight = connectionsApi
      .get()
      .then((snapshot) => {
        if (revision === started) set({ snapshot, loading: false, error: null })
        return snapshot
      })
      .catch((cause: unknown) => {
        if (revision === started) set({ loading: false, error: describeConnectionError(cause, 'Could not read the connection status.') })
        return null
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  },
}))

/**
 * Live AI actions are available when a model is connected. In the public demo only a
 * visitor's own session connection counts: the shared deployment model must not be used
 * through a visitor's personal path.
 */
export function liveAiReady(snapshot: ConnectionsSnapshot | null): boolean {
  if (!snapshot?.ai.connected) return false
  return snapshot.ai.source === 'session' || !snapshot.public_demo
}

export function useLiveAiReady(): boolean {
  return useConnections((state) => liveAiReady(state.snapshot))
}
