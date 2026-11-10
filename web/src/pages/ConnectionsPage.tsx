import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Hash,
  KeyRound,
  Link2,
  LockKeyhole,
  MessageSquare,
  Server,
  ShieldCheck,
  Sparkles,
  Unplug,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AI_PROVIDERS, connectionsApi, describeConnectionError, providerInfo, type AiProviderId, type ConnectionsSnapshot, type ProviderInfo } from '../api/connections'
import { PageIntro } from '../components/layout/PageIntro'
import { Badge, Button, Card, Field, Input, LoadingState } from '../components/ui'
import { cn } from '../lib/cn'
import { liveAiReady, useConnections } from '../store/connections'

function ProviderMark({ info, size = 28 }: { info?: ProviderInfo; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-md border border-line bg-white" style={{ width: size + 12, height: size + 12 }}>
      {info ? <img src={info.icon} alt="" width={size} height={size} className="object-contain" /> : <Bot size={size - 4} className="text-muted" />}
    </span>
  )
}

function NextStep({ to, icon: Icon, title, text }: { to: string; icon: LucideIcon; title: string; text: string }) {
  return (
    <Link
      to={to}
      className="group flex min-h-24 flex-col justify-between gap-3 rounded-md border border-line bg-surface p-3 transition hover:border-accent/50 hover:bg-accent-soft"
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Icon size={16} className="text-accent" />
        {title}
      </span>
      <span className="flex items-end justify-between gap-2 text-xs leading-relaxed text-muted">
        {text}
        <ArrowRight size={14} className="shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

function Readiness({ snapshot }: { snapshot: ConnectionsSnapshot }) {
  const ai = liveAiReady(snapshot)
  const slack = snapshot.slack.connected
  const steps = [
    {
      label: 'Explore',
      detail: 'The built-in demo is ready with no setup.',
      ready: true,
      optional: false,
      to: '/company',
      cta: 'Open the company day',
    },
    {
      label: 'Read your conversations',
      detail: ai ? 'A model is connected for this workspace.' : 'Connect one AI provider to read new conversations.',
      ready: ai,
      optional: false,
      to: ai ? '/conversations?new=1' : '#ai',
      cta: ai ? 'Create a conversation' : 'Connect an AI provider',
    },
    {
      label: 'Connect a channel',
      detail: slack ? 'Slack is connected.' : 'Optional: read a real Slack channel and mirror replies.',
      ready: slack,
      optional: !slack,
      to: '#slack',
      cta: slack ? 'Manage Slack' : 'Set up Slack',
    },
  ]
  const next = steps.findIndex((step) => !step.ready && !step.optional)
  return (
    <section aria-labelledby="readiness-title" className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Explore → Read your conversations → Connect a channel</p>
          <h2 id="readiness-title" className="mt-1 font-display text-lg font-medium tracking-tight">What is ready right now</h2>
        </div>
        <p className="max-w-sm text-xs leading-relaxed text-muted">The demo is always available. A model unlocks your own conversations; Slack is optional.</p>
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={cn(
              'flex flex-col rounded-md border p-3',
              step.ready ? 'border-ok/30 bg-ok/5' : step.optional ? 'border-line bg-bg' : 'border-accent/40 bg-accent-soft',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                  step.ready ? 'bg-ok text-white' : step.optional ? 'bg-surface-3 text-muted' : 'bg-accent text-on-accent',
                )}
                aria-hidden
              >
                {step.ready ? <Check size={13} /> : index + 1}
              </span>
              <span className="text-sm font-semibold">{step.label}</span>
              {next === index && <Badge className="ml-auto bg-accent text-on-accent">Next</Badge>}
            </div>
            <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted">{step.detail}</p>
            {step.to.startsWith('/') ? (
              <Link to={step.to} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                {step.cta}
                <ArrowRight size={12} />
              </Link>
            ) : (
              <a href={step.to} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                {step.cta}
                <ArrowRight size={12} />
              </a>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function DemoCard() {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <Sparkles size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold tracking-tight">Built-in demo</h2>
              <Badge className="bg-ok/15 text-ok">
                <CheckCircle2 size={12} /> Ready, no account
              </Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Prepared conversations, a sample company day and a linked knowledge graph. No API key, database or Slack workspace is needed to try
              ElidEx. Teams and email conversations are prepared samples, not live Microsoft connections.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['Company day', 'Knowledge graph', 'Correlations', 'Agent tester'].map((item) => (
                <Badge key={item} className="bg-surface-2 text-muted">{item}</Badge>
              ))}
            </div>
          </div>
        </div>
        <Link
          to="/company"
          className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-text transition hover:bg-surface-2 sm:w-auto"
        >
          Open the company day
          <ArrowRight size={14} />
        </Link>
      </div>
    </Card>
  )
}

function AiCard({ snapshot }: { snapshot: ConnectionsSnapshot }) {
  const apply = useConnections((state) => state.apply)
  const publicDemo = snapshot.public_demo
  const connected = snapshot.ai.connected
  const session = snapshot.ai.source === 'session'
  const server = snapshot.ai.source === 'server'
  const info = providerInfo(snapshot.ai.provider)
  const [provider, setProvider] = useState<AiProviderId>('gemini')
  const [model, setModel] = useState(AI_PROVIDERS[0].defaultModel)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [consent, setConsent] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const sequence = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setApiKey('')
      setConsent(false)
    }
  }, [])

  const selected = providerInfo(provider) ?? AI_PROVIDERS[0]
  const showForm = !connected || replacing
  const lifetime = publicDemo
    ? 'The key is held in server memory for this private demo workspace, tied to this browser cookie. It survives page reloads and ends when the workspace expires, when you disconnect, or when the demo server restarts. It is never stored in browser storage.'
    : 'The key is held in server memory for this shared team workspace. Everyone using the dashboard uses this model. It ends when someone disconnects it or the server restarts, and it is never stored in browser storage.'
  const serverLifetime = publicDemo
    ? 'This deployment has a shared model, but visitor workspaces do not use it. Connect your own key to run live conversations.'
    : 'This model is configured by the deployment and shared by everyone. You can add your own key for this session; the deployment setting itself cannot be changed here. It ends on server restart.'

  const resetSecrets = () => {
    setApiKey('')
    setConsent(false)
    setShowKey(false)
  }

  const chooseProvider = (next: ProviderInfo) => {
    setProvider(next.id)
    setModel(next.defaultModel)
    setError('')
    setNotice('')
  }

  const startReplace = () => {
    const current = providerInfo(snapshot.ai.provider)
    setProvider(current?.id ?? 'gemini')
    setModel(snapshot.ai.model ?? current?.defaultModel ?? AI_PROVIDERS[0].defaultModel)
    resetSecrets()
    setError('')
    setNotice('')
    setReplacing(true)
  }

  const cancelReplace = () => {
    resetSecrets()
    setError('')
    setNotice('')
    setReplacing(false)
  }

  const connect = async () => {
    if (!model.trim() || !apiKey.trim() || !consent) return
    const id = ++sequence.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await connectionsApi.connectAi({ provider, model: model.trim(), api_key: apiKey.trim() })
      if (!mounted.current || id !== sequence.current) return
      apply(next)
      resetSecrets()
      setReplacing(false)
      setNotice(`${selected.name} is connected. The test request succeeded.`)
    } catch (cause) {
      if (mounted.current && id === sequence.current) setError(describeConnectionError(cause, 'The provider rejected the connection. Check the key and model, then try again.'))
    } finally {
      if (mounted.current && id === sequence.current) setBusy(false)
    }
  }

  const disconnect = async () => {
    const id = ++sequence.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await connectionsApi.disconnectAi()
      if (!mounted.current || id !== sequence.current) return
      apply(next)
      resetSecrets()
      setReplacing(false)
      setNotice(next.ai.connected ? 'Disconnected your key. The deployment model is still available.' : 'Disconnected. New conversations use the scripted demo until a model is connected again.')
    } catch (cause) {
      if (mounted.current && id === sequence.current) setError(describeConnectionError(cause, 'Could not disconnect. Try again.'))
    } finally {
      if (mounted.current && id === sequence.current) setBusy(false)
    }
  }

  return (
    <Card className="scroll-mt-4 p-4 ring-1 ring-accent/20 sm:p-5">
      <div id="ai" className="scroll-mt-4" />
      <div className="flex flex-wrap items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <KeyRound size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base font-semibold tracking-tight">Read your conversations with AI</h2>
            <Badge className="bg-accent text-on-accent">Recommended</Badge>
            {connected && (
              <Badge className="bg-ok/15 text-ok">
                <CheckCircle2 size={12} /> Connected
              </Badge>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            Connect one provider so ElidEx can read new conversations, answer with the agent, and use the model during a company day. The demo
            keeps working without one.
          </p>
        </div>
      </div>

      {connected && !replacing && (
        <div className="mt-4 rounded-lg border border-ok/30 bg-ok/5 p-3.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <ProviderMark info={info} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{info?.name ?? snapshot.ai.provider ?? 'AI provider'}</span>
                  <Badge className={session ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted'}>
                    {session ? (publicDemo ? 'This private workspace' : 'This session') : 'Deployment model'}
                  </Badge>
                </div>
                <p className="mt-0.5 break-all font-mono text-xs text-muted">{snapshot.ai.model ?? 'Model not reported'}</p>
                <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted">{server ? serverLifetime : lifetime}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {session && (
                <Button variant="danger" size="sm" icon={<Unplug size={14} />} onClick={disconnect} loading={busy}>
                  Disconnect
                </Button>
              )}
              <Button size="sm" icon={<KeyRound size={14} />} onClick={startReplace} disabled={busy}>
                {session ? 'Replace key' : 'Use my own key'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {connected && liveAiReady(snapshot) && (
        <div className="mt-3 rounded-lg border border-accent/25 bg-accent-soft p-3.5">
          <p className="text-sm font-semibold">The model is connected. Use it now:</p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
            <NextStep to="/conversations?new=1" icon={MessageSquare} title="Create a conversation" text="Start a thread, send messages, and let ElidEx read it." />
            <NextStep to="/agent?use_llm=1" icon={Bot} title="Run the agent with AI" text="Try a case and see the model reason over the knowledge." />
            <NextStep to="/company" icon={Sparkles} title="Play the company day" text="Watch the day run and see the knowledge used." />
          </div>
        </div>
      )}

      {!showForm && error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-bad/30 bg-bad/5 p-3 text-xs leading-relaxed text-bad">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {!showForm && notice && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-md border border-ok/30 bg-ok/5 p-3 text-xs leading-relaxed text-ok">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          {notice}
        </p>
      )}

      {showForm && (
        <div className="mt-4 space-y-4">
          {replacing && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-bg px-3 py-2">
              <p className="text-xs text-muted">Replacing the session model. The current key stays active until the new one passes its test.</p>
              <Button size="sm" variant="ghost" onClick={cancelReplace} disabled={busy}>Cancel</Button>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-muted">Provider</span>
              <span className="text-xs text-muted">One provider, one model</span>
            </div>
            <div role="radiogroup" aria-label="AI provider" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {AI_PROVIDERS.map((item) => (
                <label
                  key={item.id}
                  className={cn(
                    'flex min-h-16 cursor-pointer items-center gap-2 rounded-md border p-2.5 transition focus-within:ring-2 focus-within:ring-accent/30',
                    provider === item.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-surface-2',
                  )}
                  title={item.note}
                >
                  <input
                    type="radio"
                    name="ai-provider"
                    value={item.id}
                    checked={provider === item.id}
                    onChange={() => chooseProvider(item)}
                    className="sr-only"
                    disabled={busy}
                  />
                  <img src={item.icon} alt="" width={22} height={22} className="shrink-0 object-contain" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{item.short}</span>
                    <span className="block truncate text-[10px] text-muted">{item.id === 'featherless' ? 'Open models' : 'API key'}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div className="space-y-1">
              <label htmlFor="ai-model" className="text-xs font-medium text-muted">Model</label>
              <Input
                id="ai-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={selected.defaultModel}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
              />
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                Suggested: <code className="font-mono text-[11px]">{selected.defaultModel}</code>
                {model !== selected.defaultModel && (
                  <button type="button" className="text-accent hover:underline" onClick={() => setModel(selected.defaultModel)}>
                    Use suggested
                  </button>
                )}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="ai-api-key" className="text-xs font-medium text-muted">API key</label>
              <div className="relative">
                <Input
                  id="ai-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={selected.id === 'openai' ? 'sk-…' : 'Paste the key from the provider console'}
                  className="pr-10 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((shown) => !shown)}
                  className="absolute right-1 top-1 grid size-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text"
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  aria-pressed={showKey}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-xs text-muted">Pasted from the provider. Never stored in this browser.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <a href={selected.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              {selected.keyLabel}
              <ExternalLink size={12} />
            </a>
            <a href={selected.privacyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-text hover:underline">
              Provider terms and privacy
              <ExternalLink size={12} />
            </a>
            <span className="text-muted">{selected.note}</span>
          </div>

          <label className="flex items-start gap-2.5 rounded-md border border-line bg-bg p-3 text-xs leading-relaxed text-muted">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              disabled={busy}
            />
            <span>
              I understand that saving sends one small test request to {selected.name}, and that later requests send the conversation text
              ElidEx is asked to read. Provider usage may cost money. {lifetime}
            </span>
          </label>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad/5 p-3 text-xs leading-relaxed text-bad">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="flex items-start gap-2 rounded-md border border-ok/30 bg-ok/5 p-3 text-xs leading-relaxed text-ok">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              {notice}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={<ShieldCheck size={14} />}
              loading={busy}
              disabled={!model.trim() || !apiKey.trim() || !consent}
              onClick={connect}
            >
              {busy ? 'Testing key…' : 'Test and connect'}
            </Button>
            {replacing && <Button onClick={cancelReplace} disabled={busy}>Cancel</Button>}
            <span className="text-xs text-muted">Only a successful test installs the key.</span>
          </div>
        </div>
      )}
    </Card>
  )
}

const SLACK_SCOPES = [
  'channels:history',
  'groups:history',
  'chat:write',
  'chat:write.customize',
  'users:read',
  'channels:read',
  'groups:read',
]

function SlackCard({ snapshot }: { snapshot: ConnectionsSnapshot }) {
  const apply = useConnections((state) => state.apply)
  const publicDemo = snapshot.public_demo
  const connected = snapshot.slack.connected
  const [open, setOpen] = useState(false)
  const [botToken, setBotToken] = useState('')
  const [appToken, setAppToken] = useState('')
  const [channelId, setChannelId] = useState('')
  const [showTokens, setShowTokens] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const sequence = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setBotToken('')
      setAppToken('')
      setConsent(false)
    }
  }, [])

  const lifetime = publicDemo
    ? 'The bridge runs for this private demo workspace (cookie session). It ends when the workspace expires, when you disconnect, or when the demo server restarts. Tokens are never stored in browser storage.'
    : 'The bridge is shared by everyone on this dashboard. It ends when someone disconnects it or the server restarts. Tokens are never stored in browser storage.'

  const resetSecrets = () => {
    setBotToken('')
    setAppToken('')
    setConsent(false)
    setShowTokens(false)
  }

  const connect = async () => {
    if (!botToken.trim() || !appToken.trim() || !channelId.trim() || !consent) return
    const id = ++sequence.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await connectionsApi.connectSlack({
        bot_token: botToken.trim(),
        app_token: appToken.trim(),
        channel_id: channelId.trim().toUpperCase(),
      })
      if (!mounted.current || id !== sequence.current) return
      apply(next)
      resetSecrets()
      setOpen(false)
      setNotice('Slack is connected. The bridge passed its start-up checks.')
    } catch (cause) {
      if (mounted.current && id === sequence.current) setError(describeConnectionError(cause, 'Slack rejected the connection. Check the tokens, scopes and channel ID, then try again.'))
    } finally {
      if (mounted.current && id === sequence.current) setBusy(false)
    }
  }

  const disconnect = async () => {
    const id = ++sequence.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await connectionsApi.disconnectSlack()
      if (!mounted.current || id !== sequence.current) return
      apply(next)
      setNotice(next.slack.connected ? 'Disconnected your Slack bridge. The deployment bridge is still connected.' : 'Slack disconnected. Dashboard messages are no longer mirrored.')
    } catch (cause) {
      if (mounted.current && id === sequence.current) setError(describeConnectionError(cause, 'Could not disconnect Slack. Try again.'))
    } finally {
      if (mounted.current && id === sequence.current) setBusy(false)
    }
  }

  return (
    <Card className="scroll-mt-4 p-4 sm:p-5">
      <div id="slack" className="scroll-mt-4" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-white">
            <img src="/technologies/slack.svg" alt="" width={24} height={24} className="object-contain" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold tracking-tight">Slack channel</h2>
              <Badge className="bg-surface-2 text-muted">Optional</Badge>
              {connected && (
                <Badge className="bg-ok/15 text-ok">
                  <CheckCircle2 size={12} /> Connected
                </Badge>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Read a real Slack channel into ElidEx and mirror dashboard messages back. Slack is the only live channel connector here. Uses
              Socket Mode, so no public URL or OAuth redirect is needed.
            </p>
          </div>
        </div>
        {!connected && !open && (
          <Button className="w-full sm:w-auto" icon={<Link2 size={14} />} onClick={() => { setOpen(true); setError(''); setNotice('') }}>
            Set up Slack
          </Button>
        )}
      </div>

      {connected && (
        <div className="mt-4 rounded-lg border border-ok/30 bg-ok/5 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  <Hash size={14} className="text-muted" />
                  {snapshot.slack.channel ?? 'Slack channel'}
                </span>
                <Badge className="bg-surface-2 text-muted">Socket Mode</Badge>
              </div>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted">{lifetime}</p>
              {snapshot.slack.error && (
                <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-bad">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  {snapshot.slack.error}
                </p>
              )}
              {error && (
                <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-bad">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="mt-2 flex items-start gap-1.5 text-xs text-ok">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                  {notice}
                </p>
              )}
            </div>
            <Button variant="danger" size="sm" icon={<Unplug size={14} />} onClick={disconnect} loading={busy} className="w-full sm:w-auto">
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {!connected && open && (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-line bg-bg p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">What the Slack app needs</p>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
              <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok" /><span>Create an app at <a className="text-accent hover:underline" href="https://api.slack.com/apps" target="_blank" rel="noreferrer">api.slack.com/apps</a> and enable <strong>Socket Mode</strong>.</span></li>
              <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok" /><span>App-level token with <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">connections:write</code> (starts <code className="font-mono text-[11px]">xapp-</code>).</span></li>
              <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok" /><span>Bot token scopes: {SLACK_SCOPES.map((scope) => <code key={scope} className="mr-1 rounded bg-surface-2 px-1 font-mono text-[11px]">{scope}</code>)}</span></li>
              <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok" /><span>Event subscriptions: <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">message.channels</code> and <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">message.groups</code>.</span></li>
              <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok" /><span>Invite the bot to the channel with <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">/invite @YourApp</code>. A workspace admin may need to approve the app.</span></li>
              <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-ok" /><span>Copy the channel ID (<code className="font-mono text-[11px]">C…</code>) from the channel details, not the channel name.</span></li>
            </ul>
            <p className="mt-2 text-xs text-muted">No OAuth redirect is used. You paste the two tokens Slack shows you.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="slack-bot-token" className="text-xs font-medium text-muted">Bot token</label>
              <Input
                id="slack-bot-token"
                type={showTokens ? 'text' : 'password'}
                value={botToken}
                onChange={(event) => setBotToken(event.target.value)}
                placeholder="xoxb-…"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="slack-app-token" className="text-xs font-medium text-muted">App-level token</label>
              <div className="relative">
                <Input
                  id="slack-app-token"
                  type={showTokens ? 'text' : 'password'}
                  value={appToken}
                  onChange={(event) => setAppToken(event.target.value)}
                  placeholder="xapp-…"
                  className="pr-10 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setShowTokens((shown) => !shown)}
                  className="absolute right-1 top-1 grid size-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text"
                  aria-label={showTokens ? 'Hide Slack tokens' : 'Show Slack tokens'}
                  aria-pressed={showTokens}
                >
                  {showTokens ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <Field label="Channel ID" hint="For example C0123456789. The bot must be in this channel." className="sm:col-span-2">
              <Input
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
                placeholder="C0123456789"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                aria-label="Slack channel ID"
              />
            </Field>
          </div>

          <label className="flex items-start gap-2.5 rounded-md border border-line bg-bg p-3 text-xs leading-relaxed text-muted">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              disabled={busy}
            />
            <span>
              I understand the bot will read messages in this channel and post as the app. Only connect a channel you are allowed to use. {lifetime}
            </span>
          </label>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad/5 p-3 text-xs leading-relaxed text-bad">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="flex items-start gap-2 rounded-md border border-ok/30 bg-ok/5 p-3 text-xs leading-relaxed text-ok">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              {notice}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={<ShieldCheck size={14} />}
              loading={busy}
              disabled={!botToken.trim() || !appToken.trim() || !channelId.trim() || !consent}
              onClick={connect}
            >
              {busy ? 'Testing Slack…' : 'Test and connect'}
            </Button>
            <Button
              onClick={() => {
                resetSecrets()
                setChannelId('')
                setError('')
                setNotice('')
                setOpen(false)
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <span className="text-xs text-muted">Only a successful start installs the bridge.</span>
          </div>
        </div>
      )}

      {!connected && !open && notice && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-md border border-ok/30 bg-ok/5 p-3 text-xs leading-relaxed text-ok">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          {notice}
        </p>
      )}
      {!connected && !open && error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-bad/30 bg-bad/5 p-3 text-xs leading-relaxed text-bad">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </Card>
  )
}

function InfraRow({ icon: Icon, image, name, configured, env, text }: { icon?: LucideIcon; image?: string; name: string; configured: boolean; env: string; text: string }) {
  return (
    <div className="rounded-md border border-line bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        {image ? <img src={image} alt="" width={16} height={16} className="object-contain" /> : Icon ? <Icon size={16} className="text-muted" /> : null}
        <span className="text-sm font-semibold">{name}</span>
        <Badge className={configured ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted'}>{configured ? 'Configured' : 'Not configured'}</Badge>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{text}</p>
      <p className="mt-1.5 font-mono text-[11px] text-muted">{env}</p>
    </div>
  )
}

function InfrastructureCard({ snapshot }: { snapshot: ConnectionsSnapshot }) {
  return (
    <Card className="scroll-mt-4 overflow-hidden">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 hover:bg-surface-2/60 sm:p-5 [&::-webkit-details-marker]:hidden">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
            <Server size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-sm font-semibold tracking-tight">Optional infrastructure</h2>
            <p className="text-xs text-muted">For deployment owners. ElidEx runs with local files by default.</p>
          </div>
          <div className="hidden flex-wrap gap-1.5 sm:flex">
            <Badge className={snapshot.infrastructure.mongodb_configured ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted'}>MongoDB</Badge>
            <Badge className={snapshot.infrastructure.tiger_configured ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted'}>Tiger</Badge>
          </div>
          <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-line p-4 sm:p-5">
          <p className="text-xs leading-relaxed text-muted">
            No database account is needed to try ElidEx. Set these variables in the server environment, then restart. This page never accepts a
            database URI. <strong className="font-medium text-text">Configured means the setting exists; it does not mean the database is reachable or healthy.</strong>{' '}
            The built-in knowledge graph needs no Neo4j. An external mirror is an optional deployment-owner CLI (<code className="font-mono text-[11px]">ctx graph push</code>, see
            docs/knowledge-graph.md), not a user-facing live connector.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfraRow
              image="/technologies/mongodb.svg"
              name="MongoDB Atlas"
              configured={snapshot.infrastructure.mongodb_configured}
              env="MONGODB_URI + MONGODB_DB"
              text="Cold archive and Atlas-backed source search. Local default: JSONL files under out/dashboard/archive. See docs/dataset.md for the one-time cluster setup."
            />
            <InfraRow
              icon={Waves}
              name="Tiger Data"
              configured={snapshot.infrastructure.tiger_configured}
              env="TIGER_DATABASE_URL"
              text="Time-series metrics for the company day. Local default: the same files under out/dashboard. See docs/dataset.md for the service setup."
            />
          </div>
        </div>
      </details>
    </Card>
  )
}

export default function ConnectionsPage() {
  const snapshot = useConnections((state) => state.snapshot)
  const loading = useConnections((state) => state.loading)
  const error = useConnections((state) => state.error)
  const refresh = useConnections((state) => state.refresh)

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  if (!snapshot) {
    return (
      <div className="h-full overflow-auto">
        <PageIntro
          title="Connections"
          description="Connect your own tools using your accounts, API keys, tokens and channel IDs. The built-in demo works without external connections."
        />
        <div className="mx-auto max-w-5xl px-5 pb-8">
          {loading ? (
            <Card className="p-5"><LoadingState label="Reading connection status…" /></Card>
          ) : (
            <Card className="p-5">
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-bad">
                <span className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error ?? 'Could not read the connection status.'}</span>
                <Button size="sm" onClick={() => void refresh(true)}>Try again</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <PageIntro
        title="Connections"
        description="Connect your own tools using your accounts, API keys, tokens and channel IDs. The built-in demo works without external connections."
      />
      <div className="mx-auto max-w-5xl space-y-4 px-5 pb-8">
        {error && (
          <p role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
            <AlertCircle size={14} className="shrink-0" />
            Could not refresh the connection status: {error}
            <button type="button" className="font-medium underline" onClick={() => void refresh(true)}>Retry</button>
          </p>
        )}
        <Readiness snapshot={snapshot} />
        <DemoCard />
        <AiCard snapshot={snapshot} />
        <SlackCard snapshot={snapshot} />
        <InfrastructureCard snapshot={snapshot} />
        <p className="flex items-start gap-2 px-1 pb-2 text-xs leading-relaxed text-muted">
          <LockKeyhole size={14} className="mt-0.5 shrink-0" />
          Credentials are never written to browser storage, logs or URLs. A connection test may cost a small amount on the provider account.
        </p>
      </div>
    </div>
  )
}
