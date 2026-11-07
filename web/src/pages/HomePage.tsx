import { ArrowRight, BookOpenCheck, MessagesSquare, Waypoints } from 'lucide-react'
import { Link } from 'react-router-dom'

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
    name: 'Haluk Yilmaz',
    badge: 'NLP & Lore',
    avatar: '/haluk.png',
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
  return (
    <div className="landing h-full overflow-auto bg-bg text-text">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <a href="#home" aria-label="ElidEx home" className="flex items-center gap-3">
          <img src="/elidex-logo.png" alt="" className="size-9 object-contain" />
          <span className="font-display text-2xl font-semibold tracking-tight">
            Elid<span className="text-accent">Ex</span>
          </span>
        </a>
        <nav aria-label="Main navigation" className="flex items-center gap-5 text-sm">
          <a href="#how-it-works" className="hidden text-muted hover:text-text sm:block">
            How it works
          </a>
          <a href="#team" className="text-muted hover:text-text">
            The team
          </a>
          <Link
            to="/overview"
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 font-medium hover:border-accent"
          >
            Open workbench <ArrowRight size={15} />
          </Link>
        </nav>
      </header>
      <main id="home" className="mx-auto max-w-7xl px-6 sm:px-10">
        <section className="landing-hero grid items-center gap-12 py-14 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:py-24">
          <div>
            <p className="mb-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              <span className="h-px w-8 bg-accent" />
              The as-experienced network
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
                className="flex items-center gap-3 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-on-accent hover:opacity-90"
              >
                Explore the workbench <ArrowRight size={17} />
              </Link>
              <a href="#how-it-works" className="text-sm font-medium text-muted hover:text-text">
                Follow a piece of knowledge ↓
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
          <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display text-3xl font-medium tracking-tight">Experience becomes context.</h2>
            <p className="max-w-md text-sm leading-relaxed text-muted">
              Elisa’s challenge: make human knowledge available to autonomous network operations, without adding work for specialists.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                icon: MessagesSquare,
                title: 'Listen where work happens',
                text: 'Capture useful knowledge from existing chats and emails. Keep the source conversation close.',
                to: '/conversations',
                link: 'Read conversations',
              },
              {
                icon: Waypoints,
                title: 'Connect it to the right context',
                text: 'Bind each assertion to equipment, a site or a class, with its source, trust and period of validity.',
                to: '/graph',
                link: 'Explore the graph',
              },
              {
                icon: BookOpenCheck,
                title: 'Make experience reusable',
                text: 'Give agents context for similar cases. Later conversations can confirm, challenge or retire that knowledge.',
                to: '/knowledge',
                link: 'Browse knowledge',
              },
            ].map(({ icon: Icon, title, text, to, link }) => (
              <article key={to} className="border-t border-line pt-6">
                <Icon size={23} className="mb-5 text-accent" />
                <h3 className="font-display text-lg font-medium">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{text}</p>
                <Link to={to} className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-accent">
                  {link}
                  <ArrowRight size={14} />
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section id="team" className="scroll-mt-8 border-t border-line py-14 sm:py-20">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Built at Since AI 2026</p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight">Meet The Trappists.</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TEAM_MEMBERS.map((member) => (
              <article key={member.name} className="rounded-xl border border-line bg-surface p-5">
                <div className="mb-5 flex size-14 items-center justify-center overflow-hidden rounded-full bg-surface-2 font-display text-xl text-muted">
                  {member.avatar ? <img src={member.avatar} alt="" className="size-full object-cover" /> : member.name.slice(0, 1)}
                </div>
                <h3 className="font-display text-xl font-medium">
                  {member.linkedin ? (
                    <a href={member.linkedin} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                      {member.name} ↗
                    </a>
                  ) : (
                    member.name
                  )}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">{member.degree}</p>
                <p className="mt-4 text-xs">{member.unis.map((u) => u.name).join(' · ')}</p>
                <p className="mt-2 text-xs text-muted">{member.region}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-7 text-xs text-muted sm:px-10">
        <span>ElidEx · Human knowledge, connected.</span>
        <a href="/demo/" className="flex items-center gap-2 hover:text-text">
          Open the product demo <ArrowRight size={14} />
        </a>
      </footer>
    </div>
  )
}
