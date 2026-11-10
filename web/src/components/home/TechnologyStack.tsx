import { ArrowLeft, ArrowRight, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
    { name: 'Tailwind CSS', icon: 'tailwindcss', role: 'Styles responsive layouts using shared theme tokens for one consistent light theme.' },
  ] },
  { title: 'Package & deploy', summary: 'Keep the dashboard and its live processes running.', tools: [
    { name: 'Docker', icon: 'docker', role: 'Packages the app; Compose runs the services together for deployment.' },
    { name: 'Vultr', icon: 'vultr', role: 'Chosen VM host for the dashboard, company simulator and optional Slack bridge.' },
    { name: 'Caddy', icon: 'caddy', role: 'Reverse proxy provides HTTPS and the shared team access gate in front of the app.' },
  ] },
]

const TOOLS = GROUPS.flatMap(group => group.tools.map(tool => ({ ...tool, group: group.title })))

export function TechnologyStack() {
  const rail = useRef<HTMLDivElement>(null)
  const cycle = useRef<HTMLDivElement>(null)
  const manualUntil = useRef(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(false)
  const stopped = paused || hovered || focused || reduced || !visible

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(media.matches)
    media.addEventListener('change', change)
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    if (rail.current) observer.observe(rail.current)
    return () => { media.removeEventListener('change', change); observer.disconnect() }
  }, [])

  useEffect(() => {
    const element = rail.current
    const group = cycle.current
    if (!element || !group) return
    let width = 0
    const resize = new ResizeObserver(() => {
      const next = group.getBoundingClientRect().width
      const progress = width ? (element.scrollLeft % width) / width : 0
      width = next
      element.scrollLeft = width * (1 + progress)
    })
    resize.observe(group)
    return () => resize.disconnect()
  }, [])

  useEffect(() => {
    if (stopped) return
    let frame = 0
    let previous = 0
    let offset = rail.current?.scrollLeft ?? 0
    const tick = (time: number) => {
      const element = rail.current
      const width = cycle.current?.getBoundingClientRect().width ?? 0
      if (element && width && !document.hidden && time > manualUntil.current) {
        // Keep fractional progress: assigning subpixels to scrollLeft rounds in some browsers.
        if (Math.abs(element.scrollLeft - offset) > 2) offset = element.scrollLeft
        offset += Math.min(time - (previous || time), 50) * .028
        if (offset >= width * 2) offset -= width
        element.scrollLeft = offset
      }
      previous = time
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [stopped])

  const move = (direction: number) => {
    manualUntil.current = performance.now() + 5000
    const element = rail.current
    const card = cycle.current?.querySelector('article')
    if (element && card) element.scrollBy({ left: direction * (card.getBoundingClientRect().width + 16), behavior: reduced ? 'instant' : 'smooth' })
  }

  return (
    <section id="technology" aria-labelledby="technology-title" className="scroll-mt-8 border-t border-line py-14 sm:py-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Under the hood</p>
          <h2 id="technology-title" className="mt-3 font-display text-3xl font-medium tracking-tight">The stack behind the context.</h2>
          <p className="mt-4 text-sm leading-relaxed text-muted">The tools that turn specialist experience into context an agent can use.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label={paused ? 'Resume technology rotation' : 'Pause technology rotation'} aria-pressed={paused} disabled={reduced} onClick={() => setPaused(!paused)} className="technology-arrow">{paused || reduced ? <Play size={17} /> : <Pause size={17} />}</button>
          <button type="button" aria-label="Previous technology" aria-controls="technology-rail" onClick={() => move(-1)} className="technology-arrow"><ArrowLeft size={18} /></button>
          <button type="button" aria-label="Next technology" aria-controls="technology-rail" onClick={() => move(1)} className="technology-arrow"><ArrowRight size={18} /></button>
        </div>
      </div>
      <div id="technology-rail" ref={rail} role="region" aria-roledescription="carousel" aria-label="Project technologies" tabIndex={0} className="technology-rail mt-8"
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
        onPointerDown={() => { manualUntil.current = performance.now() + 5000 }}
        onScroll={event => {
          const element = event.currentTarget
          const width = cycle.current?.getBoundingClientRect().width ?? 0
          if (!width) return
          if (element.scrollLeft < width / 2) element.scrollLeft += width
          else if (element.scrollLeft >= width * 2) element.scrollLeft -= width
        }}>
        {[0, 1, 2].map(copy => (
          <div key={copy} ref={copy === 1 ? cycle : undefined} className="technology-cycle" aria-hidden={copy !== 1 || undefined} inert={copy !== 1}>
            {TOOLS.map((tool, index) => <article key={tool.name} role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${TOOLS.length}: ${tool.name}`} className="technology-card">
              <div className="flex items-center gap-3">
                <span className="technology-logo"><img src={`/technologies/${tool.icon}.svg`} alt="" width="28" height="28" /></span>
                <h3 className="font-display text-lg font-medium">{tool.name}</h3>
              </div>
              <p className="technology-category">{tool.group}</p>
              <p className="text-sm leading-relaxed text-muted">{tool.role}</p>
            </article>)}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">Scroll or use the arrows to explore. Rotation pauses while you read. Cloud services are optional; the demo also runs locally.</p>
    </section>
  )
}
