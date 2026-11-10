import { useEffect } from 'react'
import type { CompanyState } from '../api/types'
import { useLive } from '../store/live'

/** The company day, loaded once for the pages that need its window or its agent calls. */
export function useCompanyDay(): CompanyState | null {
  const company = useLive((s) => s.company)
  const error = useLive((s) => s.companyError)
  const load = useLive((s) => s.loadCompany)
  useEffect(() => {
    if (!company && !error) void load()
  }, [company, error, load])
  return company
}
