import { ArrowRight } from 'lucide-react'
import { useState } from 'react'

// Numbers from the company-scale retrieval evaluation (run 2026-11-08,
// `ctx dataset eval out/dataset/large --split test`). Source: docs/results/scale-large/report.md.
const REPORT_URL =
  'https://github.com/The-trappists/since-ai-hackathon/blob/main/docs/evaluation.md#part-3-retrieval-accuracy-at-company-scale'

interface Pipeline {
  name: string
  how: string
  ours: boolean
  accuracy: number
  solutionFound: number
  precision: number
  rulesP95: number
  stale: number
  wrongScope: number
}

const PIPELINES: Pipeline[] = [
  { name: 'Naive RAG over the raw chats', how: 'BM25 over whole threads, top 5', ours: false, accuracy: 0.3, solutionFound: 66.6, precision: 11.1, rulesP95: 5, stale: 119, wrongScope: 6548 },
  { name: 'RAG over extracted knowledge', how: 'Perfect extraction, no graph, top 5', ours: false, accuracy: 1.7, solutionFound: 49.6, precision: 8.1, rulesP95: 5, stale: 0, wrongScope: 41345 },
  { name: 'Graph scope + time + conditions', how: 'Element, class and site, valid at the case time', ours: true, accuracy: 48.3, solutionFound: 100, precision: 10.8, rulesP95: 42, stale: 0, wrongScope: 0 },
  { name: '+ problem relevance, default', how: 'Matching rules first, all rules when none matches', ours: true, accuracy: 80.3, solutionFound: 100, precision: 44.8, rulesP95: 10, stale: 0, wrongScope: 0 },
  { name: '+ problem relevance, strict', how: 'Act only on the rules about this problem', ours: true, accuracy: 89.0, solutionFound: 100, precision: 73.0, rulesP95: 6, stale: 0, wrongScope: 0 },
]

const STATS = [
  { value: '89%', label: 'Answered exactly right', note: 'strict mode · vs 0.3% for naive RAG over the chats' },
  { value: '100%', label: 'Right solution came back', note: 'in all 9,300 agent cases' },
  { value: '0', label: 'Stale or wrong-element answers', note: 'vs 41,345 for RAG without the graph' },
  { value: '3,000 / 3,000', label: 'Facts linked to the right elements', note: '0 over-linked' },
] as const

const METHODS = [
  {
    title: 'Graph first, text second',
    text: 'Knowledge is retrieved through the element, its class and its site in the inventory, not by text similarity. Advice for a TX-5000 reads like advice for a TX-3000; the graph tells them apart.',
    result: '0 wrong-element answers',
  },
  {
    title: 'Time is a filter',
    text: 'Every rule has a validity period. A firmware fix or a moved key closes it, so closed knowledge stops coming back.',
    result: '0 stale answers',
  },
  {
    title: 'Conditions checked on what the agent sees',
    text: 'Rules are tested against live observations (counters at 0, interface UP). Nothing is dropped silently: each rule says how far it was checked and which field to read first.',
    result: '26 hand-written cases: 73% → 100%',
  },
  {
    title: 'Problem relevance',
    text: 'A second stage tags each rule with whether it is about the incident in words: a field thesaurus (SFP = transceiver = optic), IDF weighting, scope words removed. Matching rules come first.',
    result: 'Precision 11% → 73%',
  },
  {
    title: 'One rule per piece of knowledge',
    text: 'A hunch later confirmed by an expert becomes one verified rule instead of two. A release closes only bug reports about older firmware.',
    result: '285 / 285 hunches merged (was 72)',
  },
] as const

const pct = (n: number) => `${n.toFixed(1)}%`
const count = (n: number) => n.toLocaleString('en-US')

export function AccuracySection() {
  const [active, setActive] = useState(PIPELINES.length - 1)
  const current = PIPELINES[active]
  return (
    <section id="accuracy" className="scroll-mt-8 border-t border-line py-14 sm:py-20">
      <p className="mb-4 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
        <span className="h-px w-8 bg-accent" />
        measured at company scale
      </p>
      <div className="mb-9 grid gap-x-8 gap-y-4 lg:grid-cols-[auto_1fr]">
        <h2 className="font-display text-3xl font-medium tracking-tight">The right knowledge. Nothing else.</h2>
        <p className="min-w-0 text-sm leading-relaxed text-muted">
          We generated a synthetic operator with 3,000,000 conversation threads, 20,086 network elements and 3,000 hidden facts, then asked
          9,300 agent questions: an incident on an element at a given time. An answer counts as right only if the right knowledge comes back
          (or nothing, when nothing applies) and no noise comes with it. Each step below was measured against simpler approaches on the same
          cases.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <article key={stat.label} className="rounded-xl border border-line bg-surface p-5">
            <p className="text-xs text-muted">{stat.label}</p>
            <p className="mt-2 font-display text-4xl font-medium tracking-tight">{stat.value}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">{stat.note}</p>
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="font-display text-lg font-medium">Accuracy on 9,300 agent cases</h3>
          <p className="text-xs text-muted">Exact answers: right knowledge, valid now, about this problem, no noise</p>
        </div>
        <ul className="mt-6 space-y-1">
          {PIPELINES.map((p, index) => (
            <li key={p.name}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onClick={() => setActive(index)}
                aria-describedby="accuracy-detail"
                className={`grid w-full gap-x-6 gap-y-1.5 rounded-lg px-2 py-2 text-left transition-colors lg:grid-cols-[19rem_1fr] lg:items-center ${active === index ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {p.name}
                    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                      {p.ours ? 'ElidEx' : 'baseline'}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{p.how}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-5 shrink-0 rounded-r ${p.ours ? 'bg-accent' : 'bg-muted/45'}`}
                    style={{ width: `max(2px, calc((100% - 4rem) * ${p.accuracy / 100}))` }}
                  />
                  <span className="text-sm font-semibold tabular-nums">{pct(p.accuracy)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p id="accuracy-detail" aria-live="polite" className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-muted">
          <span className="font-medium text-text">{current.name}:</span> solution found {pct(current.solutionFound)} · precision{' '}
          {pct(current.precision)} · {current.rulesP95} rules handed to the agent (p95) · {count(current.stale)} stale ·{' '}
          {count(current.wrongScope)} wrong-element answers
        </p>
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer py-1 font-medium text-text">See all numbers</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left tabular-nums">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-2 pr-4 font-medium">Approach</th>
                  <th className="py-2 pr-4 font-medium">Accuracy</th>
                  <th className="py-2 pr-4 font-medium">Solution found</th>
                  <th className="py-2 pr-4 font-medium">Precision</th>
                  <th className="py-2 pr-4 font-medium">Rules p95</th>
                  <th className="py-2 pr-4 font-medium">Stale</th>
                  <th className="py-2 font-medium">Wrong element</th>
                </tr>
              </thead>
              <tbody>
                {PIPELINES.map((p) => (
                  <tr key={p.name} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 text-text">{p.name}</td>
                    <td className="py-2 pr-4">{pct(p.accuracy)}</td>
                    <td className="py-2 pr-4">{pct(p.solutionFound)}</td>
                    <td className="py-2 pr-4">{pct(p.precision)}</td>
                    <td className="py-2 pr-4">{p.rulesP95}</td>
                    <td className="py-2 pr-4">{count(p.stale)}</td>
                    <td className="py-2">{count(p.wrongScope)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3">Naive RAG over the chats ran on a 2,000-case sample; on that sample the other rows move by less than one point.</p>
        </details>
      </div>

      <div className="mt-6 rounded-xl border border-accent/30 bg-accent-soft p-5">
        <p className="text-sm leading-relaxed">
          <span className="font-semibold">The brief's own test, reuse on a similar case:</span> on another unit of the same class, exact answers go
          from <span className="font-semibold">0%</span> with graph scope alone to <span className="font-semibold">85%</span> with problem relevance.
          The solution came back in all 1,039 cases either way; what changed is that the agent no longer gets everything known about the unit.
        </p>
      </div>

      <h3 className="mt-14 font-display text-xl font-medium">How we got there</h3>
      <ol className="mt-6 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {METHODS.map((m, index) => (
          <li key={m.title} className="flex flex-col border-t border-line pt-5">
            <span className="font-mono text-[11px] text-accent">{String(index + 1).padStart(2, '0')}</span>
            <h4 className="mt-2 font-display text-lg font-medium">{m.title}</h4>
            <p className="mt-2 text-sm leading-relaxed text-muted">{m.text}</p>
            <p className="mt-auto pt-4 text-xs font-semibold">{m.result}</p>
          </li>
        ))}
      </ol>

      <p className="mt-10 max-w-3xl text-xs leading-relaxed text-muted">
        How to read these numbers: the data is synthetic and its chat language is templated, and the extractor here is the ground truth, so
        the absolute values are an upper bound. The gaps between approaches are the finding. Incident wordings were written by hand before the
        matcher, tuned on one wording and reported on another. With our real LLM extractor on 26 hand-written chats, problem relevance lifts
        accuracy from 65% to 81%.{' '}
        <a href={REPORT_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent">
          Full method and report <ArrowRight size={12} />
        </a>
      </p>
    </section>
  )
}
