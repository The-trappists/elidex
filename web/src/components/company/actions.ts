import { api } from '../../api/client'
import { demoDriver, isDemo } from '../../api/fixtures/company'
import { useLive } from '../../store/live'

const driver = () => (isDemo() ? demoDriver(useLive) : null)
/** Calls the backend, or the local demo driver when the page runs on fixtures. */
export const companyActions = {
  start: (b: Parameters<typeof api.companyStart>[0]) => (driver() ? driver()!.start(b) : api.companyStart(b)),
  pause: () => (driver() ? driver()!.pause() : api.companyPause()),
  resume: () => (driver() ? driver()!.resume() : api.companyResume()),
  stop: () => (driver() ? driver()!.stop() : api.companyStop()),
}

