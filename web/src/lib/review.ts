// Plain-language metadata for review flags, and the lookup that ties a flag to the pipeline data
// it came from (job, finding, source messages).
import { AlertTriangle, ArrowRightLeft, FileX2, HelpCircle, Hand, PencilLine, Scale, type LucideIcon } from 'lucide-react'
import type { ContextAssertion, ExtractedItem, FlagKind, LiveThread, Message, PipelineJob, ReviewFlag, StageName } from '../api/types'

export interface FlagMeta {
  title: string // group heading
  hint: string // one line under the heading
  why: string // default "why the loop decided that"
  step: StageName
  icon: LucideIcon
  tone: string // text color class, status colors only
}

/** Display order of the groups: what most likely needs a human first. */
export const FLAG_ORDER: FlagKind[] = ['conflict', 'over_reach', 'critic_rejected', 'judge_decision', 'low_confidence', 'abstained', 'operator_edit']

export const FLAG_META: Record<FlagKind, FlagMeta> = {
  conflict: {
    title: 'Knowledge that disagrees',
    hint: 'Two people said opposite things. Both are kept and agents see a warning.',
    why: 'The reconcile step found two pieces of knowledge about the same equipment that exclude each other.',
    step: 'reconcile', icon: ArrowRightLeft, tone: 'text-warn',
  },
  over_reach: {
    title: 'Rules that may reach too far',
    hint: 'A finding sounded wider than what was said, so it was narrowed or lowered.',
    why: 'The second check compared the finding with the message and found a broader scope than the speaker gave.',
    step: 'understand', icon: AlertTriangle, tone: 'text-warn',
  },
  critic_rejected: {
    title: 'Findings that were dropped',
    hint: 'A second check could not find the claim in the conversation, so nothing was saved.',
    why: 'The second check looks for a verbatim quote in the cited messages. It found none that supports the finding.',
    step: 'understand', icon: FileX2, tone: 'text-warn',
  },
  judge_decision: {
    title: 'Older knowledge closed or merged',
    hint: 'New knowledge replaced or confirmed something already stored.',
    why: 'The reconcile step compared the new knowledge with what was already stored about the same equipment.',
    step: 'reconcile', icon: Scale, tone: 'text-muted',
  },
  low_confidence: {
    title: 'The loop was not sure',
    hint: 'Saved, but marked as a hunch or with a low confidence.',
    why: 'The finding was saved with a lower confidence because of how it was said or how it was linked.',
    step: 'understand', icon: HelpCircle, tone: 'text-muted',
  },
  abstained: {
    title: 'The loop held back',
    hint: 'Nothing was saved because a wrong link is worse than none.',
    why: 'It was not clear which equipment the conversation was about, so the loop saved nothing instead of guessing.',
    step: 'link', icon: Hand, tone: 'text-muted',
  },
  operator_edit: {
    title: 'Edited by an operator',
    hint: 'Someone changed knowledge by hand. Agents already use the edited version.',
    why: 'An operator edited this knowledge. The edit is recorded and can be undone from its history.',
    step: 'store', icon: PencilLine, tone: 'text-muted',
  },
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export interface FlagContext {
  job: PipelineJob | undefined
  thread: LiveThread | undefined
  assertion: ContextAssertion | undefined
  item: ExtractedItem | undefined
  /** Messages that back the flag, verbatim. */
  quotes: Message[]
  /** Conflict flags: the assertions that disagree (those still in the store), in id order. */
  pair: ContextAssertion[]
}

/**
 * Tie a flag to what it is about. ReviewFlag has no item_topic yet, so the finding is found
 * through the assertion's topic first, then by its topic text inside the flag message.
 * flag.item_topic (sent by the backend) is used first; the old matching is the fallback.
 */
export function flagContext(flag: ReviewFlag, jobs: PipelineJob[], threads: Record<string, LiveThread>, assertions: Record<string, ContextAssertion>): FlagContext {
  const assertion =
    (flag.assertion_id ? assertions[flag.assertion_id] : undefined) ??
    // Flags from the second check carry only a topic: find the knowledge saved from that conversation.
    (flag.item_topic ? Object.values(assertions).find((a) => a.topic === flag.item_topic && a.sources.some((s) => s.file === flag.thread_id)) : undefined)
  const job = jobs.find((j) => j.id === flag.job_id) ?? [...jobs].reverse().find((j) => j.thread_id === flag.thread_id)
  const thread = threads[flag.thread_id]
  const msg = norm(flag.message)
  const item =
    (flag.item_topic ? job?.items.find((i) => i.topic === flag.item_topic) : undefined) ||
    (assertion && job?.items.find((i) => i.topic === assertion.topic)) ||
    job?.items.find((i) => norm(i.topic).length > 3 && msg.includes(norm(i.topic)))

  let seqs: number[] = []
  if (item) seqs = item.cited_seq
  else if (assertion) seqs = assertion.sources.filter((s) => s.file === flag.thread_id).flatMap((s) => s.seq)
  else if (thread) seqs = thread.messages.slice(0, 2).map((m) => m.seq) // an abstention: where it started
  const quotes = thread ? thread.messages.filter((m) => seqs.includes(m.seq)).slice(0, 3) : []
  const pair =
    flag.kind === 'conflict'
      ? [...new Set([flag.assertion_id ?? '', ...(flag.detail?.match(/ctx_\d{4,}/g) ?? [])])]
          .sort()
          .map((id) => assertions[id])
          .filter((a): a is ContextAssertion => !!a)
      : []
  return { job, thread, assertion, item, quotes, pair }
}

/** Messages cited by a finding or an assertion in a thread, verbatim. */
export function messagesOf(thread: LiveThread | undefined, seqs: number[]): Message[] {
  return thread ? thread.messages.filter((m) => seqs.includes(m.seq)) : []
}

export const verdictItem = (job: PipelineJob, topic: string) => job.items.find((i) => i.topic === topic)

/** Which loop agent raised a flag, in plain words. */
export type FlagSource = 'critic' | 'judge' | 'outcome' | 'reader' | 'linker' | 'operator'

export const SOURCE_LABEL: Record<FlagSource, string> = {
  critic: 'Second check',
  judge: 'Judge',
  outcome: 'Outcome loop',
  reader: 'Reading step',
  linker: 'Linking step',
  operator: 'Operator',
}

export const SOURCE_HELP: Record<FlagSource, string> = {
  critic: 'The second model checked the finding against the cited messages.',
  judge: 'The judge compared new knowledge with what was already stored.',
  outcome: 'The outcome loop read how the technician answered after the agent acted.',
  reader: 'The first reading of the conversation was not sure enough.',
  linker: 'The linking step could not tell which equipment this was about.',
  operator: 'A person changed this knowledge by hand.',
}

export function flagSource(f: ReviewFlag): FlagSource {
  if (/\boutcome\b/i.test(`${f.message} ${f.detail ?? ''}`)) return 'outcome'
  switch (f.kind) {
    case 'over_reach':
    case 'critic_rejected':
      return 'critic'
    case 'judge_decision':
    case 'conflict':
      return 'judge'
    case 'abstained':
      return 'linker'
    case 'operator_edit':
      return 'operator'
    default:
      return 'reader'
  }
}

/** Equipment, sites and classes a flag is about. */
export interface FlagScope {
  els: string[]
  siteIds: string[]
  cls: string[]
}

/** Newer than this counts as new. */
export const NEW_MS = 5 * 60_000
export const isRecent = (iso: string, now: Date) => now.getTime() - new Date(iso).getTime() < NEW_MS

/** All text of a flag the search box looks in. */
export const flagText = (f: ReviewFlag, thread: LiveThread | undefined, scope: FlagScope) =>
  [f.message, f.detail, f.item_topic, f.assertion_id, f.thread_id, thread?.subject, ...scope.els, SOURCE_LABEL[flagSource(f)], FLAG_META[f.kind].title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
