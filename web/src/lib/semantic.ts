// One place for the colors and labels of domain values. Classes refer to tokens in index.css.
import type { AssertionType, Origin, Severity, SourceKind, StageName, StageStatus, ThreadStatus, TrustLevel } from '../api/types'

export const TYPE_STYLE: Record<AssertionType, { label: string; cls: string; hex: string }> = {
  workaround: { label: 'Workaround', cls: 'bg-workaround/15 text-workaround', hex: '#8b5cf6' },
  access: { label: 'Access', cls: 'bg-access/15 text-access', hex: '#f59e0b' },
  fact: { label: 'Fact', cls: 'bg-fact/15 text-fact', hex: '#0ea5e9' },
  invalidation: { label: 'Invalidation', cls: 'bg-invalidation/15 text-invalidation', hex: '#64748b' },
}

export const TRUST_STYLE: Record<TrustLevel, { label: string; cls: string }> = {
  hunch: { label: 'Hunch', cls: 'bg-hunch/15 text-hunch' },
  stated: { label: 'Stated', cls: 'bg-stated/15 text-stated' },
  verified: { label: 'Verified', cls: 'bg-verified/15 text-verified' },
}

export const SOURCE_STYLE: Record<SourceKind, { label: string; cls: string; hex: string }> = {
  teams: { label: 'Teams', cls: 'bg-teams/15 text-teams', hex: '#5b5fc7' },
  email: { label: 'Email', cls: 'bg-email/15 text-email', hex: '#0ea5e9' },
  slack: { label: 'Slack', cls: 'bg-slack/15 text-slack', hex: '#e01e5a' },
}

export const ORIGIN_STYLE: Record<Origin, { label: string; cls: string }> = {
  elisa: { label: 'Elisa', cls: 'bg-accent-soft text-accent' },
  synthetic: { label: 'Synthetic', cls: 'bg-surface-2 text-muted' },
  generated: { label: 'Generated', cls: 'bg-workaround/15 text-workaround' },
  manual: { label: 'Manual', cls: 'bg-info/15 text-info' },
  slack: { label: 'Slack', cls: 'bg-slack/15 text-slack' },
}

export const SEVERITY_STYLE: Record<Severity, { label: string; cls: string }> = {
  minor: { label: 'Minor', cls: 'bg-warn/15 text-warn' },
  major: { label: 'Major', cls: 'bg-bad/15 text-bad' },
  critical: { label: 'Critical', cls: 'bg-bad text-white' },
}

export const THREAD_STATUS_STYLE: Record<ThreadStatus, { label: string; cls: string }> = {
  active: { label: 'Live', cls: 'bg-ok/15 text-ok' },
  idle: { label: 'Waiting', cls: 'bg-surface-2 text-muted' },
  processing: { label: 'Processing', cls: 'bg-info/15 text-info' },
  processed: { label: 'Processed', cls: 'bg-accent-soft text-accent' },
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
  running: 'bg-info/15 text-info border-info animate-pulse',
  done: 'bg-ok/15 text-ok border-ok/40',
  skipped: 'bg-surface-2 text-muted border-dashed border-line',
  error: 'bg-bad/15 text-bad border-bad/40',
}
