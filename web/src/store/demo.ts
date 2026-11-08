import { create } from 'zustand'
import { req } from '../api/client'

export interface DemoStatus {
  enabled: boolean
  live_run_used?: boolean
  live_run_running?: boolean
  live_run_available?: boolean
  live_run_error?: string | null
  mode?: 'scripted' | 'live'
}

export const useDemo = create<{ status: DemoStatus | null }>(() => ({ status: null }))

// Share the first request across React StrictMode mounts. It establishes the cookie
// before state, streams or any page makes a request for the visitor's workspace.
let bootstrap: Promise<DemoStatus> | undefined
export function bootstrapDemo(): Promise<DemoStatus> {
  bootstrap ??= refreshDemo().catch((error: unknown) => {
    bootstrap = undefined
    throw error
  })
  return bootstrap
}

export async function refreshDemo(): Promise<DemoStatus> {
  const status = await req<DemoStatus>('GET', '/demo')
  useDemo.setState({ status })
  return status
}

export async function startLiveDemo(): Promise<void> {
  const status = await req<DemoStatus>('POST', '/demo/live-run')
  useDemo.setState({ status })
}
