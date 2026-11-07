import { PageIntro } from '../components/layout/PageIntro'
import { Bot, Hash, Sparkles, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { ExtractorMode, Settings, SettingsPatch } from '../api/types'
import { cn } from '../lib/cn'
import { useLive } from '../store/live'
import { Badge, Card, Input, Toggle, withToast } from '../components/ui'

const MODES: { id: ExtractorMode; title: string; text: string }[] = [
  {
    id: 'auto',
    title: 'Automatic',
    text: 'Read conversations with AI when it is connected. Otherwise, use prepared answers for demo scenarios.',
  },
  { id: 'llm', title: 'AI only', text: 'Use AI for every conversation. Requires a connected model.' },
  { id: 'scripted', title: 'Prepared demo answers', text: 'Replay known scenarios with repeatable answers. New conversations need AI.' },
]

function Section({ title, intro, icon: Icon, children }: { title: string; intro?: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <Icon size={17} className="mt-0.5 shrink-0 text-muted" />
        <div>
          <h2 className="font-semibold tracking-tight">{title}</h2>
          {intro && <p className="mt-0.5 text-xs text-muted">{intro}</p>}
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </Card>
  )
}

const Row = ({ label, text, children }: { label: string; text: string; children: ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-2/70">
    <div className="min-w-0 flex-1 basis-48">
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-muted">{text}</div>
    </div>
    <div className="shrink-0 pt-0.5">{children}</div>
  </div>
)

function NumberSetting({ value, onSave, min = 0, suffix }: { value: number; onSave: (n: number) => void; min?: number; suffix: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    setDraft(null)
    if (draft.trim() !== '' && !Number.isNaN(n) && n >= min && n !== value) onSave(n)
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={min}
        className="w-24"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="text-xs text-muted">{suffix}</span>
    </div>
  )
}

export default function SettingsPage() {
  const settings = useLive((s) => s.settings)
  const slack = useLive((s) => s.slack)
  if (!settings) return null
  const save = (patch: SettingsPatch) => withToast(() => api.updateSettings(patch))
  const st: Settings = settings

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <PageIntro
          title="Make the workbench work for you"
          description="Choose how conversations become knowledge and how the demo runs. Knowledge flows automatically; no review queue is required."
        />
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="size-1.5 rounded-full bg-ok" /> Changes are saved as soon as you make them.
        </p>

        <Section icon={Sparkles} title="Reading conversations" intro="How a conversation is turned into knowledge.">
          <div className="grid gap-2">
            {MODES.map((m) => (
              <label
                key={m.id}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-md border p-3.5 transition-colors',
                  st.extractor_mode === m.id ? 'border-accent' : 'border-line hover:bg-surface-2',
                )}
              >
                <input
                  type="radio"
                  name="mode"
                  className="mt-1 accent-[var(--accent)]"
                  checked={st.extractor_mode === m.id}
                  onChange={() => save({ extractor_mode: m.id })}
                />
                <span>
                  <span className="text-sm font-medium">{m.title}</span>
                  <span className="block text-xs text-muted">{m.text}</span>
                </span>
              </label>
            ))}
          </div>
          {st.extractor_mode === 'llm' && !st.llm_configured && (
            <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-xs">
              The AI is selected but no key is configured, so every conversation will fail to be read. Ask the team to connect an AI
              provider, or choose Automatic.
            </div>
          )}
          <Row
            label="Retire outdated knowledge"
            text="Lets a later message close an earlier piece of knowledge (for example 'the old workaround no longer applies')."
          >
            <Toggle checked={st.lifecycle} onChange={(v) => save({ lifecycle: v })} />
          </Row>
          <Row
            label="Check when advice applies"
            text="Keeps the machine-checkable conditions of each piece of knowledge so agents can test them against observations."
          >
            <Toggle checked={st.use_conditions} onChange={(v) => save({ use_conditions: v })} />
          </Row>
          <Row label="Check planned actions" text="Checks an agent's planned action against the knowledge and says go or adapt.">
            <Toggle checked={st.use_guard} onChange={(v) => save({ use_guard: v })} />
          </Row>
          <Row label="Wait after the last message" text="How long a thread must stay quiet before the pipeline reads it.">
            <NumberSetting value={st.idle_seconds} suffix="seconds" onSave={(n) => save({ idle_seconds: n })} />
          </Row>
        </Section>

        <Section icon={SlidersHorizontal} title="Demo playback" intro="Scripted conversations that play on their own.">
          <Row label="Auto-run scenarios" text="Starts a random scenario at a regular interval for hands-free demonstrations.">
            <Toggle checked={st.auto_sim} onChange={(v) => save({ auto_sim: v })} />
          </Row>
          <Row label="Interval" text="Time between two automatic scenarios.">
            <NumberSetting value={st.auto_every_s} min={1} suffix="seconds" onSave={(n) => save({ auto_every_s: n })} />
          </Row>
        </Section>

        <Section icon={Hash} title="Slack" intro="Slack stands in for Teams, to show that the listening works on tools people already use.">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className={slack.connected ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted'}>
              {slack.connected ? 'Connected' : 'Not connected'}
            </Badge>
            {slack.channel && <span className="break-all font-mono text-xs">#{slack.channel.replace(/^#/, '')}</span>}
            {slack.error && <span className="text-xs text-bad">{slack.error}</span>}
          </div>
          <Row label="Mirror to Slack" text="Messages written in the workbench are also posted in the Slack channel.">
            <Toggle checked={st.slack_mirror} disabled={!slack.connected} onChange={(v) => save({ slack_mirror: v })} />
          </Row>
          {!slack.connected && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer font-medium">Connection setup for the team</summary>
              <p className="mt-2 leading-relaxed">
                A team member can connect the Slack app using the instructions in docs/slack-setup.md. Once connected, messages can be
                shared with the channel.
              </p>
            </details>
          )}
        </Section>

        <Section icon={Bot} title="Connected AI" intro="Which language models read the conversations. Set on the server, read-only here.">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-y-2 text-sm">
            <span className="text-muted">Ready to use</span>
            <span>
              <Badge className={st.llm_configured ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}>{st.llm_configured ? 'Yes' : 'No'}</Badge>
            </span>
            <span className="text-muted">Model</span>
            <span className="break-all font-mono text-xs">{st.llm_model ?? '—'}</span>
            <span className="text-muted">Backup model</span>
            <span className="break-all font-mono text-xs">{st.llm_fallback_model ?? '—'}</span>
          </div>
          {!st.llm_configured && (
            <p className="text-sm text-muted">
              No AI provider is connected. Ask the team to configure one on the server; prepared demo scenarios are still available.
            </p>
          )}
          <div className="flex gap-4 text-sm">
            <Link className="text-accent hover:underline" to="/llm">
              See what the AI did
            </Link>
            <Link className="text-accent hover:underline" to="/llm">
              Test the AI connection
            </Link>
          </div>
        </Section>
      </div>
    </div>
  )
}
