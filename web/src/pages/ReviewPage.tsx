import { CheckCircle2, Keyboard, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { FlagKind } from '../api/types'
import { AssertionEditor } from '../components/knowledge/AssertionEditor'
import { threadHref } from '../components/knowledge/bits'
import { ItemEditor } from '../components/pipeline/ItemEditor'
import { FlagCard } from '../components/review/FlagCard'
import { Badge, EmptyState, Select, Toggle, toast } from '../components/ui'
import { FLAG_META, FLAG_ORDER, flagContext } from '../lib/review'
import { useWallNow } from '../lib/useNow'
import { useLive } from '../store/live'
import { isOpen, useReview } from '../store/review'

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)
}

export default function ReviewPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const threadFilter = params.get('thread')
  const flags = useReview((s) => s.flags)
  const pending = useReview((s) => s.pending)
  const fresh = useReview((s) => s.fresh)
  const loaded = useReview((s) => s.loaded)
  const sample = useReview((s) => s.sample)
  const jobs = useLive((s) => s.jobs)
  const threads = useLive((s) => s.threads)
  const assertions = useLive((s) => s.assertions)
  const sites = useLive((s) => s.sites)
  const classes = useLive((s) => s.classes)
  const now = useWallNow(30_000)

  const [kind, setKind] = useState<FlagKind | ''>('')
  const [showDismissed, setShowDismissed] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [editAssertion, setEditAssertion] = useState<string | null>(null)
  const [editItem, setEditItem] = useState<{ jobId: string; index: number } | null>(null)

  const visible = useMemo(
    () => flags.filter((f) => (!kind || f.kind === kind) && (!threadFilter || f.thread_id === threadFilter) && (showDismissed || isOpen(f, pending))),
    [flags, kind, threadFilter, showDismissed, pending],
  )
  const groups = useMemo(
    () => FLAG_ORDER.map((k) => ({ kind: k, rows: visible.filter((f) => f.kind === k) })).filter((g) => g.rows.length),
    [visible],
  )
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const ctxs = useMemo(() => new Map(flat.map((f) => [f.id, flagContext(f, jobs, threads, assertions)])), [flat, jobs, threads, assertions])
  const openTotal = flags.filter((f) => isOpen(f, pending)).length
  const activeId = sel && flat.some((f) => f.id === sel) ? sel : (flat[0]?.id ?? null)
  const none = !kind && !threadFilter && (showDismissed ? flags.length === 0 : openTotal === 0)
  const modalOpen = editAssertion !== null || editItem !== null

  const canEdit = (id: string) => {
    const c = ctxs.get(id)
    return !!c && (!!c.assertion || (!!c.item && !!c.job))
  }
  const edit = useCallback(
    (id: string) => {
      const c = ctxs.get(id)
      if (!c) return
      if (c.assertion) setEditAssertion(c.assertion.id)
      else if (c.item && c.job) setEditItem({ jobId: c.job.id, index: c.job.items.indexOf(c.item) })
      else toast.info('There is nothing saved to edit for this one.')
    },
    [ctxs],
  )
  const dismiss = useCallback(
    (id: string) => {
      const i = flat.findIndex((f) => f.id === id)
      if (flat[i]?.dismissed || pending[id]) return
      const next = flat[i + 1] ?? flat[i - 1]
      if (!showDismissed && next) setSel(next.id)
      useReview.getState().dismiss(id)
    },
    [flat, pending, showDismissed],
  )

  // Keyboard: j/k move, d dismiss, e edit, Enter open the thread.
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <div className="mr-1 text-sm">
          <b className="font-semibold tabular-nums">{openTotal}</b> <span className="text-muted">{openTotal === 1 ? 'thing' : 'things'} the loop wants you to know about</span>
        </div>
        <Select className="w-60" aria-label="Filter by reason" value={kind} onChange={(e) => setKind(e.target.value as FlagKind | '')}>
          <option value="">All reasons</option>
          {FLAG_ORDER.map((k) => <option key={k} value={k}>{FLAG_META[k].title}</option>)}
        </Select>
        <Toggle checked={showDismissed} onChange={setShowDismissed} label="Show dismissed" />
        {threadFilter && (
          <button
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 text-xs hover:border-accent"
            onClick={() => setParams({})}
            aria-label="Clear the conversation filter"
          >
            {threads[threadFilter]?.subject ?? threadFilter} <X size={12} />
          </button>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          {sample && <Badge title="The review service is not connected yet: these are sample cases">Sample data</Badge>}
          <span className="flex items-center gap-1.5" aria-label="Keyboard shortcuts: j and k move, d dismisses, e edits, Enter opens the thread">
            <Keyboard size={14} aria-hidden />
            <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">j</kbd><kbd className="rounded border border-line bg-surface-2 px-1 font-mono">k</kbd> move
            <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">d</kbd> dismiss
            <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">e</kbd> edit
            <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">↵</kbd> open
          </span>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto bg-bg">
        <p aria-live="polite" className="sr-only">{openTotal} items need a look</p>
        {!loaded ? (
          <div className="mx-auto max-w-4xl space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-32 rounded-lg" />)}</div>
        ) : flat.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={28} />}
            title={none ? 'Nothing needs a look. The loop is handling everything.' : 'Nothing matches the filters'}
            hint={
              none
                ? 'Cases the loop was unsure about, dropped or changed show up here as they happen. Nothing waits for your approval: knowledge is already in use.'
                : 'Clear the reason or the conversation filter, or show dismissed cases.'
            }
          />
        ) : (
          <div className="mx-auto max-w-4xl px-4 pb-8">
            {groups.map((g) => {
              const meta = FLAG_META[g.kind]
              return (
                <section key={g.kind} aria-labelledby={`grp-${g.kind}`} className="mb-2">
                  <div className="sticky top-0 z-10 -mx-4 flex items-baseline gap-2 bg-bg/95 px-4 pb-2 pt-4 backdrop-blur">
                    <h2 id={`grp-${g.kind}`} className="text-sm font-semibold">{meta.title}</h2>
                    <span className="text-xs tabular-nums text-muted">{g.rows.length}</span>
                    <span className="min-w-0 truncate text-xs text-muted">{meta.hint}</span>
                  </div>
                  <div className="space-y-3">
                    {g.rows.map((f) => (
                      <FlagCard
                        key={f.id}
                        flag={f}
                        ctx={ctxs.get(f.id)!}
                        sites={sites}
                        classes={classes}
                        now={now}
                        selected={f.id === activeId}
                        dismissed={f.dismissed || !!pending[f.id]}
                        fresh={!!fresh[f.id]}
                        canEdit={canEdit(f.id)}
                        onSelect={() => setSel(f.id)}
                        onDismiss={() => dismiss(f.id)}
                        onEdit={() => { setSel(f.id); edit(f.id) }}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      <AssertionEditor id={editAssertion} onClose={() => setEditAssertion(null)} />
      {editJob && <ItemEditor job={editJob} index={editItem?.index ?? null} onClose={() => setEditItem(null)} />}
    </div>
  )
}
