import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, GitBranch, MessagesSquare, ShieldCheck, Sparkles, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import './PipelineJourney.css'

const STOPS = [
  { label: 'Capture', title: 'The conversation is already happening.', description: 'Capture operational knowledge where specialists already share it. Slack threads and imported conversations become context, with the original author, message and source preserved.', detail: 'Passive ingestion · Thread context · Source attribution', route: '/conversations', link: 'Explore conversations', icon: MessagesSquare },
  { label: 'Understand', title: 'Find the rule inside the conversation.', description: 'LLM extraction turns informal advice into structured conditions and actions. A second-model critic checks evidence and scope before deterministic linking. The specialist keeps working.', detail: 'Structured extraction · Evidence verification · Critic agent', route: '/pipeline', link: 'Inspect the pipeline', icon: Sparkles },
  { label: 'Link', title: 'Right knowledge. Right network context.', description: 'Bind each assertion to the equipment, class, site and event it actually concerns. Deterministic entity resolution separates where a workaround was observed from where it applies.', detail: 'Entity resolution · Context bindings · Knowledge graph', route: '/graph', link: 'Explore the knowledge graph', icon: GitBranch },
  { label: 'Keep current', title: 'A network changes. Its memory should too.', description: 'Merge repeated advice, preserve independent sources and reconcile conflicting claims. When later evidence supersedes a rule, temporal validity keeps historical knowledge without serving it as current.', detail: 'Deduplication · Trust & provenance · Temporal validity', route: '/knowledge', link: 'Browse the knowledge library', icon: ShieldCheck },
  { label: 'Reuse & learn', title: 'The next agent starts with experience.', description: 'An agent retrieves applicable knowledge for a similar case through REST or MCP, checks the conditions and adapts its action. Passive outcome feedback builds a track record of what worked.', detail: 'Agentic retrieval · Condition checks · Outcome feedback', route: '/agent', link: 'Open the agent tester', icon: Workflow },
] as const

function Preview({ stage, active }: { stage: number; active: boolean }) {
  const [selected, setSelected] = useState('TRN-042')
  return (
    <div className="journey-preview" data-playing={active}>
      <div className="journey-window"><span className="journey-window-mark" /><span>ElidEx / {['Conversations', 'Pipeline', 'Knowledge graph', 'Knowledge library', 'Agent tester'][stage]}</span><span className="journey-example">Illustrative demo</span></div>
      <div className="journey-preview-body">
        {stage === 0 && <>
          <div className="journey-toolbar"><span># transmission-ops</span><span className="journey-status">Thread captured</span></div>
          <div className="journey-message journey-reveal"><span className="journey-avatar">VV</span><div><strong>Veikko <small>Field engineer</small></strong><p>SFP replaced on TRN-042. Link is up, optics normal. Still no traffic.</p></div></div>
          <div className="journey-message journey-reveal" style={{ animationDelay: '180ms' }}><span className="journey-avatar expert">EE</span><div><strong>Erkki <small>Network expert</small></strong><p>Check the counters. If they stay at zero, <mark>bounce the interface before rebooting.</mark></p></div></div>
          <div className="journey-source"><MessagesSquare size={14} /> Full thread retained <span>2 messages shown</span></div>
        </>}
        {stage === 1 && <>
          <div className="journey-toolbar"><span>Thread → structured knowledge</span><ShieldCheck size={16} /></div>
          <div className="journey-stage-list">{['Listen', 'Understand', 'Link', 'Store', 'Reconcile'].map((s, i) => <span key={s} className={i === 1 ? 'selected' : ''}>{s}</span>)}</div>
          <div className="journey-rule journey-reveal"><span className="journey-overline">Extracted workaround</span><h4>Link up, no traffic after SFP swap</h4><dl><div><dt>WHEN</dt><dd>Link UP · optics normal · counters zero</dd></div><div><dt>THEN</dt><dd>Bounce the interface</dd></div><div><dt>AVOID</dt><dd>Rebooting as the first step</dd></div></dl></div>
          <div className="journey-source"><Check size={14} /> Critic: evidence supported <span>Scope checked</span></div>
        </>}
        {stage === 2 && <>
          <div className="journey-toolbar"><span>Context and provenance</span><span>Choose an observed element below</span></div>
          <svg className="journey-graph" viewBox="0 0 480 215" role="img" aria-label={`Workaround linked to the TX-3000 class, SFP swap event, source conversation and ${selected}.`}>
            <g className="journey-graph-edges"><path d="M240 104 L90 45 M240 104 L390 45 M240 104 L90 175 M240 104 L390 175" /></g>
            <g className="journey-graph-labels"><text x="130" y="62">DERIVED_FROM</text><text x="290" y="62">APPLIES_TO</text><text x="137" y="160">TRIGGER</text><text x="295" y="160">OBSERVED_ON</text></g>
            <g className="journey-graph-node"><rect x="169" y="79" width="142" height="50" rx="12" /><text x="240" y="100">Interface bounce</text><text x="240" y="117" className="sub">Context assertion</text></g>
            {[{ x: 90, y: 45, name: 'Source thread' }, { x: 390, y: 45, name: 'TX-3000 class' }, { x: 90, y: 175, name: 'SFP swap' }, { x: 390, y: 175, name: selected }].map(n => <g className="journey-graph-leaf" key={n.x + '-' + n.y}><circle cx={n.x} cy={n.y} r="7" /><text x={n.x} y={n.y + 24}>{n.name}</text></g>)}
          </svg>
          <div className="journey-source"><span>Observed on</span>{['TRN-042', 'TRN-117'].map(id => <button key={id} type="button" onClick={() => setSelected(id)} aria-pressed={selected === id}>{id}</button>)}</div>
        </>}
        {stage === 3 && <>
          <div className="journey-toolbar"><span>Knowledge library</span><span className="journey-status">Provenance retained</span></div>
          <div className="journey-library-head"><span>Assertion</span><span>Validity</span></div>
          <div className="journey-library-row journey-reveal"><div><strong>Interface bounce after SFP swap</strong><small>Erkki · source conversation</small></div><span className="journey-status">Current</span></div>
          <div className="journey-library-row journey-reveal" style={{ animationDelay: '200ms' }}><div><strong>Previous site access instructions</strong><small>Superseded by later instructions</small></div><span className="journey-retired">Historical</span></div>
          <div className="journey-validity"><span className="journey-overline">Temporal context</span><div><span>valid_from</span><i /><span>valid_to</span></div><p>Keep the source. Preserve the history.</p></div>
        </>}
        {stage === 4 && <>
          <div className="journey-toolbar"><span>Similar case / TRN-117</span><span className="journey-status">Context available</span></div>
          <div className="journey-query"><span className="journey-overline">Agent context request</span><code>get_context("TRN-117")</code></div>
          <div className="journey-rule journey-reveal"><div className="journey-status"><Check size={14} /> Conditions checked</div><h4>Check counters. Bounce the interface first.</h4><p>Retrieved via matching class · original source attached</p></div>
          <div className="journey-source"><Workflow size={14} /> Action → observation → outcome <span>Feedback retained</span></div>
        </>}
      </div>
      <Link className="journey-preview-link" to={STOPS[stage].route}>Open {['conversations', 'pipeline', 'graph', 'knowledge', 'agent tester'][stage]} <ArrowRight size={14} /></Link>
    </div>
  )
}

export function PipelineJourney() {
  const host = useRef<HTMLDivElement>(null)
  const path = useRef<SVGPathElement>(null)
  const trace = useRef<SVGPathElement>(null)
  const cursor = useRef<SVGCircleElement>(null)
  const [geometry, setGeometry] = useState({ d: '', width: 1, height: 1 })
  const [active, setActive] = useState(-1)

  useEffect(() => {
    const element = host.current
    const scroller = element?.closest<HTMLElement>('.landing')
    if (!element || !scroller) return
    let frame = 0
    let travelled: number | null = null
    let lastTime = 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const rows = Array.from(element.querySelectorAll<HTMLElement>('.journey-stop'))
    const measure = () => {
      const width = element.clientWidth
      const mobile = window.matchMedia('(max-width: 767px)').matches
      const points = rows.map((row, i) => ({ x: mobile ? 14 : i % 2 === 0 ? 22 : width - 22, y: row.offsetTop + row.offsetHeight / 2 }))
      let d = `M ${points[0].x} 0 L ${points[0].x} ${points[0].y}`
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], mid = (a.y + b.y) / 2
        if (mobile) {
          d += ` L ${b.x} ${b.y}`
        } else {
          const direction = b.x > a.x ? 1 : -1
          const turn = 30
          d += ` L ${a.x} ${mid - turn} Q ${a.x} ${mid}, ${a.x + direction * turn} ${mid}`
          d += ` L ${b.x - direction * turn} ${mid} Q ${b.x} ${mid}, ${b.x} ${mid + turn} L ${b.x} ${b.y}`
        }
      }
      d += ` L ${points[points.length - 1].x} ${element.clientHeight}`
      travelled = null
      setGeometry({ d, width, height: element.clientHeight })
    }
    const update = (time: number) => {
      frame = 0
      const rect = element.getBoundingClientRect()
      const viewport = scroller.getBoundingClientRect()
      const y = Math.max(0, Math.min(rect.height, viewport.top + scroller.clientHeight * .58 - rect.top))
      const current = rows.reduce((result, row, i) => y >= row.offsetTop - 60 ? i : result, -1)
      setActive(current)
      if (!path.current || !trace.current || !cursor.current || !path.current.getAttribute('d')) return
      const length = path.current.getTotalLength()
      // Map each row interval to its whole route segment. Inverting Y directly
      // skips the horizontal stretches because every point there has the same Y.
      const lengthAtY = (position: number) => {
        let low = 0, high = length
        for (let i = 0; i < 18; i++) {
          const mid = (low + high) / 2
          if (path.current!.getPointAtLength(mid).y < position) low = mid
          else high = mid
        }
        return (low + high) / 2
      }
      const anchors = [
        { y: 0, length: 0 },
        ...rows.map(row => {
          const center = row.offsetTop + row.offsetHeight / 2
          return { y: center, length: lengthAtY(center) }
        }),
        { y: rect.height, length },
      ]
      const end = anchors.findIndex(anchor => anchor.y >= y)
      const right = anchors[Math.max(1, end)]
      const left = anchors[Math.max(1, end) - 1]
      const progress = Math.max(0, Math.min(1, (y - left.y) / Math.max(1, right.y - left.y)))
      const target = left.length + (right.length - left.length) * progress
      const elapsed = Math.min(64, Math.max(0, time - lastTime))
      lastTime = time
      if (travelled === null || reducedMotion.matches) travelled = target
      else {
        const distance = target - travelled
        const step = Math.min(Math.abs(distance) * (1 - Math.exp(-elapsed / 140)), elapsed * .9)
        travelled += Math.sign(distance) * step
        if (Math.abs(target - travelled) < .5) travelled = target
      }
      const point = path.current.getPointAtLength(travelled)
      trace.current.style.strokeDasharray = `${length}`
      trace.current.style.strokeDashoffset = `${length - travelled}`
      cursor.current.setAttribute('cx', `${point.x}`)
      cursor.current.setAttribute('cy', `${point.y}`)
      if (travelled !== target) frame = requestAnimationFrame(update)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(() => { measure(); schedule() })
    observer.observe(element)
    rows.forEach(row => observer.observe(row))
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    measure()
    schedule()
    return () => { observer.disconnect(); scroller.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame) }
  }, [])

  return (
    <section id="how-it-works" className="journey-section scroll-mt-8 border-t border-line">
      <div className="journey-intro"><p className="journey-overline">The context layer / end to end</p><h2>Follow a conversation.<br /><span>See it become operational memory.</span></h2><p>One continuous flow from specialist experience to agent-ready knowledge. Scroll to follow the signal.</p></div>
      <div className="journey" ref={host}>
        <svg className="journey-route" width={geometry.width} height={geometry.height} aria-hidden="true"><path ref={path} d={geometry.d} className="journey-route-base" /><path ref={trace} d={geometry.d} className="journey-route-trace" /><circle ref={cursor} r="6" className="journey-cursor" /></svg>
        {STOPS.map((stop, i) => <article key={stop.label} className="journey-stop" data-reached={active >= i} data-active={active === i}>
          <span className="journey-marker" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          <div className="journey-copy"><p className="journey-stop-label"><stop.icon size={17} /> {stop.label}</p><h3>{stop.title}</h3><p>{stop.description}</p><div className="journey-detail">{stop.detail}</div><Link to={stop.route}>{stop.link} <ArrowRight size={15} /></Link></div>
          <Preview stage={i} active={active === i} />
        </article>)}
      </div>
      <div className="journey-end"><span className="journey-overline">Experience, connected.</span><p>The next conversation makes the memory richer.</p><Link to="/company">Watch a simulated company day <ArrowRight size={16} /></Link></div>
    </section>
  )
}
