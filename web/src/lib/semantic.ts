// One place for the colors and labels of domain values. Classes refer to tokens in index.css.
import type { AssertionType, Origin, Severity, SourceKind, StageName, StageStatus, ThreadStatus, TrustLevel } from '../api/types'

export const TYPE_STYLE: Record<AssertionType, { label: string; cls: string; hex: string }> = {
  workaround: { label: 'Workaround', cls: 'bg-surface-2 text-muted', hex: '#6d4fd0' },
  access: { label: 'Access', cls: 'bg-surface-2 text-muted', hex: '#92610a' },
  fact: { label: 'Fact', cls: 'bg-surface-2 text-muted', hex: '#1d63c9' },
  invalidation: { label: 'Invalidation', cls: 'bg-surface-2 text-muted', hex: '#64748b' },
}

export const TRUST_STYLE: Record<TrustLevel, { label: string; cls: string }> = {
  hunch: { label: 'Hunch', cls: 'bg-surface-2 text-muted' },
  stated: { label: 'Stated', cls: 'bg-surface-2 text-muted' },
  verified: { label: 'Verified', cls: 'bg-ok/10 text-ok' },
}

/** Trust is how the knowledge was established. It is separate from confidence, which is how sure the system is. */
export const TRUST_HELP: Record<TrustLevel, string> = {
  hunch: 'Trust: a guess or a hedge. Not the same as confidence.',
  stated: 'Trust: an expert stated it. Not the same as confidence.',
  verified: 'Trust: a later message reported that it worked. Not the same as confidence, which is how sure the system is of its reading.',
}

export const SOURCE_STYLE: Record<SourceKind, { label: string; cls: string; hex: string }> = {
  teams: { label: 'Teams', cls: 'bg-surface-2 text-muted', hex: '#5b5fc7' },
  email: { label: 'Email', cls: 'bg-surface-2 text-muted', hex: '#0b7fa8' },
  slack: { label: 'Slack', cls: 'bg-surface-2 text-muted', hex: '#c81e4f' },
  operator: { label: 'Operator', cls: 'bg-surface-2 text-muted', hex: '#64748b' },
}

export const ORIGIN_STYLE: Record<Origin, { label: string; cls: string }> = {
  elisa: { label: 'Elisa', cls: 'bg-surface-2 text-muted' },
  synthetic: { label: 'Synthetic', cls: 'bg-surface-2 text-muted' },
  generated: { label: 'Generated', cls: 'bg-surface-2 text-muted' },
  manual: { label: 'Manual', cls: 'bg-surface-2 text-muted' },
  slack: { label: 'Slack', cls: 'bg-surface-2 text-muted' },
}

export const SEVERITY_STYLE: Record<Severity, { label: string; cls: string }> = {
  minor: { label: 'Minor', cls: 'bg-warn/15 text-warn' },
  major: { label: 'Major', cls: 'bg-bad/15 text-bad' },
  critical: { label: 'Critical', cls: 'bg-bad/15 text-bad' },
}

export const THREAD_STATUS_STYLE: Record<ThreadStatus, { label: string; cls: string }> = {
  active: { label: 'Live', cls: 'bg-ok/15 text-ok' },
  idle: { label: 'Waiting', cls: 'bg-surface-2 text-muted' },
  processing: { label: 'Processing', cls: 'bg-info/15 text-info' },
  processed: { label: 'Processed', cls: 'bg-surface-2 text-muted' },
  error: { label: 'Error', cls: 'bg-bad/15 text-bad' },
}

export const STAGE_LABEL: Record<StageName, string> = {
  listen: 'Listen',
  understand: 'Understand',
  link: 'Link',
  store: 'Store',
  reconcile: 'Reconcile',
}

export const STAGE_STATUS_STYLE: Record<StageStatus, string> = {
  pending: 'bg-surface-2 text-muted border-line',
  running: 'bg-info/10 text-info border-info/40',
  done: 'bg-ok/10 text-ok border-ok/30',
  skipped: 'bg-surface-2 text-muted border-dashed border-line',
  error: 'bg-bad/10 text-bad border-bad/30',
}
