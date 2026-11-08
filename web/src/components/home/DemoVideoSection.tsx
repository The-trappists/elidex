import { Download, ExternalLink, Play, Sparkles, ShieldCheck, Zap, Network } from 'lucide-react'
import { useRef, useState } from 'react'

interface Chapter {
  time: number
  timestamp: string
  label: string
  description: string
}

const CHAPTERS: Chapter[] = [
  { time: 0, timestamp: '0:00', label: 'Field Incident', description: 'TRN-042 optic swap in Northern Finland' },
  { time: 18, timestamp: '0:18', label: 'Unwritten Advice', description: "Erkki's workaround in Slack" },
  { time: 35, timestamp: '0:35', label: 'ElidEx Ingestion', description: 'Zero forms, extracted machine rule' },
  { time: 50, timestamp: '0:50', label: 'Deterministic Link', description: 'Scoped strictly to older TX units' },
  { time: 68, timestamp: '1:08', label: '4:00 AM Agent Fix', description: 'TRN-088 resolved while Erkki sleeps' },
  { time: 87, timestamp: '1:27', label: 'Patterns & Hotspots', description: 'Topology insights & firmware 4.2' },
]

const HIGHLIGHTS = [
  {
    icon: Zap,
    title: 'Zero Specialist Overhead',
    desc: 'Passively captures operational know-how from Slack & Teams. Engineers never fill out a form.',
  },
  {
    icon: ShieldCheck,
    title: 'Exact Evidence Critic',
    desc: 'Dual-LLM pipeline verifies every extracted assertion against verbatim source quotes before storage.',
  },
  {
    icon: Network,
    title: 'Deterministic Binding',
    desc: 'Prevents catastrophic over-linking by scoping workarounds strictly to verified hardware classes.',
  },
  {
    icon: Sparkles,
    title: 'Sub-Second Agent Action',
    desc: 'Exposes context via REST & MCP so autonomous agents resolve outages without waking humans.',
  },
]

export function DemoVideoSection() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [activeChapter, setActiveChapter] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const seekTo = (seconds: number, index: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds
      videoRef.current.play().catch(() => {})
      setActiveChapter(index)
      setIsPlaying(true)
    }
  }

  const handleTimeUpdate = () => {
    if (!videoRef.current) return
    const cur = videoRef.current.currentTime
    let currentIdx = 0
    for (let i = CHAPTERS.length - 1; i >= 0; i--) {
      if (cur >= CHAPTERS[i].time) {
        currentIdx = i
        break
      }
    }
    if (currentIdx !== activeChapter) {
      setActiveChapter(currentIdx)
    }
  }

  return (
    <section id="demo" className="scroll-mt-8 border-t border-line py-14 sm:py-20">
      <div className="mx-auto max-w-5xl">
        {/* Section Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
            <span className="size-2 rounded-full bg-accent animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em]">
              Official Walkthrough · 2 min 13 sec
            </span>
          </div>
          <h2 className="mt-4 font-display text-3xl font-medium tracking-tight sm:text-4xl">
            Watch ElidEx in action.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            From an unwritten Slack conversation between specialists to verified rule extraction,
            deterministic network binding, and autonomous 4:00 AM incident remediation.
          </p>
        </div>

        {/* Video Player Card */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
          {/* Window Chrome Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-line" />
              <span className="size-2.5 rounded-full bg-line" />
              <span className="size-2.5 rounded-full bg-line" />
              <span className="ml-2 font-mono text-[11px] text-muted">
                elidex-demo.mp4 <span className="text-[10px] opacity-70">(1080p · Subtitles EN · 2:13)</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/elidex-demo.mp4"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-muted hover:text-text"
                title="Open video in a new browser tab"
              >
                <ExternalLink size={13} />
                <span>Open direct</span>
              </a>
              <a
                href="/elidex-demo.mp4"
                download="elidex-demo.mp4"
                className="inline-flex items-center gap-1.5 font-medium text-accent hover:opacity-80"
                title="Download MP4 demo video"
              >
                <Download size={13} />
                <span>Download</span>
              </a>
            </div>
          </div>

          {/* Video Player Element */}
          <div className="relative aspect-video w-full bg-black">
            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              poster="/demo-poster.jpg"
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              className="h-full w-full object-contain"
            >
              <source src="/elidex-demo.mp4" type="video/mp4" />
              <track
                src="/subtitles-en.vtt"
                kind="subtitles"
                srcLang="en"
                label="English"
                default
              />
              Your browser does not support the video tag.
            </video>
          </div>

          {/* Interactive Chapter Quick Jumps */}
          <div className="border-t border-line bg-surface-2/60 p-3 sm:p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Jump to scene:
              </span>
              <span className="text-xs text-muted">
                {isPlaying ? 'Now playing:' : 'Click to jump & play:'}{' '}
                <span className="font-medium text-text">{CHAPTERS[activeChapter].label}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {CHAPTERS.map((chapter, idx) => {
                const isActive = activeChapter === idx
                return (
                  <button
                    key={chapter.timestamp}
                    type="button"
                    onClick={() => seekTo(chapter.time, idx)}
                    className={`group flex flex-col rounded-lg border p-2 text-left transition-all ${
                      isActive
                        ? 'border-accent bg-accent/10 shadow-sm'
                        : 'border-line bg-surface hover:border-line hover:bg-surface-2'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-semibold text-accent">{chapter.timestamp}</span>
                      <Play
                        size={11}
                        className={`transition-opacity ${
                          isActive ? 'text-accent opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      />
                    </div>
                    <span className="mt-1 truncate text-xs font-medium text-text">
                      {chapter.label}
                    </span>
                    <span className="truncate text-[10px] text-muted">{chapter.description}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* 4 Pillars Highlight Grid */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HIGHLIGHTS.map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.title}
                className="flex flex-col rounded-xl border border-line bg-surface p-4 transition-colors hover:border-accent/40"
              >
                <div className="mb-3 flex size-8 items-center justify-center rounded-lg bg-surface-2 text-accent">
                  <Icon size={17} />
                </div>
                <h3 className="text-sm font-semibold text-text">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{item.desc}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
