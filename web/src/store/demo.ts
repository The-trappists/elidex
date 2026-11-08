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

export const useDemo = create<{ status: DemoStatus | null; sfpCaseComplete: boolean }>(() => ({ status: null, sfpCaseComplete: false }))

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

export async function startLiveDemo(): Promise<void> {
  const status = await req<DemoStatus>('POST', '/demo/live-run')
  useDemo.setState({ status })
}
