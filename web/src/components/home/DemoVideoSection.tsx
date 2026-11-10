import { Download, ExternalLink } from 'lucide-react'

/** Video card only: the `#how-it-works` section header belongs to HomePage. */
export function DemoVideoSection() {
  return (
    <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-2.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full bg-line" />
          <span className="size-2.5 shrink-0 rounded-full bg-line" />
          <span className="size-2.5 shrink-0 rounded-full bg-line" />
          <span className="ml-2 truncate font-mono text-[11px] text-muted">elidex-demo.mp4</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://youtu.be/XQCUgTxHnx0"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-1.5 py-1 text-muted hover:text-text"
            title="Watch on YouTube"
          >
            <ExternalLink size={13} />
            <span>YouTube</span>
          </a>
          <a
            href="/elidex-demo.mp4"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-1.5 py-1 text-muted hover:text-text"
            title="Open video in a new browser tab"
          >
            <ExternalLink size={13} />
            <span>Open direct</span>
          </a>
          <a
            href="/elidex-demo.mp4"
            download="elidex-demo.mp4"
            className="inline-flex min-h-8 items-center gap-1.5 py-1 font-medium text-accent hover:opacity-80"
            title="Download MP4 demo video"
          >
            <Download size={13} />
            <span>Download</span>
          </a>
        </div>
      </div>

      <div className="relative aspect-video w-full bg-black">
        <video controls playsInline preload="metadata" poster="/demo-poster.jpg" className="h-full w-full object-contain">
          <source src="/elidex-demo.mp4" type="video/mp4" />
          <track src="/subtitles-en.vtt" kind="subtitles" srcLang="en" label="English" default />
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  )
}
