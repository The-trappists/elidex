import { ArrowRight } from 'lucide-react'

// Company-scale retrieval evaluation (run 2026-11-08,
// `ctx dataset eval out/dataset/large --split test`). Source: docs/evaluation.md#part-3.
export const REPORT_URL =
  'https://github.com/The-trappists/elidex/blob/main/docs/evaluation.md#part-3-retrieval-accuracy-at-company-scale'

const STATS = [
  {
    value: '89%',
    label: 'exact answers',
    note: 'strict mode · vs 0.3% for RAG over the raw chats (2,000 cases)',
  },
  {
    value: '0',
    label: 'stale or wrong-element answers',
    note: 'with the graph · vs 41,345 without it',
  },
  {
    value: '85%',
    label: 'on another unit of the same class',
    note: "the brief's step 3 · up from 0% with graph scope alone",
  },
] as const

export function ProofSection() {
  return (
    <section id="proof" className="scroll-mt-20 border-t border-line py-14 sm:py-20">
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.4fr] lg:items-end">
        <div>
          <p className="mb-4 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            <span className="h-px w-8 bg-accent" />
            Proof, not promises
          </p>
          <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
            Right knowledge. Right unit. Right now.
          </h2>
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          Measured on a synthetic Elisa-scale operator: 3M chat threads, 20k network elements, 9,300 agent cases.
        </p>
      </div>

      <div className="mt-10 grid gap-8 sm:grid-cols-3 sm:divide-x sm:divide-line">
        {STATS.map((stat) => (
          <article
            key={stat.label}
            className="border-t border-line pt-6 first:border-t-0 first:pt-0 sm:border-t-0 sm:px-8 sm:pt-0 sm:first:pl-0 sm:last:pr-0"
          >
            <span aria-hidden="true" className="block h-0.5 w-6 bg-accent" />
            <p className="mt-4 font-display text-5xl font-medium tracking-tight tabular-nums sm:text-6xl">{stat.value}</p>
            <p className="mt-3 text-sm font-medium">{stat.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{stat.note}</p>
          </article>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5 text-xs text-muted">
        <p className="max-w-2xl leading-relaxed">
          Synthetic data, oracle extraction: absolute numbers are an upper bound; the gaps are the finding. The dashboard runs the
          default variant (80%).
        </p>
        <a
          href={REPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-8 items-center gap-1 font-medium text-accent hover:opacity-80"
        >
          Full method and numbers <ArrowRight size={12} />
        </a>
      </div>
    </section>
  )
}
