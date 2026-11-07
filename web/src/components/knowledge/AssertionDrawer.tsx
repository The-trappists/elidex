import { History, Network, Pencil, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { ContextAssertion } from '../../api/types'
import { fmtDateTime } from '../../lib/format'
import { Button, Drawer, IdChip, JsonView, Modal, withToast } from '../ui'
import { JustificationPanel } from './JustificationPanel'
import { assertionHref, BindingChips, CopyId, isOperatorEdited, OperatorChip, TrustBadge, TypeBadge, threadHref } from './bits'
import { AssertionEditor } from './AssertionEditor'

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mt-5">
    <h4 className="mb-1.5 text-[13px] font-medium text-muted">{title}</h4>
    {children}
  </section>
)

export function AssertionDrawer({ assertion, id, onClose }: { assertion: ContextAssertion | undefined; id: string | null; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [editing, setEditing] = useState<'form' | 'history' | null>(null)
  const a = assertion

  const remove = async () => {
    if (!a) return
    const ok = await withToast(async () => {
      await api.deleteAssertion(a.id)
      return true
    }, 'Assertion deleted')
    setConfirm(false)
    if (ok) onClose()
  }

  return (
    <>
    <Drawer
      open={!!id}
      onClose={editing ? () => undefined : onClose}
      width="max-w-xl"
      title={
        a ? (
          <div className="flex min-w-0 items-center gap-2">
            <TypeBadge type={a.type} /> <span className="min-w-0 truncate">{a.topic}</span> <IdChip className="shrink-0">{a.id}</IdChip>
            {isOperatorEdited(a) && <OperatorChip />}
          </div>
        ) : (
          'Assertion'
        )
      }
    >
      {!a ? (
        <div className="text-sm text-muted">Knowledge "{id}" not found. It may have been deleted.</div>
      ) : (
        <div className="text-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<Pencil size={13} />} onClick={() => setEditing('form')}>Edit</Button>
            <Link to={`/graph?focus=${encodeURIComponent(a.id)}`} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium hover:bg-surface-2">
              <Network size={13} /> Show in graph
            </Link>
            <CopyId id={a.id} />
            {isOperatorEdited(a) && (
              <button
                className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
                onClick={() => setEditing('history')}
              >
                <History size={13} /> Edited by operator. View history
              </button>
            )}
          </div>
          <p>{a.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <TrustBadge level={a.trust.level} labelled />
            <span title="How sure the system is of its reading, after the second check and linking">Confidence {Math.round(a.confidence * 100)}%</span>
            <span>
              valid {fmtDateTime(a.valid_from)} → {a.valid_to ? fmtDateTime(a.valid_to) : 'still valid'}
            </span>
          </div>

          <JustificationPanel id={a.id} />

          <Section title="Bound to">
            <BindingChips bound={a.bound_to} />
          </Section>

          {a.conditions.length > 0 && (
            <Section title="Conditions">
              <ul className="space-y-1">
                {a.conditions.map((c, i) => (
                  <li key={i} className="rounded-md border border-line px-2.5 py-1.5 text-[13px]">
                    {c.text}
                    <div className="mt-0.5 font-mono text-[13px] text-muted">{c.check ? `check: ${c.check.field} ${c.check.op} ${JSON.stringify(c.check.value)}` : 'no machine check (read by humans only)'}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {a.diagnosis && <Section title="Diagnosis"><p>{a.diagnosis}</p></Section>}
          {a.action && <Section title="Action"><p>{a.action}</p></Section>}
          {a.fact && <Section title="Fact"><p>{a.fact}</p></Section>}
          {a.avoid.length > 0 && (
            <Section title="Avoid">
              <ul className="list-disc pl-5">{a.avoid.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </Section>
          )}

          <Section title="Trust">
            <div className="text-[13px]">
              Stated by <b>{a.trust.stated_by}</b>
              {a.trust.role && <span className="text-muted"> ({a.trust.role})</span>}
              {a.trust.evidence && <div className="mt-1 italic text-muted">"{a.trust.evidence}"</div>}
            </div>
          </Section>

          {(a.conflicts_with.length > 0 || a.closed_by) && (
            <Section title="Relations">
              <div className="space-y-1 text-[13px]">
                {a.conflicts_with.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-warn">Conflicts with</span>
                    {a.conflicts_with.map((c) => (
                      <Link key={c} to={assertionHref(c)}><IdChip className="hover:border-accent">{c}</IdChip></Link>
                    ))}
                  </div>
                )}
                {a.closed_by && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted">Closed by</span>
                    <Link to={assertionHref(a.closed_by)}><IdChip className="hover:border-accent">{a.closed_by}</IdChip></Link>
                  </div>
                )}
              </div>
            </Section>
          )}

          <Section title={`Sources (${a.sources.length})`}>
            <ul className="space-y-1 text-[13px]">
              {a.sources.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Link className="text-accent hover:underline" to={threadHref(s.file)}>{s.file}</Link>
                  <span className="text-muted">{s.source} · msgs {s.seq.map((q) => `#${q}`).join(' ')}</span>
                </li>
              ))}
            </ul>
          </Section>

          {a.link_notes.length > 0 && (
            <Section title="Link notes">
              <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-muted">{a.link_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </Section>
          )}

          <Section title="Raw JSON">
            <JsonView value={a} className="max-h-80" />
          </Section>

          <div className="mt-6 border-t border-line pt-4">
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => setConfirm(true)}>
              Delete assertion
            </Button>
          </div>
          <Modal
            open={confirm}
            onClose={() => setConfirm(false)}
            title={`Delete ${a.id}?`}
            footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={remove}>Delete</Button></>}
          >
            <p className="text-sm">This removes this knowledge from the store. Re-processing its source thread can bring it back.</p>
          </Modal>
        </div>
      )}
    </Drawer>
    <AssertionEditor id={editing && a ? a.id : null} focusHistory={editing === 'history'} onClose={() => setEditing(null)} />
    </>
  )
}

