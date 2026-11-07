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

/** Human title of a node. */
export const title = (d: KgElement['data']) =>
  d.kind === 'Assertion' ? String(d.summary ?? d.topic ?? d.id).replace(/-/g, ' ') : d.kind === 'Message' ? `${d.author ?? ''} · #${d.seq}` : String(d.label ?? d.id)
