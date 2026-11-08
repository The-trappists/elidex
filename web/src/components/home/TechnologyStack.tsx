import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useRef, useState } from 'react'
import './TechnologyStack.css'

const GROUPS = [
  { title: 'Capture & understand', summary: 'Turn everyday conversations into structured knowledge.', tools: [
    { name: 'Slack', icon: 'slack', role: 'Optional Socket Mode bridge brings specialist conversations into the same pipeline as our simulated chats.' },
    { name: 'Gemini', icon: 'googlegemini', role: 'Primary extraction model turns messages into context assertions. A provider-compatible client also supports separate critic and judge models.' },
    { name: 'Pydantic', icon: 'pydantic', role: 'Validates the shared assertion contract: source quotes, scope, conditions, trust and validity.' },
  ] },
  { title: 'Link & serve', summary: 'Bind human knowledge to the right network context.', tools: [
    { name: 'Python', icon: 'python', role: 'Runs the pipeline, deterministic entity linking, reconciliation, pattern discovery and synthetic company generator.' },
    { name: 'FastAPI', icon: 'fastapi', role: 'Serves dashboard REST endpoints and live server-sent events. Agents can also retrieve context through our MCP server.' },
  ] },
  { title: 'Store & remember', summary: 'Keep long company runs beyond the dashboard’s memory.', tools: [
    { name: 'MongoDB Atlas', icon: 'mongodb', role: 'Configured cloud storage for documents and assertions, with a cold archive for older company activity.' },
    { name: 'Tiger Data / PostgreSQL', icon: 'postgresql', role: 'Optional time-series sink records company metrics at each sync cycle. Local JSONL archives keep the demo usable without cloud setup.' },
  ] },
  { title: 'Explore & inspect', summary: 'Make the autonomous pipeline visible to the team.', tools: [
    { name: 'React', icon: 'react', role: 'Builds the live dashboard, pipeline views and interactive graphs, drawn with our own canvas force engine.' },
    { name: 'TypeScript', icon: 'typescript', role: 'Types the frontend data contracts, API client and interactive dashboard components.' },
    { name: 'Vite', icon: 'vite', role: 'Provides the frontend development server and builds the production dashboard assets.' },
    { name: 'Tailwind CSS', icon: 'tailwindcss', role: 'Styles responsive layouts using shared theme tokens for light and dark modes.' },
  ] },
  { title: 'Package & deploy', summary: 'Keep the dashboard and its live processes running.', tools: [
    { name: 'Docker', icon: 'docker', role: 'Packages the app; Compose runs the services together for deployment.' },
    { name: 'Vultr', icon: 'vultr', role: 'Chosen VM host for the dashboard, company simulator and optional Slack bridge.' },
    { name: 'Caddy', icon: 'caddy', role: 'Reverse proxy provides HTTPS and the shared team access gate in front of the app.' },
  ] },
]

export function TechnologyStack() {
  const rail = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const goTo = (index: number) => {
    const element = rail.current
    if (!element) return
    element.scrollTo({ left: index * element.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }

  return (
    <section id="technology" aria-labelledby="technology-title" className="scroll-mt-8 border-t border-line py-14 sm:py-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Under the hood</p>
          <h2 id="technology-title" className="mt-3 font-display text-3xl font-medium tracking-tight">The stack behind the context.</h2>
          <p className="mt-4 text-sm leading-relaxed text-muted">From a specialist’s message to context an agent can use: the technologies powering ElidEx, and what each one does.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted" aria-live="polite" aria-atomic="true">{active + 1} / {GROUPS.length}</span>
          <button type="button" aria-label="Previous technology group" aria-controls="technology-rail" disabled={active === 0} onClick={() => goTo(active - 1)} className="technology-arrow"><ArrowLeft size={18} /></button>
          <button type="button" aria-label="Next technology group" aria-controls="technology-rail" disabled={active === GROUPS.length - 1} onClick={() => goTo(active + 1)} className="technology-arrow"><ArrowRight size={18} /></button>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-2" aria-label="Technology groups">
        {GROUPS.map((group, index) => <button type="button" key={group.title} aria-pressed={active === index} aria-controls="technology-rail" onClick={() => goTo(index)} className="technology-group">{group.title}</button>)}
      </div>
      <div id="technology-rail" ref={rail} role="region" aria-roledescription="carousel" aria-label="Project technologies" tabIndex={0} className="technology-rail mt-5" onScroll={(event) => {
        const element = event.currentTarget
        setActive(Math.round(element.scrollLeft / element.clientWidth))
      }}>
        {GROUPS.map((group, index) => (
          <div key={group.title} role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${GROUPS.length}: ${group.title}`} className="technology-slide rounded-xl border border-line bg-surface p-5 sm:p-8">
            <h3 className="font-display text-xl font-medium">{group.title}</h3>
            <p className="mt-2 text-sm text-muted">{group.summary}</p>
            <div className="mt-7 grid gap-6 sm:grid-cols-2">
              {group.tools.map((tool) => <article key={tool.name} className="flex items-start gap-4">
                <span className="technology-logo"><img src={`/technologies/${tool.icon}.svg`} alt="" loading="lazy" width="28" height="28" /></span>
                <div><h4 className="text-sm font-semibold">{tool.name}</h4><p className="mt-2 text-sm leading-relaxed text-muted">{tool.role}</p></div>
              </article>)}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Swipe or use the arrows to explore. Cloud storage and external providers are configuration-dependent; the demo also runs locally in scripted mode.</p>
    </section>
  )
}
