// Turns technical values (error strings, purposes, stage names) into sentences a teammate can read.
// The raw value is always kept available elsewhere ("Technical details"), never thrown away.
import type { LlmCall, PipelineJob, StageName } from '../api/types'

export interface Explained {
  /** Short headline, e.g. "The AI provider refused the request". */
  title: string
  /** One or two plain sentences on what it means. */
  detail: string
  /** What the team can do about it. */
  hint?: string
}

const RULES: { test: RegExp; out: Explained }[] = [
  {
    test: /\b402\b|payment required|insufficient (credit|quota|funds)|billing/i,
    out: {
      title: 'The AI provider refused the request: no credit left',
      detail: 'The account used for the language model has run out of credit or its quota is exhausted, so nothing was read.',
      hint: 'Top up the provider account, or switch the extractor to "Scripted" in Settings to keep demoing.',
    },
  },
  {
    test: /\b401\b|\b403\b|unauthori[sz]ed|invalid api key|forbidden|authentication/i,
    out: {
      title: 'The AI provider rejected our key',
      detail: 'The API key is missing, wrong or not allowed to use this model.',
      hint: 'Check the key in the server configuration (never in the UI).',
    },
  },
  {
    test: /\b429\b|rate.?limit|too many requests/i,
    out: {
      title: 'The AI provider is rate limiting us',
      detail: 'Too many requests were sent in a short time. The provider asked us to slow down.',
      hint: 'Wait a minute and re-process the conversation.',
    },
  },
  {
    test: /timeout|timed out|deadline/i,
    out: {
      title: 'The AI took too long to answer',
      detail: 'The request was cancelled because the model did not reply in time.',
      hint: 'Retry, or use a faster model.',
    },
  },
  {
    test: /\b5\d\d\b|bad gateway|service unavailable|overloaded/i,
    out: {
      title: 'The AI provider had a problem on its side',
      detail: 'The service returned a server error. It is usually temporary.',
      hint: 'Retry in a moment.',
    },
  },
  {
    test: /nonetype|object is not sub/i,
    out: {
      title: 'The AI provider returned an empty answer',
      detail: 'The model replied with nothing we could read, so the check could not finish.',
      hint: 'Try another model or provider from Settings.',
    },
  },
  {
    test: /connection|connect error|network|dns|unreachable/i,
    out: {
      title: 'Could not reach the AI provider',
      detail: 'The server could not open a connection to the model endpoint.',
      hint: 'Check the server has internet access and the base URL is right.',
    },
  },
  {
    test: /json|parse|decode|schema|validation/i,
    out: {
      title: 'The AI answered, but not in a usable format',
      detail: 'The reply could not be turned into structured knowledge, so it was discarded.',
      hint: 'Open the call to see the raw answer. Re-processing often fixes it.',
    },
  },
]

export function explainError(raw: string | null | undefined): Explained | null {
  if (!raw) return null
  for (const r of RULES) if (r.test.test(raw)) return r.out
  return { title: 'Something went wrong', detail: 'An unexpected error stopped this step.', hint: 'The technical message below can be sent to the developers.' }
}

export const PURPOSE_LABEL: Record<string, string> = {
  extract: 'Reading a conversation',
  check: 'Connection test',
  generate: 'Writing a scenario',
  agent: 'Agent answering an incident',
  guard: 'Safety check on an action',
  link: 'Matching knowledge to equipment',
}
export const purposeLabel = (p: string) => PURPOSE_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1)

export const STAGE_HELP: Record<StageName, string> = {
  listen: 'Collect the messages of the conversation',
  understand: 'Read them and pull out what people know',
  link: 'Attach each piece of knowledge to the right equipment',
  store: 'Save it so agents can find it later',
  reconcile: 'Close or flag knowledge that is now outdated',
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** "1,835 in · 544 out" style token summary. */
export function fmtTokens(c: LlmCall): string {
  const i = c.usage.prompt_tokens
  const o = c.usage.completion_tokens
  if (i == null && o == null) return '—'
  return `${(i ?? 0).toLocaleString('en')} read · ${(o ?? 0).toLocaleString('en')} written`
}

/** One sentence describing what an LLM call did and how it went. */
export function describeCall(c: LlmCall, threadName?: string): string {
  const what = purposeLabel(c.purpose).toLowerCase()
  const target = threadName ? ` "${threadName}"` : ''
  if (c.error) return `Failed while ${what}${target}.`
  if (c.parsed_ok === false) return `Answered while ${what}${target}, but the answer was unusable.`
  return `Finished ${what}${target}.`
}

/** Plain-language outcome of a pipeline job. */
export function describeJob(job: PipelineJob): string {
  if (job.error) return explainError(job.error)?.title ?? 'Failed'
  if (!job.finished_at || job.stages.some((s) => s.status === 'running')) return 'In progress…'
  const n = job.assertion_ids.length
  if (n === 0) return 'Nothing worth keeping was found'
  const extra: string[] = []
  const count = (re: RegExp) => job.events.filter((e) => re.test(e)).length
  const merged = count(/merge/i)
  const closed = count(/clos/i)
  const conflicts = count(/conflict/i)
  if (merged) extra.push(`${merged} merged with existing`)
  if (closed) extra.push(`${closed} outdated closed`)
  if (conflicts) extra.push(plural(conflicts, 'conflict'))
  return `Learned ${plural(n, 'thing')}` + (extra.length ? ` · ${extra.join(' · ')}` : '')
}
