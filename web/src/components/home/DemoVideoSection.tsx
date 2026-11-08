import { Download, ExternalLink } from 'lucide-react'
import { useRef } from 'react'

export function DemoVideoSection() {
  const videoRef = useRef<HTMLVideoElement>(null)

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
                href="https://youtu.be/XQCUgTxHnx0"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-muted hover:text-text"
                title="Watch on YouTube"
              >
                <ExternalLink size={13} />
                <span>YouTube</span>
              </a>
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
        </div>
      </div>
    </section>
  )
}
