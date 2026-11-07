import { ArrowRight, BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { KgElement, KgKind } from '../../api/types'
import { fmtDateTime } from '../../lib/format'
import { CopyId } from '../knowledge/bits'
import { JustificationPanel } from '../knowledge/JustificationPanel'
import { EDGE_LABEL, KIND, KIND_ORDER, title } from './kgStyle'

type Data = KgElement['data']

const HIDDEN = new Set(['id', 'kind', 'label', 'valid', 'file', 'seq', 'source', 'topic', 'confidence'])
const PROP_LABEL: Record<string, string> = {
  type: 'Type',
  topic: 'Topic',
  summary: 'Summary',
  diagnosis: 'Diagnosis',
  action: 'Action',
  avoid: 'Avoid',
  fact: 'Fact',
  conditions: 'Conditions',
  valid_from: 'Valid from',
  valid_to: 'Valid until',
  trust_level: 'Trust',
  stated_by: 'Stated by',
  evidence: 'Evidence',
  confidence: 'Confidence',
  model: 'Model',
  install_year: 'Installed',
  install_year_min: 'Installed from',
  install_year_max: 'Installed until',
  firmware: 'Firmware',
  aliases: 'Also called',
  name: 'Name',
  region: 'Region',
  role: 'Role',
  author: 'Author',
  sent_at: 'Sent',
  started_at: 'Started',
  subject: 'Subject',
  text: 'Text',
}

const fmt = (k: string, v: unknown): string => {
  if (Array.isArray(v)) return v.map((item) => typeof item === 'object' && item ? String(item.text ?? item.field ?? JSON.stringify(item)) : String(item)).join('; ')
  if (typeof v === 'object' && v) return JSON.stringify(v)
  if (k === 'type') return String(v).replace(/_/g, ' ')
  if (k === 'confidence' && typeof v === 'number') return `${Math.round(v * 100)}%`
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v)
  return String(v)
}


function openLink(d: Data): { to: string; label: string } | null {
  switch (d.kind) {
    case 'Assertion':
      return { to: `/knowledge?assertion=${encodeURIComponent(d.id)}`, label: 'Read this knowledge' }
    case 'Element':
    case 'Site':
      return { to: `/network?select=${encodeURIComponent(d.id)}`, label: 'Show on the network' }
    case 'Thread':
    case 'Message':
      return d.file ? { to: `/conversations/${encodeURIComponent(String(d.file))}`, label: 'Open the conversation' } : null
    default:
      return null
  }
}

export function KgDetails({ node, nodes, edges, onSelect }: { node: Data; nodes: Map<string, Data>; edges: Data[]; onSelect: (id: string) => void }) {
  const k = KIND[node.kind as KgKind]
  const props = Object.entries(node).filter(([key, v]) => !HIDDEN.has(key) && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && PROP_LABEL[key])
  const link = openLink(node)

  // connections, grouped by relation name and direction
  const groups = new Map<string, string[]>()
  for (const e of edges) {
    const out = e.source === node.id
    if (!out && e.target !== node.id) continue
    const other = String(out ? e.target : e.source)
    const name = EDGE_LABEL[String(e.type)] ?? String(e.type)
    const incoming: Record<string, string> = { APPLIES_TO: 'Knowledge that applies here', STATED_BY: 'Knowledge shared by this person', DERIVED_FROM: 'Knowledge from this source', FROM_THREAD: 'Knowledge from this conversation', LOCATED_AT: 'Equipment at this site', MEMBER_OF: 'Equipment in this group', AUTHORED: 'Written by', CONFLICTS_WITH: 'Conflicting knowledge' }
    const key = out ? name : incoming[String(e.type)] ?? `Connected through: ${name}`
    groups.set(key, [...(groups.get(key) ?? []), other])
  }

  return (
    <div className="space-y-5 p-4">
      <div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="size-2 rounded-full" style={{ background: k?.color }} />
          {k?.label ?? node.kind}
          {node.kind === 'Assertion' && node.valid === false && <span className="text-warn">· not in force at this time</span>}
        </div>
        <h3 className="mt-1 text-base font-semibold leading-snug">{title(node)}</h3>
        <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Technical reference</summary><p className="mt-2 break-all font-mono">{node.id}</p>{node.topic != null && <p className="mt-1 break-all">Topic: {String(node.topic)}</p>}</details>
        {node.kind === 'Assertion' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link to={`/knowledge?assertion=${encodeURIComponent(node.id)}`} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium hover:bg-surface-2">
              <BookOpen size={13} /> Open in Knowledge
            </Link>
            <CopyId id={node.id} />
          </div>
        )}
        {link && node.kind !== 'Assertion' && (
          <Link to={link.to} className="mt-2 inline-flex items-center gap-1 text-sm text-accent hover:underline">
            {link.label} <ArrowRight size={13} />
          </Link>
        )}
      </div>

      {node.kind === 'Assertion' && <JustificationPanel id={node.id} />}

      {props.length > 0 && (
        <dl className="space-y-2 text-[13px]">
          {props.map(([key, v]) => (
            <div key={key}>
              <dt className="text-xs text-muted">{PROP_LABEL[key]}</dt>
              <dd className="whitespace-pre-wrap break-words">{fmt(key, v)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div>
        <div className="mb-2 text-xs font-medium text-muted">Connections</div>
        {groups.size === 0 ? (
          <p className="text-xs text-muted">Not connected to anything.</p>
        ) : (
          <div className="space-y-3">
            {[...groups.entries()].map(([name, ids]) => (
              <div key={name}>
                <div className="mb-1 text-xs text-muted">{name}</div>
                <div className="flex flex-col">
                  {ids.map((id) => {
                    const d = nodes.get(id)
                    const kk = KIND[d?.kind as KgKind]
                    return (
                      <button key={id} onClick={() => onSelect(id)} className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-surface-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: kk?.color }} />
                        <span className="truncate">{d ? title(d) : id}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function KgOverview({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="space-y-4 p-4 text-[13px]">
      <p className="text-muted">
        The knowledge graph links what people said to the equipment it is about. Click any node to see what it is and what it connects to.
      </p>
      <ul className="space-y-2">
        {KIND_ORDER.map((kind) => (
          <li key={kind} className="flex items-start gap-2">
            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: KIND[kind].color }} />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{KIND[kind].plural}</span> <span className="text-muted">· {counts[kind] ?? 0}</span>
              <span className="block text-xs text-muted">{KIND[kind].help}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Red dashed lines are conflicts between two pieces of knowledge. Dashed lines mean "replaced by".</p>
    </div>
  )
}
