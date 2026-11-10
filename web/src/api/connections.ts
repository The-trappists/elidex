// Typed client for /api/connections. The backend validates every credential with a
// real provider request before it installs it; responses are always the same snapshot.
import { req } from './client'

export type AiProviderId = 'gemini' | 'mistral' | 'groq' | 'openai' | 'featherless'
export type AiSource = 'session' | 'server' | 'none'

export interface AiConnection {
  connected: boolean
  provider: AiProviderId | string | null
  model: string | null
  source: AiSource
}

export interface SlackConnection {
  connected: boolean
  channel: string | null
  error: string | null
}

export interface InfrastructureStatus {
  mongodb_configured: boolean
  tiger_configured: boolean
}

export interface ConnectionsSnapshot {
  ai: AiConnection
  slack: SlackConnection
  infrastructure: InfrastructureStatus
  public_demo: boolean
}

export interface AiConnectBody {
  provider: AiProviderId
  model: string
  api_key: string
}

export interface SlackConnectBody {
  bot_token: string
  app_token: string
  channel_id: string
}

export interface ProviderInfo {
  id: AiProviderId
  name: string
  short: string
  icon: string
  defaultModel: string
  keyUrl: string
  keyLabel: string
  privacyUrl: string
  note: string
}

/** Fixed catalogue. Icons are local assets; nothing is loaded from a third party at runtime. */
export const AI_PROVIDERS: ProviderInfo[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    short: 'Gemini',
    icon: '/providers/gemini.svg',
    defaultModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyLabel: 'Get a Gemini API key',
    privacyUrl: 'https://ai.google.dev/gemini-api/terms',
    note: 'Good first choice for trying live extraction.',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    short: 'Mistral',
    icon: '/providers/mistral.svg',
    defaultModel: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyLabel: 'Get a Mistral API key',
    privacyUrl: 'https://mistral.ai/terms',
    note: 'European provider with small, inexpensive models.',
  },
  {
    id: 'groq',
    name: 'Groq',
    short: 'Groq',
    icon: '/providers/groq.svg',
    defaultModel: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
    keyLabel: 'Get a Groq API key',
    privacyUrl: 'https://groq.com/privacy-policy/',
    note: 'Very fast inference for open models.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    short: 'OpenAI',
    icon: '/providers/openai.svg',
    defaultModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyLabel: 'Get an OpenAI API key',
    privacyUrl: 'https://openai.com/policies/privacy-policy/',
    note: 'Widely available models with predictable JSON output.',
  },
  {
    id: 'featherless',
    name: 'Featherless AI',
    short: 'Featherless',
    icon: '/providers/featherless.svg',
    defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    keyUrl: 'https://featherless.ai/account/api-keys',
    keyLabel: 'Get a Featherless API key',
    privacyUrl: 'https://featherless.ai/privacy',
    note: 'Open-weight models through an OpenAI-compatible API.',
  },
]

export const providerInfo = (id: string | null | undefined): ProviderInfo | undefined =>
  AI_PROVIDERS.find((provider) => provider.id === id)

/** Network failures are not HTTP errors: give the visitor a next step instead of "Failed to fetch". */
export function describeConnectionError(cause: unknown, fallback: string): string {
  if (cause instanceof TypeError && /fetch|network/i.test(cause.message)) return 'Cannot reach ElidEx. Check your connection and try again.'
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export const connectionsApi = {
  get: () => req<ConnectionsSnapshot>('GET', '/connections'),
  connectAi: (body: AiConnectBody) => req<ConnectionsSnapshot>('POST', '/connections/ai', body),
  disconnectAi: () => req<ConnectionsSnapshot>('DELETE', '/connections/ai'),
  connectSlack: (body: SlackConnectBody) => req<ConnectionsSnapshot>('POST', '/connections/slack', body),
  disconnectSlack: () => req<ConnectionsSnapshot>('DELETE', '/connections/slack'),
}
