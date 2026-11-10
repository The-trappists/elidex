import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, ListChecks, Presentation, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { cn } from '../../lib/cn'
import { useDemo } from '../../store/demo'
import { useLive } from '../../store/live'
import { Button, IconButton, Modal, toast, withToast } from '../ui'
import { buildCtx, DEMO_STEPS, stepIndex } from './steps'

/** Floating, collapsible guide that walks through the Elisa story. Closed, the dashboard is exactly the normal one. */
export function DemoGuide() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const { active, collapsed, step, visited, open, close, setStep, setCollapsed, markVisited, restart } = useDemo()
  const runs = useLive((s) => s.runs)
  const threads = useLive((s) => s.threads)
  const incidents = useLive((s) => s.incidents)
  const assertions = useLive((s) => s.assertions)
  const jobs = useLive((s) => s.jobs)
  const applications = useLive((s) => s.applications)
  const ctx = useMemo(() => buildCtx({ runs, threads, incidents, assertions, jobs, applications }), [runs, threads, incidents, assertions, jobs, applications])
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  const [busy, setBusy] = useState(false)
  const [showList, setShowList] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  const index = Math.min(Math.max(step, 0), DEMO_STEPS.length - 1)
  const current = DEMO_STEPS[index]

  // Being on a step counts as having seen it (the first step is shown without a click).
  useEffect(() => {
    if (active && !visited[current.id]) markVisited(current.id)
  }, [active, current.id, visited, markVisited])

  const go = (i: number, opts?: { replace?: boolean }) => {
    const next = Math.min(Math.max(i, 0), DEMO_STEPS.length - 1)
    setStep(next)
    markVisited(DEMO_STEPS[next].id)
    nav(DEMO_STEPS[next].path(ctxRef.current), opts)
  }

  // Deep link: /overview?demo=conversation (or ?demo=2) opens the guide on that step and goes to its page.
  const deep = params.get('demo')
  useEffect(() => {
    if (!deep) return
    const i = stepIndex(deep)
    if (i === null) {
      const p = new URLSearchParams(params)
      p.delete('demo')
      setParams(p, { replace: true })
      return
    }
    open(i)
    markVisited(DEMO_STEPS[i].id)
    nav(DEMO_STEPS[i].path(ctxRef.current), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deep])

  const doReset = async () => {
    setResetting(true)
    const ok = await withToast(async () => {
      await api.reset('empty')
      return true
    })
    setResetting(false)
    setConfirmReset(false)
    if (ok) {
      restart()
      toast.success('Back to the start: empty knowledge base, same network')
      nav('/overview')
    }
  }

  const runAction = async () => {
    if (!current.action) return
    setBusy(true)
    await withToast(() => current.action!.run(ctxRef.current))
    setBusy(false)
  }

  if (!active) return null

  const action = current.action
  const blocked = action?.blocked?.(ctx) ?? null
  const actionDone = !!action?.done?.(ctx)
  const last = index === DEMO_STEPS.length - 1
  const stepDone = (i: number) => !!visited[DEMO_STEPS[i].id] && (DEMO_STEPS[i].ready ? DEMO_STEPS[i].ready!(ctx) : true)

  const resetModal = (
    <Modal
      open={confirmReset}
      onClose={() => !resetting && setConfirmReset(false)}
      title="Reset to start?"
      footer={
        <>
          <Button onClick={() => setConfirmReset(false)} disabled={resetting}>
            Cancel
          </Button>
          <Button variant="danger" icon={<RotateCcw size={14} />} loading={resetting} onClick={doReset}>
            Reset
          </Button>
        </>
      }
    >
      <p className="text-sm">
        This empties conversations, incidents, knowledge and the cases in Needs a look so the story starts from nothing. The network, the people and the scenarios stay.
      </p>
      <p className="mt-2 text-sm text-muted">Use it before a run. It cannot be undone, but the seed can be restored from Data.</p>
    </Modal>
  )

  if (collapsed) {
    return (
      <>
        <button
          onClick={() => setCollapsed(false)}
          className="fixed bottom-4 left-60 z-[45] flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium shadow-[var(--shadow-md)] animate-slide-in hover:border-accent/60"
          aria-label="Open the demo guide"
        >
          <Presentation size={15} className="text-accent" />
          Demo
          <span className="tabular-nums text-muted">
            {index + 1}/{DEMO_STEPS.length}
          </span>
          <ChevronUp size={14} className="text-muted" />
        </button>
        {resetModal}
      </>
    )
  }

  return (
    <>
      <aside
        role="complementary"
        aria-label="Demo guide"
        className="fixed bottom-4 left-60 z-[45] w-[24rem] max-w-[calc(100vw-17rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-lg)] animate-slide-in"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Presentation size={15} className="shrink-0 text-accent" aria-hidden />
          <span className="text-xs font-medium text-muted">Guided demo</span>
          <span className="text-xs tabular-nums text-muted">
            · Step {index + 1} of {DEMO_STEPS.length}
          </span>
          <div className="ml-auto flex items-center">
            <IconButton aria-label={showList ? 'Hide the step list' : 'Show the step list'} aria-pressed={showList} onClick={() => setShowList((v) => !v)} className={cn(showList && '!bg-surface-2 !text-text')}>
              <ListChecks size={15} />
            </IconButton>
            <IconButton aria-label="Collapse the guide" onClick={() => setCollapsed(true)}>
              <ChevronDown size={16} />
            </IconButton>
            <IconButton aria-label="Close the demo mode" onClick={close}>
              <X size={16} />
            </IconButton>
          </div>
        </div>

        <div className="flex gap-1 px-4 pt-3" role="tablist" aria-label="Demo steps">
          {DEMO_STEPS.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === index}
              aria-label={`Step ${i + 1}: ${s.title}`}
              title={`${i + 1}. ${s.title}`}
              onClick={() => go(i)}
              className="group flex h-5 flex-1 items-center"
            >
              <span className={cn('h-1.5 w-full rounded-full transition-colors', i === index ? 'bg-accent' : stepDone(i) ? 'bg-accent/45 group-hover:bg-accent/70' : 'bg-surface-3 group-hover:bg-muted/50')} />
            </button>
          ))}
        </div>

        {showList ? (
          <ol className="max-h-72 space-y-0.5 overflow-auto p-2 animate-fade-in">
            {DEMO_STEPS.map((s, i) => (
              <li key={s.id}>
                <button onClick={() => go(i)} className={cn('flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2', i === index && 'bg-accent-soft font-medium')}>
                  <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums', stepDone(i) ? 'border-accent bg-accent text-on-accent' : 'border-line text-muted')}>
                    {stepDone(i) ? <Check size={12} /> : i + 1}
                  </span>
                  {s.title}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div key={current.id} className="min-h-[15.5rem] space-y-3 px-4 pb-3 pt-2 animate-item-in">
            <h3 className="text-base font-semibold leading-snug">{current.title}</h3>
            <div className="space-y-2.5 text-sm leading-snug">
              <p>
                <span className="mb-0.5 block text-xs font-medium text-muted">What you see</span>
                {current.seen}
              </p>
              <p>
                <span className="mb-0.5 block text-xs font-medium text-muted">Why it matters</span>
                {current.why}
              </p>
            </div>
            {action &&
              (blocked ? (
                <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted" role="status">
                  {blocked}
                </p>
              ) : actionDone ? (
                <p className="flex h-9 items-center gap-1.5 text-sm font-medium text-ok" role="status">
                  <Check size={15} /> {action.doneLabel ?? 'Done'}
                </p>
              ) : (
                <Button variant="primary" className="w-full" loading={busy} onClick={runAction}>
                  {busy ? action.busy : action.label}
                </Button>
              ))}
          </div>
        )}

        <div className="flex items-center gap-1.5 border-t border-line px-3 py-2.5">
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setConfirmReset(true)} title="Empty the knowledge base and start the story from nothing">
            Reset to start
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" icon={<ArrowLeft size={13} />} disabled={index === 0} onClick={() => go(index - 1)}>
              Back
            </Button>
            {last ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  restart()
                  go(0)
                }}
              >
                Back to step 1
              </Button>
            ) : (
              <Button size="sm" variant={action && !actionDone && !blocked ? 'secondary' : 'primary'} onClick={() => go(index + 1)}>
                Next <ArrowRight size={13} />
              </Button>
            )}
          </div>
        </div>
      </aside>
      {resetModal}
    </>
  )
}
