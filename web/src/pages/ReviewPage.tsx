// "Needs a look": what the loop was unsure about, dropped, merged or changed. Informational: nothing here waits for
// approval, knowledge is already in use. Built to stay usable with hundreds of flags (company day, endless runs):
// counts per reason, search, grouping, sorting, an Open / Dismissed view and a "show more" page size.
import { CheckCircle2, Keyboard, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { FlagKind, ReviewFlag } from '../api/types'
import { AssertionEditor } from '../components/knowledge/AssertionEditor'
import { threadHref } from '../components/knowledge/bits'
import { MergesBadge } from '../components/knowledge/MergesDrawer'
import { ItemEditor } from '../components/pipeline/ItemEditor'
import { buildFlagsExport } from '../components/review/exportFlags'
import { ExportListMenu } from '../components/review/ExportListMenu'
import { FlagCard } from '../components/review/FlagCard'
import { flagScope } from '../components/review/scope'
import { Badge, Button, EmptyState, Input, Modal, Select, Tabs } from '../components/ui'
import { cn } from '../lib/cn'
import { FLAG_META, FLAG_ORDER, flagContext, flagText, isRecent, type FlagContext, type FlagScope } from '../lib/review'
import { useWallNow } from '../lib/useNow'
import { useLive } from '../store/live'
import { isOpen, useReview } from '../store/review'

const PAGE = 40

type GroupBy = 'kind' | 'thread' | 'element' | 'none'
type SortBy = 'newest' | 'severity'
type View = 'open' | 'dismissed'

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)
}

interface Group {
  key: string
  title: string
  hint?: string
  rows: ReviewFlag[]
}

export default function ReviewPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const threadFilter = params.get('thread')
  const flags = useReview((s) => s.flags)
  const pending = useReview((s) => s.pending)
  const fresh = useReview((s) => s.fresh)
  const loaded = useReview((s) => s.loaded)
  const error = useReview((s) => s.error)
  const sample = useReview((s) => s.sample)
  const jobs = useLive((s) => s.jobs)
  const threads = useLive((s) => s.threads)
  const assertions = useLive((s) => s.assertions)
  const sites = useLive((s) => s.sites)
  const classes = useLive((s) => s.classes)
  const now = useWallNow(30_000)

  const [view, setView] = useState<View>('open')
  const [kind, setKind] = useState<FlagKind | ''>('')
  const [q, setQ] = useState('')
  const [onlyNew, setOnlyNew] = useState(false)
  const [groupBy, setGroupBy] = useState<GroupBy>('kind')
  const [sortBy, setSortBy] = useState<SortBy>('newest')
  const [limit, setLimit] = useState(PAGE)
  const [sel, setSel] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [editAssertion, setEditAssertion] = useState<string | null>(null)
  const [editItem, setEditItem] = useState<{ jobId: string; index: number } | null>(null)

  const resetLimit = () => setLimit(PAGE)
  const flagIsNew = useCallback((f: ReviewFlag) => !!fresh[f.id] || isRecent(f.created_at, now), [fresh, now])

  // Flags of the chosen view and conversation, each tied to what it is about.
  const inView = useMemo(
    () => flags.filter((f) => (view === 'open' ? isOpen(f, pending) : f.dismissed || !!pending[f.id]) && (!threadFilter || f.thread_id === threadFilter)),
    [flags, view, pending, threadFilter],
  )
  const info = useMemo(() => {
    const m = new Map<string, { ctx: FlagContext; scope: FlagScope; text: string }>()
    for (const f of inView) {
      const ctx = flagContext(f, jobs, threads, assertions)
      const scope = flagScope(ctx, sites, classes)
      m.set(f.id, { ctx, scope, text: flagText(f, ctx.thread, scope) })
    }
    return m
  }, [inView, jobs, threads, assertions, sites, classes])

  const needle = q.trim().toLowerCase()
  const searched = useMemo(
    () => inView.filter((f) => (!needle || info.get(f.id)?.text.includes(needle)) && (!onlyNew || flagIsNew(f))),
    [inView, needle, onlyNew, info, flagIsNew],
  )
  const counts = useMemo(() => {
    const c: Partial<Record<FlagKind, number>> = {}
    for (const f of searched) c[f.kind] = (c[f.kind] ?? 0) + 1
    return c
  }, [searched])
  const matching = useMemo(() => {
    const rows = searched.filter((f) => !kind || f.kind === kind)
    if (sortBy === 'severity') return [...rows].sort((a, b) => FLAG_ORDER.indexOf(a.kind) - FLAG_ORDER.indexOf(b.kind))
    return rows
  }, [searched, kind, sortBy])

  const shownRows = matching.slice(0, limit)
  const groups = useMemo<Group[]>(() => {
    if (groupBy === 'none') return [{ key: 'all', title: 'All', rows: shownRows }]
    if (groupBy === 'kind') {
      return FLAG_ORDER.map((k) => ({ key: k, title: FLAG_META[k].title, hint: FLAG_META[k].hint, rows: shownRows.filter((f) => f.kind === k) })).filter((g) => g.rows.length)
    }
    const by = new Map<string, Group>()
    for (const f of shownRows) {
      const key = groupBy === 'thread' ? f.thread_id : (info.get(f.id)?.scope.els[0] ?? '')
      const title = groupBy === 'thread' ? (threads[f.thread_id]?.subject ?? f.thread_id) : (key || 'No equipment named')
      const g = by.get(key) ?? { key: key || 'none', title, rows: [] }
      g.rows.push(f)
      by.set(key, g)
    }
    return [...by.values()]
  }, [shownRows, groupBy, info, threads])
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])

  const openTotal = flags.filter((f) => isOpen(f, pending)).length
  const dismissedTotal = flags.length - openTotal
  const newCount = useMemo(() => flags.filter((f) => isOpen(f, pending) && flagIsNew(f)).length, [flags, pending, flagIsNew])
  const activeId = sel && flat.some((f) => f.id === sel) ? sel : (flat[0]?.id ?? null)
  const filtered = !!(kind || needle || onlyNew || threadFilter)
  const modalOpen = editAssertion !== null || editItem !== null || confirmAll

  const canEdit = (id: string) => {
    const c = info.get(id)?.ctx
    return !!c && (!!c.assertion || (!!c.item && !!c.job))
  }
  const edit = useCallback(
    (id: string) => {
      const c = info.get(id)?.ctx
      if (!c) return
      if (c.assertion) setEditAssertion(c.assertion.id)
      else if (c.item && c.job) setEditItem({ jobId: c.job.id, index: c.job.items.indexOf(c.item) })
    },
    [info],
  )
  const dismiss = useCallback(
    (id: string) => {
      const i = flat.findIndex((f) => f.id === id)
      if (view === 'dismissed' || flat[i]?.dismissed || pending[id]) return
      const next = flat[i + 1] ?? flat[i - 1]
      if (next) setSel(next.id)
      useReview.getState().dismiss(id)
    },
    [flat, pending, view],
  )

  // Keyboard: j/k move, d dismiss, e edit, Enter open the conversation.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || modalOpen || !flat.length) return
      const i = flat.findIndex((f) => f.id === activeId)
      const go = (j: number) => {
        e.preventDefault()
        setSel(flat[Math.min(flat.length - 1, Math.max(0, j))].id)
      }
      if (e.key === 'j' || e.key === 'ArrowDown') go(i + 1)
      else if (e.key === 'k' || e.key === 'ArrowUp') go(i - 1)
      else if (e.key === 'd' && activeId) dismiss(activeId)
      else if (e.key === 'e' && activeId) {
        e.preventDefault()
        edit(activeId)
      } else if (e.key === 'Enter' && activeId && !(e.target as HTMLElement | null)?.closest('button, a')) {
        const f = flat[i]
        if (f) nav(threadHref(f.thread_id))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [flat, activeId, modalOpen, dismiss, edit, nav])

  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!activeId) return
    listRef.current?.querySelector(`[data-flag="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const editJob = editItem ? jobs.find((j) => j.id === editItem.jobId) : undefined
  const none = !filtered && inView.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-start gap-x-4 gap-y-2 px-4 pb-3 pt-4 sm:px-5">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="font-display text-2xl font-medium tracking-tight">A closer look, when you need it</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            What the loop was unsure about, dropped, merged or changed. Knowledge is already in use: nothing here waits for approval.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sample && <Badge title="The review service is not connected yet: these are sample cases">Sample data</Badge>}
          <MergesBadge />
          <ExportListMenu filename="needs-a-look" disabled={!matching.length} build={(f) => buildFlagsExport(matching, threads, f)} />
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-line bg-surface px-4 py-2 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Tabs<View>
            className="border-b-0"
            value={view}
            onChange={(v) => { setView(v); setKind(''); resetLimit() }}
            items={[{ id: 'open', label: 'Open', count: openTotal }, { id: 'dismissed', label: 'Dismissed', count: dismissedTotal }]}
          />
          <div className="relative min-w-40 max-w-72 flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-8" type="search" aria-label="Search flags" placeholder="Search text, equipment, id…" value={q} onChange={(e) => { setQ(e.target.value); resetLimit() }} />
          </div>
          <Select className="w-40" aria-label="Group by" value={groupBy} onChange={(e) => { setGroupBy(e.target.value as GroupBy); resetLimit() }}>
            <option value="kind">Group by reason</option>
            <option value="thread">Group by conversation</option>
            <option value="element">Group by equipment</option>
            <option value="none">No grouping</option>
          </Select>
          <Select className="w-36" aria-label="Sort by" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="newest">Newest first</option>
            <option value="severity">Most serious first</option>
          </Select>
          {view === 'open' && (
            <button
              type="button"
              aria-pressed={onlyNew}
              onClick={() => { setOnlyNew(!onlyNew); resetLimit() }}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm', onlyNew ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-text')}
            >
              New <span className="tabular-nums">{newCount}</span>
            </button>
          )}
          {threadFilter && (
            <button
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 text-[13px] hover:border-accent"
              onClick={() => setParams({})}
              aria-label="Clear the conversation filter"
            >
              {threads[threadFilter]?.subject ?? threadFilter} <X size={12} />
            </button>
          )}
          {view === 'open' && matching.length > 1 && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirmAll(true)}>Dismiss all {matching.length}…</Button>
          )}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Filter by reason">
          <Chip active={!kind} onClick={() => { setKind(''); resetLimit() }} label="All reasons" n={searched.length} />
          {FLAG_ORDER.map((k) => (
            <Chip key={k} active={kind === k} disabled={!counts[k] && kind !== k} onClick={() => { setKind(kind === k ? '' : k); resetLimit() }} label={FLAG_META[k].title} n={counts[k] ?? 0} />
          ))}
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 whitespace-nowrap pl-3 text-[13px] text-muted xl:flex" aria-label="Keyboard shortcuts: j and k move, d dismisses, e edits, Enter opens the conversation">
            <Keyboard size={14} aria-hidden />
            <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">j</kbd><kbd className="rounded border border-line bg-surface-2 px-1 font-mono">k</kbd> move
            <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">d</kbd> dismiss
            <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">e</kbd> edit
          </span>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto bg-bg">
        <p aria-live="polite" className="sr-only">{openTotal} items need a look</p>
        {!loaded ? (
          <div className="mx-auto max-w-4xl space-y-3 p-4" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 rounded-lg" />)}</div>
        ) : error && flags.length === 0 ? (
          <EmptyState
            title="Could not load the flags"
            hint={error}
            action={<Button onClick={() => { useReview.setState({ loaded: false, error: null }); void useReview.getState().load().catch((e: unknown) => useReview.setState({ loaded: true, error: e instanceof Error ? e.message : 'Request failed' })) }}>Retry</Button>}
          />
        ) : flat.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={28} />}
            title={none ? (view === 'open' ? 'Nothing needs a look. The loop is handling everything.' : 'Nothing was dismissed') : 'Nothing matches the filters'}
            hint={
              none
                ? view === 'open'
                  ? 'Cases the loop was unsure about, dropped or changed show up here as they happen. Nothing waits for your approval: knowledge is already in use.'
                  : 'Flags you dismiss are kept here, and you can restore them.'
                : 'Clear the search, the reason or the conversation filter.'
            }
            action={filtered ? <Button onClick={() => { setQ(''); setKind(''); setOnlyNew(false); setParams({}) }}>Clear filters</Button> : undefined}
          />
        ) : (
          <div className="mx-auto max-w-4xl px-4 pb-8">
            <p className="pt-3 text-[13px] text-muted">
              {view === 'open'
                ? 'The loop merged near-duplicates and went on by itself. These are observations, not tasks.'
                : 'Dismissed flags stay out of the Open view. Restore one to bring it back.'}
            </p>
            {groups.map((g) => (
              <section key={g.key} aria-labelledby={`grp-${g.key}`} className="mb-2">
                <div className="sticky top-0 z-10 -mx-4 flex items-baseline gap-2 bg-bg/95 px-4 pb-2 pt-3 backdrop-blur">
                  <h2 id={`grp-${g.key}`} className="min-w-0 truncate text-sm font-semibold">{g.title}</h2>
                  <span className="text-[13px] tabular-nums text-muted">{g.rows.length}</span>
                  {g.hint && <span className="hidden min-w-0 truncate text-[13px] text-muted md:inline">{g.hint}</span>}
                </div>
                <div className="space-y-2.5">
                  {g.rows.map((f) => {
                    const i = info.get(f.id)
                    if (!i) return null
                    return (
                      <FlagCard
                        key={f.id}
                        flag={f}
                        ctx={i.ctx}
                        scope={i.scope}
                        sites={sites}
                        now={now}
                        selected={f.id === activeId}
                        dismissed={f.dismissed || !!pending[f.id]}
                        isNew={flagIsNew(f)}
                        canEdit={canEdit(f.id)}
                        subject={groupBy === 'thread' ? undefined : (i.ctx.thread?.subject ?? f.thread_id)}
                        onSelect={() => setSel(f.id)}
                        onDismiss={() => dismiss(f.id)}
                        onRestore={() => void useReview.getState().restore([f.id])}
                        onEdit={() => { setSel(f.id); edit(f.id) }}
                        onEditAssertion={(aid) => { setSel(f.id); setEditAssertion(aid) }}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
            <div className="flex items-center justify-center gap-3 pt-4 text-[13px] text-muted">
              <span>Showing {flat.length} of {matching.length}</span>
              {matching.length > flat.length && <Button size="sm" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, matching.length - flat.length)} more</Button>}
            </div>
          </div>
        )}
      </div>

      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={`Dismiss ${matching.length} flags?`}
        footer={
          <>
            <Button onClick={() => setConfirmAll(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setConfirmAll(false); void useReview.getState().dismissMany(matching.map((f) => f.id)) }}>Dismiss {matching.length}</Button>
          </>
        }
      >
        <p className="text-sm">They move to the Dismissed view. Knowledge is not changed, and you can restore them any time.</p>
      </Modal>
      <AssertionEditor id={editAssertion} onClose={() => setEditAssertion(null)} />
      {editJob && <ItemEditor job={editJob} index={editItem?.index ?? null} onClose={() => setEditItem(null)} />}
    </div>
  )
}

function Chip({ label, n, active, disabled, onClick }: { label: string; n: number; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[13px] disabled:opacity-40',
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-text',
      )}
    >
      {label} <span className="tabular-nums">{n}</span>
    </button>
  )
}
