import type cytoscape from 'cytoscape'
import type { KgElement, KgKind } from '../../api/types'

/** One hue per node kind, from the theme tokens (`--k-*`), so light and dark both work. */
export const KIND: Record<KgKind, { label: string; plural: string; token: string; color: string; help: string }> = {
  Assertion: { label: 'Knowledge', plural: 'Knowledge', token: '--k-knowledge', color: 'var(--k-knowledge)', help: 'A piece of know-how taken from a conversation' },
  Person: { label: 'Person', plural: 'People', token: '--k-person', color: 'var(--k-person)', help: 'Someone who wrote a message or stated knowledge' },
  Element: { label: 'Equipment', plural: 'Equipment', token: '--k-equipment', color: 'var(--k-equipment)', help: 'A network element from the inventory' },
  Site: { label: 'Site', plural: 'Sites', token: '--k-site', color: 'var(--k-site)', help: 'A physical location' },
  Class: { label: 'Group', plural: 'Groups', token: '--k-group', color: 'var(--k-group)', help: 'A class of equipment a rule applies to' },
  Event: { label: 'Event', plural: 'Events', token: '--k-event', color: 'var(--k-event)', help: 'A trigger, such as an SFP replacement' },
  Thread: { label: 'Conversation', plural: 'Conversations', token: '--k-conversation', color: 'var(--k-conversation)', help: 'A chat, email or Slack thread' },
  Message: { label: 'Message', plural: 'Messages', token: '--k-message', color: 'var(--k-message)', help: 'One message in a conversation' },
}

export const KIND_ORDER: KgKind[] = ['Assertion', 'Person', 'Element', 'Site', 'Class', 'Event', 'Thread', 'Message']

/** Plain-language names for edge types. */
export const EDGE_LABEL: Record<string, string> = {
  APPLIES_TO: 'applies to',
  OBSERVED_ON: 'observed on',
  TRIGGER: 'triggered by',
  CLOSED_BY: 'replaced by',
  CONFLICTS_WITH: 'conflicts with',
  DERIVED_FROM: 'comes from',
  STATED_BY: 'stated by',
  AUTHORED: 'wrote',
  PART_OF: 'part of',
  MENTIONS: 'mentions',
  LOCATED_AT: 'located at',
  MEMBER_OF: 'member of',
  FROM_THREAD: 'comes from',
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'

/** Mix two #rrggbb colors; `t` is the share of `a`. Cytoscape cannot read CSS color-mix(). */
function mix(a: string, b: string, t: number) {
  const rgb = (h: string) => {
    const x = h.replace('#', '')
    const full = x.length === 3 ? [...x].map((c) => c + c).join('') : x
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0)
  }
  const [p, q] = [rgb(a), rgb(b)]
  return '#' + p.map((v, i) => Math.round(v * t + q[i] * (1 - t)).toString(16).padStart(2, '0')).join('')
}

/** Shape and size per kind: knowledge is the largest card, people are pills, equipment has cut corners. */
const SHAPES: Partial<Record<KgKind, Record<string, unknown>>> = {
  Assertion: { width: 196, height: 78, 'border-width': 2, 'font-weight': 600, 'font-size': 13, 'text-max-width': '172px' },
  Person: { 'corner-radius': 28, width: 150, height: 52 },
  Element: { shape: 'cut-rectangle', width: 150, height: 52 },
  Site: { 'border-style': 'dashed', width: 150, height: 52 },
  Class: { 'border-style': 'dashed', width: 160, height: 52 },
  Event: { shape: 'round-octagon', width: 160, height: 56 },
  Thread: { width: 170, height: 60 },
  Message: { width: 120, height: 40, 'font-size': 10 },
}

export function kgStyle(): cytoscape.StylesheetJson {
  const text = css('--text')
  const muted = css('--muted')
  const surface = css('--surface')
  const line = css('--line')
  const accent = css('--accent')
  const bad = css('--bad')
  const linkColor = css('--g-link')
  const dark = document.documentElement.classList.contains('dark')
  const kinds = (Object.keys(KIND) as KgKind[]).map((k) => {
    const hue = css(KIND[k].token)
    return {
      selector: `node[kind = "${k}"]`,
      style: {
        'border-color': hue,
        'background-color': mix(hue, surface, dark ? 0.16 : 0.08),
        'overlay-color': hue,
        ...SHAPES[k],
      },
    }
  })
  return [
    {
      selector: 'node',
      style: {
        'background-color': surface,
        shape: 'round-rectangle',
        'corner-radius': 8,
        width: 160,
        height: 56,
        label: 'data(displayLabel)',
        'font-family': 'Public Sans, ui-sans-serif, system-ui, sans-serif',
        'font-size': 12,
        'line-height': 1.3,
        color: text,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-max-width': '136px',
        'text-wrap': 'wrap',
        'min-zoomed-font-size': 7,
        'border-width': 1.5,
        'border-color': line,
        'overlay-opacity': 0,
        'transition-property': 'opacity, border-width',
        'transition-duration': 200,
      },
    },
    ...kinds,
    { selector: 'node[?expired]', style: { opacity: 0.35, 'border-style': 'dashed' } },
    {
      selector: 'edge',
      style: {
        width: 1.2,
        'line-color': linkColor,
        opacity: 0.7,
        'curve-style': 'unbundled-bezier',
        'control-point-distances': 0,
        'target-arrow-shape': 'triangle',
        'target-arrow-color': linkColor,
        'arrow-scale': 0.55,
        label: '',
        'font-size': 10,
        color: muted,
        'text-background-color': surface,
        'text-background-opacity': 1,
        'text-background-padding': '2px',
        'text-background-shape': 'round-rectangle',
        'min-zoomed-font-size': 7,
      },
    },
    { selector: 'edge[type = "CONFLICTS_WITH"]', style: { 'line-color': bad, 'target-arrow-color': bad, 'line-style': 'dashed', opacity: 0.9, width: 1.6 } },
    { selector: 'edge[type = "CLOSED_BY"]', style: { 'line-style': 'dashed' } },
    { selector: 'edge[type = "MENTIONS"]', style: { 'line-style': 'dotted' } },
    // focus: the selection and its neighbours stay, the rest steps back; edge names appear only in focus
    { selector: 'node:active', style: { 'overlay-opacity': 0.08, 'overlay-padding': 4 } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: 'node.focus', style: { 'border-width': 2.5 } },
    { selector: 'node.chosen', style: { 'border-width': 3, 'border-color': accent, 'overlay-color': accent, 'overlay-opacity': 0.1, 'overlay-padding': 6 } },
    { selector: 'edge.focus', style: { opacity: 1, width: 1.8, 'line-color': accent, 'target-arrow-color': accent, label: 'data(name)', color: text } },
    { selector: 'node.match', style: { 'border-color': accent, 'border-width': 3 } },
    { selector: 'node.agent-evidence', style: { 'background-color': '#fef08a', 'border-color': '#eab308', 'border-width': 3, color: '#713f12', opacity: 1, 'overlay-color': '#fde047', 'overlay-opacity': 0.12, 'overlay-padding': 3 } },
    { selector: 'edge.agent-evidence-edge', style: { 'line-color': '#facc15', 'line-outline-color': '#fef08a', 'line-outline-width': 2, 'target-arrow-color': '#facc15', opacity: 1, width: 2.5, 'line-dash-pattern': [9, 7], 'line-dash-offset': 0 } },
    { selector: 'edge.agent-flow-forward', style: { 'target-arrow-shape': 'triangle', 'source-arrow-shape': 'none' } },
    { selector: 'edge.agent-flow-reverse', style: { 'source-arrow-shape': 'triangle', 'source-arrow-color': '#facc15', 'target-arrow-shape': 'none' } },
    { selector: 'node.agent-dim', style: { opacity: 0.12 } },
    { selector: 'edge.agent-dim', style: { opacity: 0.06 } },
    { selector: 'node.agent-target', style: { 'background-color': '#facc15', 'border-color': '#854d0e', 'border-width': 3, color: '#422006', 'font-weight': 700 } },
    { selector: '.context-hidden', style: { display: 'none' } },
    { selector: 'core', style: { 'active-bg-opacity': 0 } },
  ] as unknown as cytoscape.StylesheetJson
}

/** Human title of a node. */
export const title = (d: KgElement['data']) =>
  d.kind === 'Assertion' ? String(d.summary ?? d.topic ?? d.id).replace(/-/g, ' ') : d.kind === 'Message' ? `${d.author ?? ''} · #${d.seq}` : String(d.label ?? d.id)
