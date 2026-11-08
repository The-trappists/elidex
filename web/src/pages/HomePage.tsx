import { TechnologyStack } from '../components/home/TechnologyStack'
import { ArrowRight, BookOpenCheck, Play } from 'lucide-react'
import { useEffect, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PipelineJourney } from '../components/home/PipelineJourney'
import { BootSequence } from '../components/home/BootSequence'
import { ForceCanvas, type ForceNode, type ForceLink } from '../components/force/ForceCanvas'

interface University {
  name: string
  logo: string
}

interface TeamMember {
  name: string
  degree: string
  unis: University[]
  region: string
  flag: string
  avatar?: string
  badge?: string
  linkedin?: string
}

const TEAM_MEMBERS: TeamMember[] = [
  {
    name: 'Matteo Morbée',
    badge: 'UnPtitBelge',
    avatar: '/matteo.png',
    linkedin: 'https://www.linkedin.com/in/matteo-morbee-cs/',
    degree: 'M.Sc. in Computer Science, Networks & Systems specialization',
    unis: [{ name: 'UCLouvain', logo: '/uclouvain.svg' }],
    region: 'Belgium',
    flag: '/flag-be.svg',
  },
  {
    name: 'Manuel Rocca',
    badge: 'mnlrc',
    avatar: '/manu.png',
    linkedin: 'https://www.linkedin.com/in/mnlrc/',
    degree: "Joint master’s degree in cybersecurity",
    unis: [
      { name: 'EPFL', logo: '/epfl.svg' },
      { name: 'ETHZ', logo: '/ethz.svg' },
    ],
    region: 'Switzerland',
    flag: '/flag-ch.svg',
  },
  {
    name: 'Haluk Yilmaz',
    badge: 'NLP & Lore',
    avatar: '/haluk.png',
    linkedin: 'https://www.linkedin.com/in/haluk-y-751a07386/',
    degree: 'MEng in Computer Science',
    unis: [{ name: 'KULeuven', logo: '/kuleuven.svg' }],
    region: 'Belgium',
    flag: '/flag-be.svg',
  },
  {
    name: 'Bilal Vandenberge',
    badge: 'Domain Ops',
    avatar: '/bilal.png',
    linkedin: 'https://www.linkedin.com/in/bilal-vandenberge/',
    degree: 'MEng in Computer Science',
    unis: [{ name: 'KULeuven', logo: '/kuleuven.svg' }],
    region: 'Belgium',
    flag: '/flag-be.svg',
  },
]

const BEST_FEATURES = [
  {
    title: 'Our dynamic graphs',
    description:
      "Building a knowledge graph starts with understanding it. Even though our tool is autonomous and doesn't require human assistance, we provide a complete suite of visualization widgets to show the knowledge graph, the network, and the analytics clearly.",
  },
  {
    title: 'Correlation detection',
    description:
      'We do more than just extract knowledge from chats; we find correlations. Some network issues are related in time or affect neighboring equipment. We also represent those links as insights in the knowledge graph.',
  },
  {
    title: 'Simulated company day',
    description:
      'Want to see ElidEx in action? The Company Day tab allows you to simulate a day of chats and issues, with the graph growing live from synthetic data.',
  },
] as const

const FEATURE_GRAPH_NODES: ForceNode[] = [
  { id: 'assertion-1', label: 'Do not dispatch for RAD-198', color: '--k-knowledge', shape: 'circle', radius: 25 },
  { id: 'thread-1', label: '#noc-handover', color: '--k-event', shape: 'square', radius: 14 },
  { id: 'person-1', label: 'Helmi Hakkarainen', color: '--k-person', shape: 'circle', radius: 13 },
  { id: 'element-1', label: 'RAD-198', color: '--k-equipment', shape: 'square', radius: 12 },
]

const FEATURE_GRAPH_LINKS: ForceLink[] = [
  { id: 'graph-link-1', source: 'assertion-1', target: 'thread-1', kind: 'edge' },
  { id: 'graph-link-2', source: 'assertion-1', target: 'person-1', kind: 'edge' },
  { id: 'graph-link-3', source: 'assertion-1', target: 'element-1', kind: 'edge', dash: [4, 4] },
  { id: 'graph-link-4', source: 'thread-1', target: 'person-1', kind: 'edge' },
]

const FEATURE_INSIGHT_NODES: ForceNode[] = [
  { id: 'site-turku', label: 'Turku harbour hut', color: '--k-site', shape: 'square', radius: 20, isGroup: true },
  { id: 'site-tampere', label: 'Tampere exchange', color: '--k-site', shape: 'square', radius: 20, isGroup: true },
  { id: 'rad-254', label: 'RAD-254', color: '--k-event', shape: 'triangle', radius: 15, group: 'site-turku', alert: true },
  { id: 'trn-305', label: 'TRN-305', color: '--k-group', shape: 'diamond', radius: 17, group: 'site-tampere', alert: true },
]

const FEATURE_INSIGHT_LINKS: ForceLink[] = [
  { id: 'site-rad-254', source: 'rad-254', target: 'site-turku', kind: 'anchor' },
  { id: 'site-trn-305', source: 'trn-305', target: 'site-tampere', kind: 'anchor' },
  { id: 'insight-rad-trn', source: 'rad-254', target: 'trn-305', kind: 'edge', dash: [6, 4] },
]

const FEATURE_FEED_MESSAGES = [
  { initials: 'JJ', color: 'bg-pink-600', name: 'Jaakko Järvinen', role: 'Network Engineer', text: 'I can do it! Do we want the cardamom ones too?', time: '08:16', subject: 'Friday chat' },
  { initials: 'RR', color: 'bg-red-600', name: 'Raimo Rantanen', role: 'Radio Specialist', text: "Cardamom or I'm not coming. Also the weekly planning is moved to 13:00, the room is booked.", time: '08:17', subject: 'Friday chat' },
  { initials: 'VV', color: 'bg-green-600', name: 'Veikko Vikkelä', role: 'Field Engineer', text: '13:00 works. Did anyone see the football last night?', time: '08:19', subject: 'Friday chat' },
]

export default function HomePage() {
  const navigate = useNavigate()
  const [booting, setBooting] = useState(false)
  const [activeFeature, setActiveFeature] = useState(0)
  const [typedDescription, setTypedDescription] = useState('')
  const activeDescription = BEST_FEATURES[activeFeature].description
  useEffect(() => {
    setTypedDescription('')
    let character = 0
    const timer = window.setInterval(() => {
      character += 1
      setTypedDescription(activeDescription.slice(0, character))
      if (character >= activeDescription.length) window.clearInterval(timer)
    }, 1000 / activeDescription.length)
    return () => window.clearInterval(timer)
  }, [activeDescription])
  // Entering the dashboard from here plays the boot sequence; opening /overview directly never does.
  const enter = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    setBooting(true)
  }
  return (
    <div className="landing h-full overflow-auto bg-bg text-text">
      {booting && <BootSequence onDone={() => navigate('/overview')} />}
      <header className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-4 px-6 py-6 sm:px-10 lg:grid-cols-[1fr_auto_1fr]">
        <a href="#home" aria-label="ElidEx home" className="flex items-center gap-3">
          <img src="/elidex-logo.png" alt="" className="size-9 object-contain" />
          <span className="font-display text-2xl font-semibold tracking-tight">
            Elid<span className="text-accent">Ex</span>
          </span>
        </a>
        <nav aria-label="Main navigation" className="col-span-2 row-start-2 flex items-center justify-center gap-12 text-sm lg:col-span-1 lg:row-start-auto">
          <a href="#how-it-works" className="flex items-center py-2 text-muted hover:text-text">
            How it works
          </a>
          <a href="#best-features" className="flex items-center py-2 text-muted hover:text-text">
            Our best features
          </a>
          <a href="#team" className="flex items-center py-2 text-muted hover:text-text">
            The team
          </a>
        </nav>
        <a
          href="https://github.com/The-trappists/since-ai-hackathon"
          target="_blank"
          rel="noopener noreferrer"
          className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium hover:border-accent lg:col-start-3"
        >
          See on GitHub
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-current">
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.3 9.4 7.87 10.93.58.11.79-.25.79-.56v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.53-1.34-1.3-1.7-1.3-1.7-1.07-.73.08-.72.08-.72 1.18.08 1.8 1.22 1.8 1.22 1.05 1.8 2.75 1.28 3.42.98.1-.76.41-1.28.75-1.57-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.2-3.1-.12-.3-.52-1.47.11-3.06 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.82 0c2.22-1.5 3.2-1.18 3.2-1.18.63 1.59.23 2.76.11 3.06.75.81 1.2 1.84 1.2 3.1 0 4.43-2.69 5.4-5.25 5.68.42.36.8 1.06.8 2.14v3.18c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
          </svg>
        </a>
      </header>
      <main id="home" className="mx-auto max-w-7xl px-6 sm:px-10">
        <section className="landing-hero grid items-center gap-12 py-14 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:py-24">
          <div>
            <p className="mb-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              <span className="h-px w-8 bg-accent" />
              from specialist chats to a knowledge graph
            </p>
            <h1 className="font-display text-5xl font-medium leading-[1.06] tracking-[-0.045em] sm:text-6xl xl:text-7xl">
              Your network has
              <br />a human side.
              <br />
              <span className="text-accent">Give it a memory.</span>
            </h1>
            <p className="mt-7 max-w-md text-base leading-relaxed text-muted">
              The workaround in a chat. The access detail in an email. ElidEx connects specialist knowledge to the network, so agents can
              use it when it matters.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <Link
                to="/overview"
                onClick={enter}
                className="flex items-center gap-3 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-on-accent hover:opacity-90"
              >
                Explore the dashboard <ArrowRight size={17} />
              </Link>
              <a href="#how-it-works" className="inline-flex items-center py-2 text-sm font-medium text-muted hover:text-text">
                Read more ↓
              </a>
            </div>
            <p className="mt-6 text-xs text-muted">Captured from conversations. No extra forms for specialists.</p>
          </div>
          <div className="knowledge-story rounded-2xl border border-line bg-surface p-5 sm:p-7">
            <div className="mb-6 flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">One conversation. Reusable context.</span>
              <span className="rounded border border-line px-2 py-1 text-[10px] text-muted">Elisa example</span>
            </div>
            <div className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">EE</span>
              <div>
                <div className="text-sm font-semibold">
                  Erkki <span className="ml-2 text-xs font-normal text-muted">Network expert</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed">
                  After an SFP swap on older units, check the counters. If they stay at zero, bounce the interface before rebooting.
                </p>
                <span className="mt-2 block text-[10px] text-muted">Paraphrased from Elisa’s example conversation</span>
              </div>
            </div>
            <div className="story-connector" aria-hidden="true">
              <span>Captured & linked</span>
            </div>
            <div className="rounded-xl border border-accent/30 bg-accent-soft p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-semibold text-accent">
                  <BookOpenCheck size={16} /> Workaround
                </span>
                <span className="text-[10px] font-medium text-ok">Confirmed in the conversation</span>
              </div>
              <h2 className="mt-4 font-display text-xl font-medium">Link up. No traffic.</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">Check counters → disable interface → wait → enable.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded border border-line bg-surface px-2 py-1 font-mono text-[10px]">TRN-042</span>
                <span className="rounded border border-line bg-surface px-2 py-1 text-[10px]">Older transmission units</span>
                <span className="rounded border border-line bg-surface px-2 py-1 text-[10px]">Source preserved</span>
              </div>
            </div>
            <div className="story-connector" aria-hidden="true">
              <span>Available to an agent</span>
            </div>
            <Link to="/knowledge" className="flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3 text-sm">
              <span>Useful again on a similar case</span>
              <ArrowRight size={17} className="text-accent" />
            </Link>
          </div>
        </section>
        <section id="how-it-works" className="scroll-mt-8 border-t border-line py-14 sm:py-20">
          <div className="mb-9 grid gap-x-8 gap-y-4 lg:grid-cols-[auto_1fr]">
            <h2 className="font-display text-3xl font-medium tracking-tight">Experience becomes context.</h2>
            <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted">
              Hidden knowledge is information not readily available in a centralized database; it is information only found in the minds of experienced network engineers. This leads us to the following question: how could we retrieve this knowledge to reuse it within automated network operations?
            </p>
            <p className="text-sm leading-relaxed text-muted lg:col-start-2">
              ElidEx captures specialist knowledge from everyday conversations, links it to the right network entities and time periods, then makes it available to autonomous agents when similar situations arise.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                icon: MessagesSquare,
                title: 'Collect from chats',
                text: 'Capture live specialist communications from Slack and email, building knowledge dynamically.',
                to: '/conversations',
                link: 'Read conversations',
              },
              {
                icon: Waypoints,
                title: 'Link to the right context',
                text: 'Bind each piece of knowledge to the right network entity and validity period. Assume nothing, prove everything.',
                to: '/graph',
                link: 'Explore the graph',
              },
              {
                icon: BookOpenCheck,
                title: 'Ready for automation',
                text: 'A knowledge graph ready for autonomous agents, exportable as JSON, Markdown, and more. No human required!',
                to: '/knowledge',
                link: 'Browse knowledge',
              },
            ].map(({ icon: Icon, title, text, to, link }) => (
              <article key={to} className="flex flex-col border-t border-line pt-6">
                <Icon size={23} className="mb-5 text-accent" />
                <h3 className="font-display text-lg font-medium">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{text}</p>
                <Link to={to} className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-medium text-accent">
                  {link}
                  <ArrowRight size={14} />
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section id="best-features" className="scroll-mt-8 border-t border-line py-14 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.6fr] lg:gap-16">
            <div className="flex flex-col">
              <h2 className="font-display text-3xl font-medium tracking-tight">Our best features</h2>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                {typedDescription}
              </p>
              <div className="mt-auto divide-y divide-line border-b border-line pt-10">
                {BEST_FEATURES.map((feature, index) => (
                  <button
                    key={feature.title}
                    type="button"
                    onClick={() => setActiveFeature(index)}
                    aria-pressed={activeFeature === index}
                    className={`block w-full py-4 text-left font-display text-lg transition-colors ${activeFeature === index ? 'text-text' : 'text-muted hover:text-text'}`}
                  >
                    {feature.title}
                  </button>
                ))}
              </div>
            </div>
            <div aria-live="polite" className="relative aspect-[1.65/1] min-h-64 w-full min-w-0 overflow-hidden rounded-3xl border border-line bg-[#101113]">
              {activeFeature === 0 ? (
                <ForceCanvas
                  mode="knowledge"
                  nodes={FEATURE_GRAPH_NODES}
                  links={FEATURE_GRAPH_LINKS}
                  selectedId={null}
                  onSelect={() => {}}
                  ariaLabel="Synthetic knowledge graph showing a network assertion, a person, a conversation and a network element."
                />
              ) : activeFeature === 1 ? (
                <ForceCanvas
                  mode="topology"
                  nodes={FEATURE_INSIGHT_NODES}
                  links={FEATURE_INSIGHT_LINKS}
                  selectedId={null}
                  emphasis={{ nodes: { 'rad-254': 'bad', 'trn-305': 'bad' }, links: ['insight-rad-trn'], linkTone: 'bad' }}
                  onSelect={() => {}}
                  ariaLabel="Synthetic network insight showing related issues at Turku harbour hut."
                />
              ) : (
                <div className="relative flex h-full min-h-64 items-center justify-center overflow-hidden p-8 text-center">
                  <div aria-hidden="true" className="absolute inset-0 opacity-75 blur-[4px]">
                    <div className="h-full overflow-hidden bg-surface text-left text-text">
                      <div className="border-b border-line px-3 py-2.5 text-sm font-medium">Conversations</div>
                      <div className="h-full overflow-hidden">
                        <div className="feature-message-flow divide-y divide-line">
                          {[
                            ...FEATURE_FEED_MESSAGES,
                            ...FEATURE_FEED_MESSAGES,
                            ...FEATURE_FEED_MESSAGES,
                            ...FEATURE_FEED_MESSAGES,
                            ...FEATURE_FEED_MESSAGES,
                            ...FEATURE_FEED_MESSAGES,
                          ].map((message, index) => (
                          <div key={`${message.initials}-${index}`} className="flex gap-2.5 px-3 py-2">
                            <span className={`mt-0.5 flex size-[26px] shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white ${message.color}`}>{message.initials}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-xs"><span className="font-medium">{message.name}</span><span className="truncate text-muted">{message.role}</span><span className="ml-auto rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">Teams</span></div>
                              <p className="text-[13px] leading-snug">{message.text}</p>
                              <p className="mt-0.5 text-[11px] text-muted">{message.time} · {message.subject}</p>
                            </div>
                          </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div aria-hidden="true" className="absolute inset-0 bg-black/35" />
                  <Link to="/company" className="relative z-10 inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-ok px-7 text-base font-semibold text-black transition-colors hover:brightness-95">
                    <Play size={15} />
                    Start the day
                  </Link>
                </div>
              )}
            </div>
          </div>
        </section>
        <section id="team" className="scroll-mt-8 border-t border-line py-14 sm:py-20">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Built at Since AI 2026</p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight">Meet The Trappists.</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TEAM_MEMBERS.map((member) => (
              <article key={member.name} className="flex h-full flex-col rounded-xl border border-line bg-surface p-5">
                <div className="mb-5 flex size-24 items-center justify-center overflow-hidden rounded-full bg-surface-2 font-display text-xl text-muted">
                  {member.avatar ? <img src={member.avatar} alt="" className="size-full object-cover" /> : member.name.slice(0, 1)}
                </div>
                <h3 className="font-display text-xl font-medium">
                  {member.linkedin ? (
                    <a href={member.linkedin} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2 hover:text-accent">
                      {member.name}
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-current">
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.35V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1-.001-4.123 2.062 2.062 0 0 1 .001 4.123zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                      </svg>
                    </a>
                  ) : (
                    member.name
                  )}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">{member.degree}</p>
                <p className="mt-auto pt-5 text-xs text-muted">
                  {member.unis.map((u) => u.name).join(' & ')} · {member.region}
                </p>
              </article>
            ))}
          </div>
        </section>
        <TechnologyStack />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-10 sm:grid-cols-2 sm:px-10 lg:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <a href="#home" className="font-display text-lg font-semibold tracking-tight hover:text-accent">
              Elid<span className="text-accent">Ex</span>
            </a>
            <p className="mt-2 max-w-xs text-sm leading-relaxed">Hidden knowledge? No thank you!</p>
            <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
              © Built by The Trappists for Elisa at Since AI Hackathon
            </p>
          </div>
          <div>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Explore</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li><a href="/overview" className="hover:text-accent">Dashboard</a></li>
              <li>
                <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                  Demo
                </a>
              </li>
              <li><a href="https://www.elisa.com/" target="_blank" rel="noopener noreferrer" className="hover:text-accent">Elisa</a></li>
              <li><a href="https://sinceai.ai/hackathon" target="_blank" rel="noopener noreferrer" className="hover:text-accent">Since AI Hackathon</a></li>
            </ul>
          </div>
          <div>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Project</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a href="https://github.com/The-trappists/since-ai-hackathon" target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                  GitHub
                </a>
              </li>
              <li>
                <a href="https://github.com/The-trappists/since-ai-hackathon#hackathon-and-license-context" target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                  License
                </a>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  )
}
