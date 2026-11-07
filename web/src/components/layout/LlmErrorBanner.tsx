import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLive } from '../../store/live'
import { IconButton } from '../ui'

const RECENT_MS = 15 * 60 * 1000

/** Plain-language reason for a provider error string. */
function explain(error: string): string {
  if (/\b402\b/.test(error)) return 'LLM out of credits (HTTP 402).'
  if (/\b401\b|\b403\b/.test(error)) return 'LLM provider rejected the API key (HTTP 401/403).'
  if (/\b429\b/.test(error)) return 'LLM provider is rate limiting calls (HTTP 429).'
  if (/timeout|timed out/i.test(error)) return 'The LLM call timed out.'
  return 'The last LLM call failed.'
}

/** Top-level warning when recent LLM calls failed, with a shortcut to switch to scripted extraction. */
export function LlmErrorBanner() {
  const calls = useLive((s) => s.llmCalls)
  const mode = useLive((s) => s.settings?.extractor_mode)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const last = calls.length ? calls[calls.length - 1] : null
  if (!last?.error || mode === 'scripted' || dismissed === last.id) return null
  if (Date.now() - new Date(last.ts).getTime() > RECENT_MS) return null
  const recent = calls.slice(-10)
  const failed = recent.filter((c) => c.error).length

  return (
    <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-bad/40 bg-bad/10 px-4 py-2 text-sm">
      <AlertTriangle size={16} className="shrink-0 text-bad" />
      <div className="min-w-0 flex-1 truncate" title={last.error}>
        <span className="font-semibold text-bad">{explain(last.error)}</span>{' '}
        <span className="text-muted">
          {failed} of the last {recent.length} calls failed{last.fallback_used ? ', scripted fallback used' : ''}.
        </span>{' '}
        <span className="font-mono text-xs text-muted">{last.error}</span>
      </div>
      <Link to="/settings" className="shrink-0 rounded-lg bg-bad px-3 py-1 text-xs font-medium text-white hover:opacity-90">
        Switch to Scripted in Settings
      </Link>
      <Link to="/llm" className="shrink-0 text-xs font-medium text-bad hover:underline">
        LLM log
      </Link>
      <IconButton className="shrink-0" onClick={() => setDismissed(last.id)} aria-label="Dismiss">
        <X size={14} />
      </IconButton>
    </div>
  )
}
