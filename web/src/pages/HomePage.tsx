import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  CheckCircle2,
  FileText,
  KeyRound,
  MessagesSquare,
  Network,
  Scroll,
  ShieldAlert,
  Sparkles,
  Users,
  Waypoints,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
    name: 'Matteo',
    badge: 'UnPtitBelge',
    avatar: '/matteo.png',
    linkedin: 'https://www.linkedin.com/in/matteo-morbee-cs/',
    degree: 'M.Sc Computer Science, Networks&Systems specialization',
    unis: [{ name: 'UCLouvain (Belgium)', logo: '/uclouvain.svg' }],
    region: 'Belgium',
    flag: '/flag-be.svg',
  },
  {
    name: 'Manuel',
    badge: 'mnlrc',
    avatar: '/manu.png',
    linkedin: 'https://www.linkedin.com/in/mnlrc/',
    degree: "Joint Cybersecurity Master's degree",
    unis: [
      { name: 'EPFL', logo: '/epfl.svg' },
      { name: 'ETHZ', logo: '/ethz.svg' },
    ],
    region: 'Switzerland',
    flag: '/flag-ch.svg',
  },
  {
    name: 'Haluk',
    badge: 'NLP & Lore',
    degree: 'MEng in Computer Science',
    unis: [{ name: 'KULeuven (Belgium)', logo: '/kuleuven.svg' }],
    region: 'Belgium',
    flag: '/flag-be.svg',
  },
  {
    name: 'Bilal',
    badge: 'Domain Ops',
    avatar: '/bilal.png',
    linkedin: 'https://www.linkedin.com/in/bilal-vandenberge/',
    degree: 'MEng in Computer Science',
    unis: [{ name: 'KULeuven (Belgium)', logo: '/kuleuven.svg' }],
    region: 'Belgium',
    flag: '/flag-be.svg',
  },
]

export default function HomePage() {
  const navigate = useNavigate()
  const [currentPage, setCurrentPage] = useState<number>(0)
  const [transitioning, setTransitioning] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)

  // Resistant scroll mechanics
  const isSwitchingRef = useRef(false)
  const scrollAccRef = useRef(0)
  const SCROLL_THRESHOLD = 140 // resistant threshold required before transition triggers

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // If modal/loading is active or already transitioning between sections, ignore
      if (transitioning || isSwitchingRef.current) return

      scrollAccRef.current += e.deltaY

      if (scrollAccRef.current > SCROLL_THRESHOLD) {
        // Scroll down
        if (currentPage < 3) {
          isSwitchingRef.current = true
          scrollAccRef.current = 0
          setCurrentPage((prev) => prev + 1)
          setTimeout(() => {
            isSwitchingRef.current = false
          }, 900)
        } else {
          scrollAccRef.current = 0
        }
      } else if (scrollAccRef.current < -SCROLL_THRESHOLD) {
        // Scroll up
        if (currentPage > 0) {
          isSwitchingRef.current = true
          scrollAccRef.current = 0
          setCurrentPage((prev) => prev - 1)
          setTimeout(() => {
            isSwitchingRef.current = false
          }, 900)
        } else {
          scrollAccRef.current = 0
        }
      }
    }

    // Decay accumulated scroll after brief inactivity
    const interval = setInterval(() => {
      scrollAccRef.current *= 0.75
      if (Math.abs(scrollAccRef.current) < 2) scrollAccRef.current = 0
    }, 120)

    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => {
      window.removeEventListener('wheel', handleWheel)
      clearInterval(interval)
    }
  }, [currentPage, transitioning])

  const goToPage = (pageIdx: number) => {
    if (transitioning || isSwitchingRef.current || pageIdx === currentPage) return
    isSwitchingRef.current = true
    scrollAccRef.current = 0
    setCurrentPage(pageIdx)
    setTimeout(() => {
      isSwitchingRef.current = false
    }, 900)
  }

  const handleEnterDashboard = (e?: React.MouseEvent) => {
    if (e) e.preventDefault()
    if (transitioning) return
    setTransitioning(true)

    // Smooth sequence across ~1.2s total (max 2s)
    setTimeout(() => setLoadingStep(1), 350)
    setTimeout(() => setLoadingStep(2), 750)
    setTimeout(() => {
      navigate('/overview')
    }, 1150)
  }

  const loadingMessages = [
    'Accessing ElidEx Codex…',
    'Linking tribal lore to topology…',
    'Synchronizing autonomous guard…',
  ]

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg text-text selection:bg-accent/20 selection:text-accent">
      {/* Dynamic ambient background glows */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -z-10 h-[550px] w-[900px] -translate-x-1/2 rounded-full bg-accent/15 blur-[120px]" />
        <div className="absolute top-1/2 right-[-10%] h-[400px] w-[500px] rounded-full bg-accent/10 blur-[100px]" />
        <div className="absolute bottom-[-10%] left-[-10%] h-[450px] w-[500px] rounded-full bg-accent/5 blur-[120px]" />
      </div>

      {/* Global Top Navbar */}
      <header className="fixed top-0 left-0 right-0 z-40 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 sm:px-10">
        <div className="flex items-center gap-3">
          <img src="/elidex-logo.png" alt="ElidEx" className="size-10 object-contain" />
          <span className="text-xl font-black tracking-tight text-text">
            Elid<span className="bg-gradient-to-r from-accent to-accent/70 bg-clip-text text-transparent">Ex</span>
          </span>
        </div>

        {/* Navigation Dots / Pills */}
        <nav className="flex max-w-[calc(100vw-8rem)] items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full border border-line/70 bg-surface/70 px-3 py-1.5 backdrop-blur-md sm:max-w-none">
          <button
            onClick={() => goToPage(0)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              currentPage === 0 ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-text'
            }`}
          >
            Home
          </button>
          <button
            onClick={() => goToPage(1)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              currentPage === 1 ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-text'
            }`}
          >
            Elisa Case
          </button>
          <button
            onClick={() => goToPage(2)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              currentPage === 2 ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-text'
            }`}
          >
            The Trappists
          </button>
          <button
            onClick={() => goToPage(3)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              currentPage === 3 ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-text'
            }`}
          >
            About Elisa
          </button>
        </nav>
      </header>

      {/* Sliding Multi-Page Viewport Container */}
      <div
        className="h-full w-full transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `translateY(-${currentPage * 100}%)` }}
      >
        {/* ================= SECTION 0: HERO LANDING ================= */}
        <section className="relative flex h-screen w-full flex-col justify-between px-6 pt-24 pb-6 sm:px-10">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center py-6 text-center animate-fade-in [animation-duration:450ms]">
            {/* Trappists Hackathon Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent backdrop-blur-md">
              <Sparkles size={14} className="animate-pulse" />
              <span>The Trappists • Elisa Challenge 2026</span>
            </div>

            {/* Hero title */}
            <div className="mb-4 flex flex-col items-center">
              <h1 className="text-5xl font-black tracking-tight sm:text-7xl lg:text-8xl">
                Elid<span className="bg-gradient-to-r from-accent via-accent/80 to-accent/60 bg-clip-text text-transparent">Ex</span>
              </h1>
            </div>

            {/* Slogan Container (TBD placeholder ready for final text) */}
            <div className="mb-8 max-w-2xl">
              <p className="text-xl font-semibold tracking-tight text-text/90 sm:text-2xl">
                Hidden knowledge? No thank you!
              </p>
            </div>

            {/* Three Pillars Summary Cards */}
            <div className="grid w-full gap-4 text-left sm:grid-cols-3">
              <div className="group rounded-2xl border border-line bg-surface/60 p-5 backdrop-blur-md transition-all hover:border-accent/40 hover:shadow-lg">
                <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                  <MessagesSquare size={18} />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-text">1. Capture</h3>
                <p className="text-xs leading-relaxed text-muted">
                  Parses Slack and email for useful context.
                  <br />
                  Links it to network assets for agents.
                </p>
              </div>

              <div className="group rounded-2xl border border-line bg-surface/60 p-5 backdrop-blur-md transition-all hover:border-accent/40 hover:shadow-lg">
                <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                  <Waypoints size={18} />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-text">2. Link</h3>
                <p className="text-xs leading-relaxed text-muted">
                  Anchors human context directly onto nodes, sites, and hardware classes with validity intervals.
                </p>
              </div>

              <div className="group rounded-2xl border border-line bg-surface/60 p-5 backdrop-blur-md transition-all hover:border-accent/40 hover:shadow-lg">
                <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                  <Bot size={18} />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-text">3. Automate</h3>
                <p className="text-xs leading-relaxed text-muted">
                  Enhances autonomous network operations avoiding additional work for the specialists
                </p>
              </div>
            </div>

            {/* Start / Enter Dashboard Primary CTA Button */}
            <div className="mt-8 flex flex-col items-center gap-2.5">
              <button
                onClick={() => handleEnterDashboard()}
                disabled={transitioning}
                className="group relative inline-flex items-center gap-3 overflow-hidden rounded-2xl bg-accent px-8 py-4 text-base font-bold text-white shadow-xl shadow-accent/25 transition-all duration-300 hover:scale-[1.03] hover:bg-accent/90 hover:shadow-2xl hover:shadow-accent/35 active:scale-[0.98] disabled:scale-100 disabled:opacity-80"
              >
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                <span>Enter Dashboard</span>
                <ArrowRight size={18} className="transition-transform duration-200 group-hover:translate-x-1" />
              </button>
              <span className="text-xs text-muted">Direct entry into live operations workbench</span>
            </div>
          </div>

          {/* Home page footer */}
          <footer className="mx-auto flex w-full max-w-5xl items-center justify-between border-t border-line/60 pt-3 text-xs text-muted">
            <span>ElidEx · Since AI 2026</span>
            <button
              onClick={() => goToPage(1)}
              className="group flex items-center gap-1.5 transition hover:text-text"
            >
              <span>Explore the Elisa case</span>
              <ArrowDown size={14} className="text-accent" />
            </button>
          </footer>
        </section>

        {/* ================= SECTION 1: ELISA CASE BRIEFING ================= */}
        <section className="relative flex h-screen w-full flex-col justify-between overflow-y-auto px-6 pt-24 pb-6 sm:px-10">
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center">
            {/* Section Header */}
            <div className="mb-6 max-w-3xl">
              <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-0.5 text-xs font-semibold text-muted">
                <FileText size={13} className="text-accent" />
                <span>Problem Briefing & Ground Truth Case</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">
                Why Telemetry Isn&apos;t Enough
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">
                Telecom networks are full of &ldquo;undocumented operational lore&rdquo; known only to veteran engineers. When autonomous AI agents rely purely on raw SNMP or Prometheus telemetry, they take naive actions—like ordering unnecessary reboots or dispatching technicians without access keys.
              </p>
            </div>

            {/* The Original Elisa Case Study: Erkki Expert & TRN-042 */}
            <div className="overflow-hidden rounded-2xl border border-line bg-surface/80 shadow-xl backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-between border-b border-line bg-surface-2 px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-6 items-center justify-center rounded-lg bg-accent/15 text-xs font-bold text-accent">
                    #1
                  </span>
                  <div>
                    <h3 className="text-xs font-bold text-text sm:text-sm">Original Elisa Example: The SFP Forwarding Trap</h3>
                    <p className="text-xs text-muted">Transmission Node TRN-042 • SFP replacement with 0 traffic counters</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-ok">
                  <CheckCircle2 size={14} />
                  <span>Resolved via Erkki&apos;s Tribal Lore</span>
                </div>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-12">
                {/* Left Column: Problem & Second Case */}
                <div className="flex flex-col gap-3 lg:col-span-5">
                  <div className="rounded-xl border border-bad/20 bg-bad/5 p-3.5">
                    <div className="flex items-center gap-2 font-semibold text-xs text-bad">
                      <ShieldAlert size={15} />
                      <span>The Blind Spot (What Telemetry Shows)</span>
                    </div>
                    <ul className="mt-2 space-y-1.5 text-xs text-muted">
                      <li className="flex items-start gap-2">
                        <span className="font-mono text-text">interface:</span>
                        <span className="font-bold text-ok">UP (Green)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-mono text-text">optical power:</span>
                        <span className="text-text">OK / Normal RX</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-mono text-text">alarms:</span>
                        <span className="text-text">Cleared</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-mono text-text">traffic counters:</span>
                        <span className="font-bold text-bad">Zero (0 bps)</span>
                      </li>
                    </ul>
                    <p className="mt-2.5 text-xs text-muted border-t border-bad/15 pt-2">
                      <strong className="text-text">Without ElidEx:</strong> AI assumes the replacement SFP is defective or reboots the whole unit.
                    </p>
                  </div>

                  <div className="rounded-xl border border-line bg-surface p-3.5">
                    <div className="flex items-center gap-2 font-semibold text-xs text-text">
                      <KeyRound size={15} className="text-accent" />
                      <span>Elisa Example 2: Northern Barrier Key</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">
                      Autonomous agent sent a technician to a remote site, but a locked barrier prevented access. The code was not in central databases, but buried in an old email.
                    </p>
                  </div>
                </div>

                {/* Right Column: Original Teams Chat Log */}
                <div className="flex flex-col justify-between rounded-xl border border-line bg-surface-2 p-4 lg:col-span-7">
                  <div>
                    <div className="mb-2 flex items-center justify-between border-b border-line pb-1.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                        <MessagesSquare size={13} className="text-accent" />
                        <span>Original Teams Discussion</span>
                      </div>
                      <span className="text-xs font-mono text-muted">data/elisa/teams_chat.json</span>
                    </div>

                    <div className="space-y-2 font-sans text-xs">
                      <div className="rounded-md bg-surface p-2 border border-line/60">
                        <span className="font-semibold text-text">Veikko Vikkelä: </span>
                        <span className="text-muted">&ldquo;Changed SFP on TRN-042. Link UP, alarms cleared, but 0 traffic. Another SFP?&rdquo;</span>
                      </div>
                      <div className="rounded-md border border-accent/30 bg-accent/5 p-2">
                        <span className="font-semibold text-accent">Erkki Expert: </span>
                        <span className="text-text">&ldquo;SFP is fine. Don&apos;t reboot unit. Disable interface, wait, enable again.&rdquo;</span>
                      </div>
                      <div className="rounded-md bg-surface p-2 border border-line/60">
                        <span className="font-semibold text-text">Veikko Vikkelä: </span>
                        <span className="text-text">&ldquo;Traffic is back 👍 Documented anywhere?&rdquo;</span>
                      </div>
                      <div className="rounded-md bg-surface p-2 border border-line/60">
                        <span className="font-semibold text-accent">Erkki Expert: </span>
                        <span className="text-muted">&ldquo;Not that I know of 😄 Learned over the years.&rdquo;</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-accent/30 bg-surface p-3 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-bold text-accent">
                      <Bot size={14} />
                      <span>How ElidEx Resolves It</span>
                    </div>
                    <p className="mt-1 text-xs text-muted leading-relaxed">
                      ElidEx links Erkki&apos;s condition (<code className="rounded bg-surface-2 px-1 text-text">counters == 0 after SFP swap</code>) to the unit class, preventing autonomous agents from triggering destructive reboots.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom navigation prompt */}
          <div className="mx-auto flex items-center justify-between w-full max-w-6xl pt-2">
            <button
              onClick={() => goToPage(0)}
              className="flex items-center gap-1 text-xs text-muted transition hover:text-text"
            >
              <ArrowUp size={13} />
              <span>Back to Top</span>
            </button>
            <button
              onClick={() => goToPage(2)}
              className="flex items-center gap-1.5 text-xs text-muted transition hover:text-text"
            >
              <span>Meet The Trappists</span>
              <ArrowDown size={13} className="text-accent animate-bounce" />
            </button>
          </div>
        </section>

        {/* ================= SECTION 2: MEET THE TRAPPISTS ================= */}
        <section className="relative flex h-screen w-full flex-col justify-between overflow-y-auto px-6 pt-24 pb-6 sm:px-10">
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center">
            {/* Team Header */}
            <div className="mb-8 max-w-5xl">
              <div className="max-w-2xl">
                <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                  <Sparkles size={14} />
                  <span>The Minds Behind ElidEx</span>
                </div>
                <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
                  The Trappists
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                  Combining Belgian folklore, the monastic discipline of illuminating operational manuscripts, and autonomous network telemetry, our team codifies unwritten operational knowledge for telecom NOCs.
                </p>
              </div>
            </div>

            {/* 4 Member Grid Cards */}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {TEAM_MEMBERS.map((member, idx) => (
                <div
                  key={member.name}
                  className="group relative flex flex-col justify-between rounded-2xl border border-line bg-surface/70 p-5 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-accent/50 hover:shadow-xl"
                >
                  <div>
                    {/* Picture / Avatar slot - magnified & responsive */}
                    <div className="relative mb-4 flex size-28 mx-auto sm:mx-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-md">
                      {member.avatar ? (
                        <img
                          src={member.avatar}
                          alt={member.name}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          onError={(e) => {
                            // Graceful fallback to initial if image fails to load
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-muted">
                          <Users size={32} className="text-accent/60 transition-transform group-hover:scale-110" />
                          <span className="text-xs font-mono mt-1 text-muted">Member</span>
                        </div>
                      )}
                      <div className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-surface text-xs font-black text-accent shadow">
                        0{idx + 1}
                      </div>
                    </div>

                    {/* Member details */}
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-base font-bold text-text group-hover:text-accent transition-colors">
                          {member.name}
                        </h3>
                        {member.linkedin && (
                          <a
                            href={member.linkedin}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-muted hover:text-[#0a66c2] transition-colors"
                            title={`${member.name} on LinkedIn`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg className="size-3.5 fill-current" viewBox="0 0 24 24">
                              <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
                            </svg>
                          </a>
                        )}
                      </div>
                      {member.badge && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-mono text-muted">
                          {member.badge}
                        </span>
                      )}
                    </div>
                    {/* Degree */}
                    <div className="mt-3 text-xs font-medium text-text leading-snug">
                      {member.degree}
                    </div>

                    {/* Universities & Logos */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {member.unis.map((uni) => (
                        <div
                          key={uni.name}
                          className="inline-flex items-center gap-1.5 rounded-md border border-line/80 bg-white/95 dark:bg-surface-2 px-2 py-1 shadow-xs"
                          title={uni.name}
                        >
                          <img
                            src={uni.logo}
                            alt={uni.name}
                            className="h-3.5 w-auto max-w-[46px] object-contain"
                          />
                          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                            {uni.name}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Region */}
                    <div className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-muted">
                      <img
                        src={member.flag}
                        alt={`${member.region} flag`}
                        className="h-3 w-4 rounded-[2px] object-cover shadow-2xs"
                      />
                      <span>{member.region}</span>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-line/60 pt-3 flex items-center justify-between text-xs text-muted">
                    <span>The Trappists</span>
                    <span className="font-mono text-accent">Since AI &apos;26</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Launch into Workbench Final Strip */}
            <div className="mt-8 flex flex-col items-center justify-between gap-4 rounded-2xl border border-accent/25 bg-surface/80 p-5 sm:flex-row sm:p-6 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-white shadow-md">
                  <Scroll size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-text sm:text-base">Experience ElidEx Live</h4>
                  <p className="text-xs text-muted">Interact with the real-time knowledge graph, extractor, and ask-before-act guard.</p>
                </div>
              </div>
              <button
                onClick={() => handleEnterDashboard()}
                disabled={transitioning}
                className="flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md transition hover:bg-accent/90 hover:shadow-lg active:scale-95"
              >
                <span>Enter Workbench</span>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>

          {/* Bottom Back to Top */}
          <div className="mx-auto flex items-center justify-between w-full max-w-6xl pt-2">
            <button
              onClick={() => goToPage(1)}
              className="flex items-center gap-1 text-xs text-muted transition hover:text-text"
            >
              <ArrowUp size={13} />
              <span>Previous (Elisa Case)</span>
            </button>
            <button
              onClick={() => goToPage(3)}
              className="flex items-center gap-1.5 text-xs text-muted transition hover:text-text"
            >
              <span>About Elisa</span>
              <ArrowDown size={13} className="text-accent" />
            </button>
          </div>
        </section>

        {/* ================= SECTION 3: ABOUT ELISA ================= */}
        <section className="relative flex h-screen w-full flex-col justify-between overflow-y-auto px-6 pt-24 pb-6 sm:px-10">
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center">
            <div className="mb-8 max-w-3xl">
              <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                <Network size={14} />
                <span>About the Challenge Partner</span>
              </div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">Why ElidEx for Elisa?</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                Elisa is the company behind this challenge. Its autonomous network operations already use AI, but that AI cannot act on operational knowledge that remains buried in conversations.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <article className="rounded-2xl border border-line bg-surface/70 p-6 shadow-sm backdrop-blur-md">
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Waypoints size={20} />
                </div>
                <h3 className="text-lg font-semibold">What is Elisa?</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Elisa is a telecommunications company and the challenge partner for this project. The challenge focuses on helping autonomous network operations use both live network data and the experience of the specialists who know the network.
                </p>
              </article>

              <article className="rounded-2xl border border-line bg-surface/70 p-6 shadow-sm backdrop-blur-md">
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Bot size={20} />
                </div>
                <h3 className="text-lg font-semibold">Why are we building this for Elisa?</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Useful workarounds, access details, and lessons from past fixes often live in chats and emails. ElidEx captures that context from the channels specialists already use, links it to the right network elements and time period, then makes it available to agents—without asking specialists to fill in forms.
                </p>
              </article>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-6xl items-center justify-between pt-2">
            <button
              onClick={() => goToPage(2)}
              className="flex items-center gap-1 text-xs text-muted transition hover:text-text"
            >
              <ArrowUp size={13} />
              <span>Previous (The Trappists)</span>
            </button>
            <button
              onClick={() => goToPage(0)}
              className="flex items-center gap-1.5 text-xs text-muted transition hover:text-text"
            >
              <span>Back to Top (Home)</span>
              <ArrowUp size={13} className="text-accent" />
            </button>
          </div>
        </section>
      </div>

      {/* Transition loading overlay (smooth sequence ~1.15s) */}
      {transitioning && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg/90 backdrop-blur-md animate-fade-in [animation-duration:250ms]">
          <div className="relative flex size-20 items-center justify-center rounded-2xl bg-surface shadow-2xl">
            <div className="absolute inset-0 animate-ping rounded-2xl bg-accent/20 [animation-duration:1.5s]" />
            <img src="/elidex-logo.png" alt="" className="relative size-14 object-contain" />
          </div>
          <div className="mt-6 flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <span className="size-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              <span>{loadingMessages[loadingStep]}</span>
            </div>
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-accent transition-all duration-300 ease-out"
                style={{ width: `${((loadingStep + 1) / loadingMessages.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
