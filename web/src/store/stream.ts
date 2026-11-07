// One shared EventSource for the whole app. Live state and review flags both subscribe here.
// Reconnects with capped exponential backoff plus jitter; listeners get `onReconnect` once per
// recovery (never per retry), so a flapping backend does not trigger a burst of refetches.
import { api } from '../api/client'

export type StreamStatus = 'connecting' | 'live' | 'offline'

interface Listener {
  onMessage?: (data: string) => void
  /** Called when the stream opens after having been down (not on the very first open). */
  onReconnect?: () => void
  onStatus?: (s: StreamStatus) => void
}

const BASE_MS = 1000
const MAX_MS = 15000

/** Capped exponential backoff with equal jitter. */
export const backoffDelay = (attempt: number) => {
  const cap = Math.min(MAX_MS, BASE_MS * 2 ** attempt)
  return cap / 2 + Math.random() * (cap / 2)
}

const listeners = new Set<Listener>()
let es: EventSource | null = null
let timer: number | undefined
let attempt = 0
let status: StreamStatus = 'connecting'
let wasDown = false
let hadOpen = false
let lastReconnectAt = 0

function setStatus(s: StreamStatus) {
  if (s === status) return
  status = s
  listeners.forEach((l) => l.onStatus?.(s))
}

function connect() {
  if (es || listeners.size === 0) return
  setStatus('connecting')
  es = new EventSource(api.streamUrl)
  es.onopen = () => {
    const recovered = hadOpen && wasDown
    hadOpen = true
    wasDown = false
    attempt = 0
    setStatus('live')
    const now = Date.now()
    if (recovered && now - lastReconnectAt > 2000) {
      lastReconnectAt = now
      listeners.forEach((l) => l.onReconnect?.())
    }
  }
  es.onmessage = (m) => listeners.forEach((l) => l.onMessage?.(m.data))
  es.onerror = () => {
    es?.close()
    es = null
    wasDown = true
    setStatus('offline')
    window.clearTimeout(timer)
    timer = window.setTimeout(connect, backoffDelay(attempt++))
  }
}

/** Subscribe to the shared stream. Returns the unsubscribe function. */
export function subscribeStream(l: Listener): () => void {
  listeners.add(l)
  l.onStatus?.(status)
  connect()
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) {
      es?.close()
      es = null
      window.clearTimeout(timer)
      attempt = 0
      wasDown = false
      hadOpen = false
      status = 'connecting'
    }
  }
}
