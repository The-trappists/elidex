import { Download } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CompanyPackage } from '../../api/client'
import { demoDriver, isDemo } from '../../api/fixtures/company'
import { useLive } from '../../store/live'
import { TrustBadge, TypeBadge } from '../knowledge/bits'
import { Drawer, EmptyState, IdChip, Skeleton } from '../ui'
import { fmtHM } from './status'

/** Buttons that download everything the autonomous system can be given, as a file. */
export function ExportButtons() {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Export knowledge">
      <span className="text-xs text-muted">Export knowledge</span>
      {(['json', 'markdown'] as const).map((f) => (
        <a key={f} href={api.companyExportUrl(f)} download className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium hover:bg-surface-2">
          <Download size={13} />
          {f === 'json' ? 'JSON' : 'Markdown'}
        </a>
      ))}
    </div>
  )
}

/** What was handed to the autonomous system at one cycle. */
export function PackageDrawer({ open, cycle, onClose }: { open: boolean; cycle: number | undefined; onClose: () => void }) {
  const [pkg, setPkg] = useState<CompanyPackage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const newList = useLive((s) => s.company?.cycles.find((c) => c.n === cycle)?.package.new_ids)
  const newIds = useMemo(() => new Set(newList ?? []), [newList])

  useEffect(() => {
    if (!open) return
    let stale = false
    setPkg(null)
    setError(null)
    const load = isDemo() ? demoDriver(useLive).package(cycle) : api.companyPackage(cycle)
    load.then((p) => !stale && setPkg(p)).catch((e) => !stale && setError(e instanceof Error ? e.message : 'request failed'))
    return () => {
      stale = true
    }
  }, [open, cycle])

  return (
    <Drawer open={open} onClose={onClose} title={`Handed over at cycle #${cycle ?? '?'}${pkg ? ` · ${fmtHM(pkg.at)}` : ''}`} width="max-w-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">The knowledge the autonomous system could ask about at that moment.</p>
        <ExportButtons />
      </div>
      {error ? (
        <EmptyState title="The package is unavailable" hint={error} />
      ) : !pkg ? (
        <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : !pkg.assertions.length ? (
        <EmptyState title="Nothing handed over yet" hint="The package fills up as conversations are turned into knowledge." />
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">{pkg.assertions.length} knowledge items · {pkg.classes.length} equipment groups</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {pkg.assertions.map((a) => (
              <li key={a.id} className="space-y-1.5 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link to={`/knowledge?assertion=${encodeURIComponent(a.id)}`}><IdChip className="hover:border-accent hover:text-accent">{a.id}</IdChip></Link>
                  <TypeBadge type={a.type} />
                  <TrustBadge level={a.trust.level} />
                  {newIds.has(a.id) && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">new</span>}
                  {a.valid_to && <span className="text-[11px] text-muted">closed</span>}
                </div>
                <p className="text-[13px] leading-snug">{a.summary}</p>
                <p className="text-[11px] text-muted">{a.bound_to.map((b) => b.entity).join(', ')}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  )
}
