import { ArrowRight, CalendarX2, CircleDot, RotateCcw, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContextAssertion, TrustLevel } from '../../api/types'
import { cn } from '../../lib/cn'
import { changesOf, effectsOf, lifecycleOf, reachOf, toDraft, toEdit, type Draft } from '../../lib/preview'
import { TRUST_STYLE } from '../../lib/semantic'
import { useSimNow } from '../../lib/useNow'
import { useLive } from '../../store/live'
import { useReview } from '../../store/review'
import { Badge, Button, Drawer, Field, IdChip, Input, Select, Textarea, Toggle, withToast } from '../ui'
import { TRUST_LEVELS, OperatorChip, TypeBadge, isOperatorEdited } from './bits'
import { EditHistory } from './EditHistory'

/**
 * Edit knowledge by hand. Nothing here blocks the loop: edits apply at once, are recorded as
 * source "operator", and each one can be undone from the history below.
 */
export function AssertionEditor({ id, onClose, focusHistory }: { id: string | null; onClose: () => void; focusHistory?: boolean }) {
  const a = useLive((s) => (id ? s.assertions[id] : undefined))
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width="max-w-xl"
      title={
        a ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0">Edit knowledge</span>
            <IdChip>{a.id}</IdChip>
            {isOperatorEdited(a) && <OperatorChip />}
          </div>
        ) : (
          'Edit knowledge'
        )
      }
    >
      {!a ? <p className="text-sm text-muted">Knowledge "{id}" was not found. It may have been deleted.</p> : <EditorBody key={a.id} a={a} focusHistory={focusHistory} />}
    </Drawer>
  )
}

function EditorBody({ a, focusHistory }: { a: ContextAssertion; focusHistory?: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(a))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const elements = useLive((s) => s.elements)
  const sites = useLive((s) => s.sites)
  const classes = useLive((s) => s.classes)
  const now = useSimNow(30_000)
  const histRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusHistory) histRef.current?.scrollIntoView({ block: 'start' })
  }, [focusHistory])

  // Follow outside changes (an Undo, another operator) unless the form holds unsaved edits.
  const prevA = useRef(a)
  useEffect(() => {
    if (prevA.current === a) return
    const before = JSON.stringify(toDraft(prevA.current))
    setDraft((d) => (JSON.stringify(d) === before ? toDraft(a) : d))
    prevA.current = a
  }, [a])

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))
  const edit = useMemo(() => toEdit(a, draft, note), [a, draft, note])
  const changes = useMemo(() => changesOf(a, edit), [a, edit])
  const life = useMemo(() => lifecycleOf(a, edit, now), [a, edit, now])
  const reach = useMemo(() => reachOf(a, elements, sites, classes), [a, elements, sites, classes])
  const effects = useMemo(() => effectsOf(edit), [edit])
  const dirty = changes.length > 0
  const emptySummary = draft.summary.trim() === ''

  const apply = async () => {
    setSaving(true)
    const next = await withToast(() => useReview.getState().edit(a.id, edit), 'Applied. Agents use the edited version now.')
    setSaving(false)
    if (next) {
      setDraft(toDraft(next))
      setNote('')
    }
  }

  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="flex items-center gap-2">
          <TypeBadge type={a.type} />
          <span className="truncate font-medium">{a.topic}</span>
        </div>
        <p className="mt-1.5 text-xs text-muted">Edits apply at once and never hold anything back. Each one is recorded and can be undone below.</p>
      </div>

      <div className="space-y-3">
        <Field label="Summary">
          <Textarea rows={3} value={draft.summary} onChange={(e) => patch({ summary: e.target.value })} aria-invalid={emptySummary} />
        </Field>
        <Field label="Action" hint="What an agent should suggest to the technician.">
          <Textarea rows={2} value={draft.action} onChange={(e) => patch({ action: e.target.value })} placeholder="No action" />
        </Field>
        <Field label="Avoid" hint="One per line.">
          <Textarea rows={2} value={draft.avoid.join('\n')} onChange={(e) => patch({ avoid: e.target.value.split('\n') })} placeholder="Nothing to avoid" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Trust level">
            <Select value={draft.trust} onChange={(e) => patch({ trust: e.target.value as TrustLevel })}>
              {TRUST_LEVELS.map((t) => <option key={t} value={t}>{TRUST_STYLE[t].label}</option>)}
            </Select>
          </Field>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted">Valid until</span>
            <div className="flex h-8 items-center">
              <Toggle checked={draft.ends} onChange={(v) => patch({ ends: v, validTo: v && !draft.validTo ? (now ?? new Date()).toISOString().slice(0, 16) : draft.validTo })} label={draft.ends ? 'Ends' : 'Still valid'} />
            </div>
          </div>
        </div>
        {draft.ends && (
          <Field label="Validity end (simulated time)">
            <Input type="datetime-local" className="w-56" value={draft.validTo} onChange={(e) => patch({ validTo: e.target.value })} />
          </Field>
        )}
        <Field label="Note" hint="Why you changed it. Shown in the history.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      <section aria-label="Preview of the edit" aria-live="polite" className="rounded-lg border border-line bg-surface-2">
        <h4 className="border-b border-line px-3 py-2 text-xs font-medium text-muted">Preview, before you apply</h4>
        <div className="space-y-3 px-3 py-3">
          {!dirty ? (
            <p className="text-xs text-muted">No changes yet. Edit a field to see what it would change.</p>
          ) : (
            <>
              <PreviewBlock title="Changed fields">
                <ul className="space-y-1.5">
                  {changes.map((c) => (
                    <li key={c.field} className="grid grid-cols-[6.5rem_1fr] gap-2 text-xs">
                      <span className="text-muted">{c.label}</span>
                      <span className="min-w-0 break-words">
                        <span className="text-muted line-through">{c.before}</span> <ArrowRight size={11} className="mx-0.5 inline text-muted" /> <span className="font-medium">{c.after}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </PreviewBlock>
              {life.text && (
                <PreviewBlock title="Lifecycle">
                  <p className={cn('flex items-start gap-1.5 text-xs', (life.kind === 'closes' || life.kind === 'reopens') && 'font-medium')}>
                    {life.kind === 'closes' || life.kind === 'closes_later' || life.kind === 'moves_end' ? <CalendarX2 size={13} className="mt-0.5 shrink-0 text-warn" /> : <CircleDot size={13} className="mt-0.5 shrink-0 text-ok" />}
                    {life.text}
                  </p>
                </PreviewBlock>
              )}
              {effects.length > 0 && (
                <PreviewBlock title="What agents will do">
                  <ul className="list-disc space-y-0.5 pl-4 text-xs">{effects.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </PreviewBlock>
              )}
            </>
          )}
          <PreviewBlock title="Who it reaches" icon={<Users size={12} />}>
            <ReachSummary a={a} reach={reach} />
          </PreviewBlock>
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <Button variant="primary" disabled={!dirty || emptySummary} loading={saving} onClick={apply}>Apply edit</Button>
          <Button variant="ghost" disabled={!dirty || saving} icon={<RotateCcw size={13} />} onClick={() => { setDraft(toDraft(a)); setNote('') }}>Reset</Button>
          {emptySummary && <span className="text-xs text-bad">The summary cannot be empty.</span>}
        </div>
      </section>

      <div ref={histRef}>
        <EditHistory assertionId={a.id} />
      </div>
    </div>
  )
}

function PreviewBlock({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">{icon}{title}</div>
      {children}
    </div>
  )
}

function ReachSummary({ a, reach }: { a: ContextAssertion; reach: ReturnType<typeof reachOf> }) {
  if (!a.bound_to.length) return <p className="text-xs text-muted">Not bound to any equipment.</p>
  const list = (els: { id: string }[]) => (els.length ? els.map((e) => e.id).join(', ') : 'no equipment in the inventory')
  return (
    <div className="space-y-1 text-xs">
      <p>
        <b className="font-medium">{reach.total}</b> {reach.total === 1 ? 'element' : 'elements'} get this knowledge. The edit does not change the bindings.
      </p>
      <ul className="space-y-1 text-muted">
        {reach.direct.length > 0 && <li><Badge>Direct</Badge> {list(reach.direct)}</li>}
        {reach.viaClass.map((c) => <li key={c.label}><Badge>Class</Badge> {c.label}: {list(c.elements)}</li>)}
        {reach.viaSite.map((s) => <li key={s.name}><Badge>Site</Badge> {s.name}: {list(s.elements)}</li>)}
      </ul>
    </div>
  )
}
