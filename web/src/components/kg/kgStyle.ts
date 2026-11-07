import type cytoscape from 'cytoscape'
import type { KgElement, KgKind } from '../../api/types'

/** One color per node kind. The filter chips double as the legend, so these are the only graph colors. */
export const KIND: Record<KgKind, { label: string; plural: string; color: string; help: string }> = {
  Assertion: { label: 'Knowledge', plural: 'Knowledge', color: '#2f5bea', help: 'A piece of know-how taken from a conversation' },
  Person: { label: 'Person', plural: 'People', color: '#0f9488', help: 'Someone who wrote a message or stated knowledge' },
  Element: { label: 'Equipment', plural: 'Equipment', color: '#64748b', help: 'A network element from the inventory' },
  Site: { label: 'Site', plural: 'Sites', color: '#9aa3b5', help: 'A physical location' },
  Class: { label: 'Group', plural: 'Groups', color: '#8b5cf6', help: 'A class of equipment a rule applies to' },
  Event: { label: 'Event', plural: 'Events', color: '#d97706', help: 'A trigger, such as an SFP replacement' },
  Thread: { label: 'Conversation', plural: 'Conversations', color: '#a1a1aa', help: 'A chat, email or Slack thread' },
  Message: { label: 'Message', plural: 'Messages', color: '#c4c4cc', help: 'One message in a conversation' },
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

export function kgStyle(): cytoscape.StylesheetJson {
  const text = css('--text')
  const muted = css('--muted')
  const surface = css('--surface')
  const line = css('--line')
  const accent = css('--accent')
  const bad = css('--bad')
  const linkColor = css('--g-link')
  return [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        width: 18,
        height: 18,
        label: 'data(short)',
        'font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
        'font-size': 10,
        color: muted,
        'text-valign': 'bottom',
        'text-margin-y': 3,
        'text-max-width': '120px',
        'text-wrap': 'ellipsis',
        'border-width': 2,
        'border-color': surface,
        'overlay-opacity': 0,
      },
    },
    { selector: 'node[kind = "Assertion"]', style: { shape: 'diamond', width: 24, height: 24, color: text, 'font-size': 11, 'font-weight': 500 } },
    { selector: 'node[kind = "Person"]', style: { width: 22, height: 22, color: text, 'font-size': 11 } },
    { selector: 'node[kind = "Element"]', style: { shape: 'round-rectangle', width: 20, height: 16 } },
    { selector: 'node[kind = "Site"]', style: { shape: 'round-rectangle', width: 14, height: 14 } },
    { selector: 'node[kind = "Class"]', style: { shape: 'hexagon', width: 22, height: 20, color: text } },
    { selector: 'node[kind = "Event"]', style: { shape: 'triangle', width: 18, height: 18 } },
    { selector: 'node[kind = "Thread"]', style: { shape: 'round-rectangle', width: 18, height: 14 } },
    { selector: 'node[kind = "Message"]', style: { width: 9, height: 9, label: '' } },
    { selector: 'node[?expired]', style: { opacity: 0.3 } },
    {
      selector: 'edge',
      style: {
        width: 1,
        'line-color': linkColor,
        opacity: 0.55,
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': linkColor,
        'arrow-scale': 0.5,
        'font-size': 9,
        color: muted,
        'text-background-color': surface,
        'text-background-opacity': 1,
        'text-background-padding': '2px',
        'text-rotation': 'autorotate',
      },
    },
    { selector: 'edge[type = "CONFLICTS_WITH"]', style: { 'line-color': bad, 'target-arrow-color': bad, 'line-style': 'dashed', opacity: 0.9, width: 1.5 } },
    { selector: 'edge[type = "CLOSED_BY"]', style: { 'line-style': 'dashed' } },
    { selector: 'edge[type = "MENTIONS"]', style: { 'line-style': 'dotted' } },
    // focus: a selected node and its neighbours stay, the rest steps back
    { selector: '.faded', style: { opacity: 0.08 } },
    { selector: 'node.focus', style: { 'border-color': accent, 'border-width': 3, color: text } },
    { selector: 'edge.focus', style: { opacity: 1, width: 1.6, 'line-color': accent, 'target-arrow-color': accent, label: 'data(name)' } },
    { selector: 'node.match', style: { 'border-color': accent, 'border-width': 3 } },
    { selector: 'node.agent-evidence', style: { 'background-color': '#fef9c3', 'border-color': '#eab308', 'border-width': 3, color: '#713f12', opacity: 0.82 } },
    { selector: 'edge.agent-evidence-edge', style: { 'line-color': '#facc15', 'target-arrow-color': '#facc15', opacity: 0.95, width: 2 } },
    { selector: 'node.agent-dim', style: { opacity: 0.1 } },
    { selector: 'edge.agent-dim', style: { opacity: 0.06 } },
    { selector: 'node.agent-target', style: { 'background-color': '#facc15', 'border-color': '#854d0e', 'border-width': 4, color: '#422006', 'font-weight': 700, width: 30, height: 26 } },
    { selector: 'core', style: { 'active-bg-color': line } },
  ] as unknown as cytoscape.StylesheetJson
}

/** Human title of a node. */
export const title = (d: KgElement['data']) =>
  d.kind === 'Assertion' ? String(d.topic ?? d.id) : d.kind === 'Message' ? `${d.author ?? ''} · #${d.seq}` : String(d.label ?? d.id)
