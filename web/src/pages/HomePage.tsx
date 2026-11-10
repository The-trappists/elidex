import { ArrowRight, GitBranch, Menu, MessagesSquare, Play, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BootSequence } from '../components/home/BootSequence'
import { DemoVideoSection } from '../components/home/DemoVideoSection'
import { HowItWorks } from '../components/home/HowItWorks'
import { ProofSection, REPORT_URL } from '../components/home/ProofSection'

interface TeamMember {
  name: string
  university: string
  avatar: string
  linkedin: string
}

const TEAM_MEMBERS: TeamMember[] = [
  {
    name: 'Matteo Morbée',
    university: 'UCLouvain',
    avatar: '/matteo.png',
    linkedin: 'https://www.linkedin.com/in/matteo-morbee-cs/',
  },
  {
    name: 'Manuel Rocca',
    university: 'EPFL & ETHZ',
    avatar: '/manu.png',
    linkedin: 'https://www.linkedin.com/in/mnlrc/',
  },
  {
    name: 'Haluk Yilmaz',
    university: 'KU Leuven',
    avatar: '/haluk.png',
    linkedin: 'https://www.linkedin.com/in/haluk-y-751a07386/',
  },
  {
    name: 'Bilal Vandenberge',
    university: 'KU Leuven',
    avatar: '/bilal.png',
    linkedin: 'https://www.linkedin.com/in/bilal-vandenberge/',
  },
]

const OUTCOMES = [
  {
    title: 'No extra work',
    body: 'ElidEx reads the Teams threads and email specialists already write. Erkki never fills in a form.',
    icon: MessagesSquare,
  },
  {
    title: 'Right link, or none',
    body: 'Rules are bound to the exact element, model and site — and expire when they stop being true.',
    icon: GitBranch,
  },
  {
    title: 'Safe at 3 a.m.',
    body: 'Agents check conditions before acting. The guard turns a reboot into a counter check.',
    icon: ShieldCheck,
  },
] as const

export default function HomePage() {
  const navigate = useNavigate()
  const [booting, setBooting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const firstMenuLinkRef = useRef<HTMLAnchorElement>(null)

  // Entering the dashboard from here plays the boot sequence; opening /overview directly never does.
  const enter = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    setBooting(true)
  }

  const closeMenu = () => {
    setMenuOpen(false)
    menuButtonRef.current?.focus()
  }

  useEffect(() => {
    if (!menuOpen) return
    firstMenuLinkRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="landing h-full overflow-auto bg-bg text-text">
      {booting && <BootSequence onDone={() => navigate('/overview')} />}

      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6 sm:px-10">
          <a href="#home" aria-label="ElidEx home" className="flex items-center gap-3">
            <img src="/elidex-logo.png" alt="" className="size-9 object-contain" />
            <span className="font-display text-2xl font-semibold tracking-tight">
              Elid<span className="text-accent">Ex</span>
            </span>
          </a>
          <nav aria-label="Main navigation" className="hidden items-center gap-6 text-sm md:flex">
            <a href="#how-it-works" className="py-2 text-muted hover:text-text">
              Product
            </a>
            <a href="#proof" className="py-2 text-muted hover:text-text">
              Proof
            </a>
            <a href="#team" className="py-2 text-muted hover:text-text">
              Team
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <a
              href="https://github.com/The-trappists/elidex"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden py-2 text-sm text-muted hover:text-text sm:inline"
            >
              GitHub
            </a>
            <Link
              to="/overview"
              onClick={enter}
              className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:opacity-90"
            >
              Open dashboard
            </Link>
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="home-menu"
              onClick={() => setMenuOpen(true)}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text md:hidden"
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-text/30 backdrop-blur-[2px]" onClick={closeMenu} aria-hidden="true" />
          <div
            id="home-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-x-0 top-16 border-b border-line bg-surface p-4 shadow-[var(--shadow-md)]"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={closeMenu}
                className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
              >
                <X size={18} />
              </button>
            </div>
            <nav aria-label="Mobile navigation" className="flex flex-col">
              <a
                ref={firstMenuLinkRef}
                href="#how-it-works"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center border-t border-line py-3 text-sm text-muted hover:text-text"
              >
                Product
              </a>
              <a
                href="#proof"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center border-t border-line py-3 text-sm text-muted hover:text-text"
              >
                Proof
              </a>
              <a
                href="#team"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center border-t border-line py-3 text-sm text-muted hover:text-text"
              >
                Team
              </a>
              <a
                href="https://github.com/The-trappists/elidex"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center border-t border-line py-3 text-sm text-muted hover:text-text"
              >
                GitHub
              </a>
            </nav>
          </div>
        </div>
      )}

      <main id="home" className="mx-auto max-w-7xl scroll-mt-16 px-6 sm:px-10">
        <section className="landing-hero grid items-center gap-10 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-24">
          <div>
            <p className="mb-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              <span className="h-px w-8 bg-accent" />
              For Elisa · autonomous network operations
            </p>
            <h1 className="font-display text-[2.15rem] font-medium leading-[1.05] tracking-[-0.04em] sm:text-5xl xl:text-6xl">
              The answer was in a Teams chat.
              <span className="block text-accent">At 3 a.m., the network remembers it.</span>
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted">
              ElidEx turns everyday specialist conversations into verified operational knowledge, linked to the right equipment and ready
              for autonomous agents.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/overview"
                onClick={enter}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent hover:opacity-90"
              >
                Open the dashboard <ArrowRight size={16} />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:border-accent"
              >
                <Play size={14} className="fill-accent text-accent" /> Watch the demo · 2:13
              </a>
              <a href="#how-it-works" className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-muted hover:text-text">
                How it works ↓
              </a>
            </div>
            <p className="mt-5 text-xs text-muted">
              No forms. No documentation task. Prototype on Elisa's example and synthetic data.
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-7">
            <div className="mb-5 flex items-start justify-between gap-3">
              <h2 className="font-display text-lg font-medium leading-snug">From a Teams message to a 3 a.m. action</h2>
              <span className="shrink-0 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                Elisa example
              </span>
            </div>

            <div className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold"
              >
                EE
              </span>
              <div className="min-w-0">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Teams · 08:42</h3>
                <blockquote className="mt-2 text-sm leading-relaxed">
                  “Older units: after an SFP swap, check the counters. If they stay at zero, bounce the interface before rebooting.”
                </blockquote>
                <cite className="mt-2 block text-[11px] not-italic text-muted">Erkki · network expert (paraphrased)</cite>
              </div>
            </div>

            <div className="story-connector" aria-hidden="true">
              <span>Captured &amp; linked</span>
            </div>

            <div className="rounded-xl border border-accent/30 bg-accent-soft p-4">
              <h3 className="font-display text-lg font-medium">Link up, no traffic</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">Check counters → bounce the interface → no reboot.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded border border-line bg-surface px-2 py-1 font-mono text-[10px]">TRN-042</span>
                <span className="rounded border border-line bg-surface px-2 py-1 text-[10px]">Older units · around 2019</span>
                <span className="rounded border border-line bg-surface px-2 py-1 text-[10px]">Source preserved</span>
              </div>
            </div>

            <div className="story-connector" aria-hidden="true">
              <span>Available to an agent</span>
            </div>

            <div className="rounded-xl border border-ok/30 bg-ok/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Agent · 03:00</h3>
                <span className="flex items-center gap-1.5 text-[10px] font-medium text-ok">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
                  Ask-Before-Act guard
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed">Counters zero. Interface bounced. No reboot.</p>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-20 border-t border-line py-14 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="flex items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              <span className="h-px w-8 bg-accent" />
              See it work
              <span className="h-px w-8 bg-accent" />
            </p>
            <h2 className="mt-4 font-display text-3xl font-medium tracking-tight sm:text-4xl">
              One conversation, all the way to the agent.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
              The 2:13 walkthrough follows Elisa's TRN-042 example end to end.
            </p>
          </div>
          <div className="mt-8">
            <DemoVideoSection />
          </div>
          <HowItWorks />
          <p className="mt-8 text-center text-sm text-muted">
            Prefer to explore?{' '}
            <Link to="/company" className="inline-flex min-h-8 items-center font-medium text-accent hover:opacity-80">
              Run a simulated company day
            </Link>
            .
          </p>
        </section>

        <ProofSection />

        <section id="outcomes" className="border-t border-line py-14 sm:py-20">
          <p className="mb-4 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            <span className="h-px w-8 bg-accent" />
            Why it matters
          </p>
          <h2 className="font-display text-3xl font-medium tracking-tight">Built for how Elisa already works.</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {OUTCOMES.map((outcome) => {
              const Icon = outcome.icon
              return (
                <div key={outcome.title} className="border-t border-line pt-5">
                  <Icon aria-hidden="true" size={20} className="text-accent" />
                  <h3 className="mt-4 font-display text-lg font-medium">{outcome.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{outcome.body}</p>
                </div>
              )
            })}
          </div>
          <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">MCP and REST. No rip-and-replace.</p>
        </section>

        <section id="team" className="scroll-mt-20 border-t border-line py-14 sm:py-20">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Built at Since AI 2026</p>
              <h2 className="font-display text-3xl font-medium tracking-tight">The Trappists.</h2>
            </div>
            <p className="text-sm text-muted">Four engineers, three days, one context layer.</p>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {TEAM_MEMBERS.map((member) => (
              <div key={member.name} className="flex items-start gap-3">
                <img
                  src={member.avatar}
                  alt=""
                  className="size-10 shrink-0 rounded-full bg-surface-2 object-cover sm:size-12"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{member.name}</p>
                  <div className="mt-0.5 flex items-center gap-1">
                    <p className="text-xs text-muted">{member.university}</p>
                    <a
                      href={member.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${member.name} on LinkedIn`}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:text-accent"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-current">
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.35V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1-.001-4.123 2.062 2.062 0 0 1 .001 4.123zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-10 sm:grid-cols-2 sm:px-10 lg:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <a href="#home" className="inline-flex min-h-11 items-center font-display text-lg font-semibold tracking-tight hover:text-accent">
              Elid<span className="text-accent">Ex</span>
            </a>
            <p className="mt-2 max-w-xs text-sm leading-relaxed">Hidden knowledge? No thank you!</p>
            <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
              © Built by The Trappists for Elisa at Since AI Hackathon
            </p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Python · FastAPI · React · MCP</p>
          </div>
          <div>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Explore</h2>
            <ul className="mt-2 text-sm">
              <li>
                <Link to="/overview" onClick={enter} className="inline-flex min-h-11 min-w-8 items-center hover:text-accent">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link to="/knowledge" className="inline-flex min-h-11 min-w-8 items-center hover:text-accent">
                  Knowledge
                </Link>
              </li>
              <li>
                <a
                  href="https://youtu.be/XQCUgTxHnx0"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 min-w-8 items-center hover:text-accent"
                >
                  Demo video
                </a>
              </li>
              <li>
                <Link to="/company" className="inline-flex min-h-11 min-w-8 items-center hover:text-accent">
                  Company day
                </Link>
              </li>
              <li>
                <a
                  href={REPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 min-w-8 items-center hover:text-accent"
                >
                  Evaluation
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Project</h2>
            <ul className="mt-2 text-sm">
              <li>
                <a
                  href="https://github.com/The-trappists/elidex"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 min-w-8 items-center hover:text-accent"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/The-trappists/elidex/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 min-w-8 items-center hover:text-accent"
                >
                  License
                </a>
              </li>
              <li>
                <a href="https://elisa.com/" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-8 items-center hover:text-accent">
                  Elisa
                </a>
              </li>
              <li>
                <a
                  href="https://sinceai.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 min-w-8 items-center hover:text-accent"
                >
                  Since AI
                </a>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  )
}
