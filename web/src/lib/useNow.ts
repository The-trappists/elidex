import { useEffect, useState } from 'react'
import { simNow, useLive } from '../store/live'

/** Re-renders every `ms` and returns the interpolated sim time. */
export function useSimNow(ms = 1000): Date | null {
  const clock = useLive((s) => s.clock)
  const at = useLive((s) => s.clockReceivedAt)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), ms)
    return () => clearInterval(id)
  }, [ms])
  return simNow({ clock, clockReceivedAt: at })
}

/** Re-renders every `ms` and returns the real (wall) time. */
export function useWallNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
