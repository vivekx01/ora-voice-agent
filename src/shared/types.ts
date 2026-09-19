// Types and defaults shared between the main process, preload and renderer.

export const APP_NAME = 'Ora'

export type ThemeMode = 'system' | 'light' | 'dark'
export type AccentName = 'violet' | 'blue' | 'teal' | 'rose' | 'amber'
export type ListenMode = 'vad' | 'ptt'
export type ApprovalMode = 'sensitive' | 'always' | 'never'
export type ProviderSort = 'default' | 'latency' | 'throughput' | 'price'
export type ProviderId = 'openrouter' | 'openai' | 'anthropic' | 'google' | 'custom'
export type ReasoningEffort = 'default' | 'off' | 'low' | 'medium' | 'high'

export interface Settings {
  llm: {
    provider: ProviderId
    model: string
    /** Last model used with each provider, restored when you switch back. */
    modelByProvider: Partial<Record<ProviderId, string>>
    /** Address of an OpenAI-compatible server (Ollama, LM Studio, vLLM...) for the "custom" provider. */
    customBaseUrl: string
    temperature: number
    maxTokens: number
    providerSort: ProviderSort
    reasoning: ReasoningEffort
  }
  agent: {
    name: string
    userName: string
    systemPrompt: string
    historyTurns: number
    maxToolSteps: number
    useMemory: boolean
  }
  tts: {
    enabled: boolean
    voice: string
    language: string
    speed: number
    steps: number
    volume: number
    firstChunkChars: number
    maxChunkChars: number
  }
  stt: {
    model: string
    language: string
    mode: ListenMode
    vadSensitivity: 'low' | 'medium' | 'high'
    silenceMs: number
    bargeIn: boolean
    micDeviceId: string
    outputDeviceId: string
    autoListen: boolean
  }
  tools: {
    enabled: Record<string, boolean>
    approval: ApprovalMode
    sandboxDir: string
  }
  ui: {
    theme: ThemeMode
    accent: AccentName
    showLatency: boolean
    showToolDetails: boolean
    liveCaptions: boolean
  }
  general: {
    globalHotkey: string
    alwaysOnTop: boolean
  }
}

export const DEFAULT_SYSTEM_PROMPT = `You are {{name}}, a friendly voice assistant on the user's desktop.
Your replies are converted to speech and spoken aloud, so:
- Keep answers short and conversational: one to three sentences unless the user asks for more.
- Never use markdown, bullet points, tables, emojis, code blocks, or read out URLs. Say things the way a person would say them out loud.
- Write numbers, dates, times and units the way you would speak them.
- Use your tools directly when they help; the app asks the user for confirmation when an action is sensitive. Only mention what you're doing if it will take a while.
- If a request is ambiguous, ask one short clarifying question.
- If you don't know something or a tool fails, say so plainly instead of guessing.
The user's name is {{user}}. Current date and time: {{datetime}}. Locale: {{locale}}.`

export const DEFAULT_SETTINGS: Settings = {
  llm: {
    provider: 'openrouter',
    model: 'anthropic/claude-haiku-4.5',
    modelByProvider: {},
    customBaseUrl: 'http://localhost:11434/v1',
    temperature: 0.6,
    maxTokens: 700,
    providerSort: 'latency',
    reasoning: 'default'
  },
  agent: {
    name: 'Ora',
    userName: '',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    historyTurns: 12,
    maxToolSteps: 6,
    useMemory: true
  },
  tts: {
    enabled: true,
    voice: 'F1',
    language: 'en',
    speed: 1,
    steps: 8,
    volume: 1,
    firstChunkChars: 90,
    maxChunkChars: 220
  },
  stt: {
    model: 'onnx-community/whisper-base.en',
    language: 'en',
    mode: 'vad',
    vadSensitivity: 'medium',
    silenceMs: 800,
    bargeIn: true,
    micDeviceId: 'default',
    outputDeviceId: 'default',
    autoListen: false
  },
  tools: {
    enabled: {},
    approval: 'sensitive',
    sandboxDir: ''
  },
  ui: {
    theme: 'system',
    accent: 'violet',
    showLatency: true,
    showToolDetails: false,
    liveCaptions: true
  },
  general: {
    globalHotkey: 'CommandOrControl+Shift+Space',
    alwaysOnTop: false
  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export const SUPERTONIC_VOICES = [
  { id: 'F1', label: 'Aria', kind: 'Female' },
  { id: 'F2', label: 'Nora', kind: 'Female' },
  { id: 'F3', label: 'Maya', kind: 'Female' },
  { id: 'F4', label: 'Elise', kind: 'Female' },
  { id: 'F5', label: 'Ivy', kind: 'Female' },
  { id: 'M1', label: 'Leo', kind: 'Male' },
  { id: 'M2', label: 'Owen', kind: 'Male' },
  { id: 'M3', label: 'Finn', kind: 'Male' },
  { id: 'M4', label: 'Jude', kind: 'Male' },
  { id: 'M5', label: 'Theo', kind: 'Male' }
] as const

export const SUPERTONIC_LANGUAGES: Array<{ id: string; label: string }> = [
  ['en', 'English'], ['ko', 'Korean'], ['ja', 'Japanese'], ['ar', 'Arabic'], ['bg', 'Bulgarian'], ['cs', 'Czech'],
  ['da', 'Danish'], ['de', 'German'], ['el', 'Greek'], ['es', 'Spanish'], ['et', 'Estonian'], ['fi', 'Finnish'],
  ['fr', 'French'], ['hi', 'Hindi'], ['hr', 'Croatian'], ['hu', 'Hungarian'], ['id', 'Indonesian'], ['it', 'Italian'],
  ['lt', 'Lithuanian'], ['lv', 'Latvian'], ['nl', 'Dutch'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['ro', 'Romanian'],
  ['ru', 'Russian'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['sv', 'Swedish'], ['tr', 'Turkish'], ['uk', 'Ukrainian'],
  ['vi', 'Vietnamese'], ['na', 'Auto / other']
].map(([id, label]) => ({ id, label }))

export interface SttModelOption {
  id: string
  label: string
  note: string
  multilingual: boolean
}

export const STT_MODELS: SttModelOption[] = [
  { id: 'onnx-community/whisper-tiny.en', label: 'Whisper Tiny (English)', note: '~40 MB. Fastest (about 1s per phrase on an Intel iGPU), occasionally mishears.', multilingual: false },
  { id: 'onnx-community/whisper-base.en', label: 'Whisper Base (English)', note: '~75 MB. Best balance: about 2s per phrase, accurate. Default.', multilingual: false },
  { id: 'onnx-community/whisper-small.en', label: 'Whisper Small (English)', note: '~250 MB. Most accurate English model, but about 6s per phrase on an integrated GPU.', multilingual: false },
  { id: 'onnx-community/whisper-base', label: 'Whisper Base (Multilingual)', note: '~75 MB. 99 languages.', multilingual: true },
  { id: 'onnx-community/whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo', note: '~800 MB. Best quality, needs a strong GPU.', multilingual: true }
]

export interface ProviderInfo {
  id: ProviderId
  label: string
  tagline: string
  keyUrl: string
  keyPlaceholder: string
  needsKey: boolean
  defaultModel: string
  recommended: Array<{ id: string; blurb: string }>
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    tagline: 'Hundreds of models',
    keyUrl: 'openrouter.ai/keys',
    keyPlaceholder: 'sk-or-v1-…',
    needsKey: true,
    defaultModel: 'anthropic/claude-haiku-4.5',
    recommended: [
      { id: 'anthropic/claude-haiku-4.5', blurb: 'Fast, dependable tool use, natural spoken tone. Default.' },
      { id: 'google/gemini-2.5-flash', blurb: 'Very fast and cheap, strong tool use.' },
      { id: 'openai/gpt-5.4-mini', blurb: 'Balanced speed and reasoning.' },
      { id: 'anthropic/claude-sonnet-5', blurb: 'Smartest here, slower to first word.' },
      { id: 'qwen/qwen3.7-flash', blurb: 'Extremely cheap. Good for simple tasks.' },
      { id: 'qwen/qwen3.8-27b:free', blurb: 'Free tier (rate limited).' }
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI',
    tagline: 'GPT, direct',
    keyUrl: 'platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    needsKey: true,
    defaultModel: 'gpt-4.1-mini',
    recommended: [
      { id: 'gpt-4.1-mini', blurb: 'Fast with no thinking pause. Best fit for voice. Default.' },
      { id: 'gpt-4o-mini', blurb: 'Cheap and quick.' },
      { id: 'gpt-5.4-mini', blurb: 'Smarter. Set Reasoning to Minimal or Low so it answers quickly.' },
      { id: 'gpt-5.4-nano', blurb: 'Smallest and cheapest GPT-5 class model.' }
    ]
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    tagline: 'Claude, direct',
    keyUrl: 'console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    needsKey: true,
    defaultModel: 'claude-haiku-4-5-20251001',
    recommended: [
      { id: 'claude-haiku-4-5-20251001', blurb: 'Fastest Claude with reliable tool use. Default.' },
      { id: 'claude-sonnet-5', blurb: 'Smarter, a bit slower to the first word.' },
      { id: 'claude-opus-5', blurb: 'Most capable. Noticeably slower for voice.' }
    ]
  },
  {
    id: 'google',
    label: 'Google',
    tagline: 'Gemini, direct',
    keyUrl: 'aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    needsKey: true,
    defaultModel: 'gemini-2.5-flash',
    recommended: [
      { id: 'gemini-2.5-flash', blurb: 'Very fast and cheap, strong tool use. Default.' },
      { id: 'gemini-2.5-flash-lite', blurb: 'Fastest and cheapest Gemini.' },
      { id: 'gemini-3-flash-preview', blurb: 'Newer Flash model (preview).' }
    ]
  },
  {
    id: 'custom',
    label: 'Custom',
    tagline: 'Local or self-hosted',
    keyUrl: '',
    keyPlaceholder: 'Only if your server needs one',
    needsKey: false,
    defaultModel: 'llama3.1',
    recommended: []
  }
]

export const providerInfo = (id: ProviderId): ProviderInfo => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]

export type ProviderKeys = Record<ProviderId, boolean>

/** True when the selected provider has what it needs (a key, or an address for a custom server). */
export function isProviderConfigured(llm: Settings['llm'], keys: ProviderKeys): boolean {
  if (llm.provider === 'custom') return llm.customBaseUrl.trim().length > 0
  return Boolean(keys[llm.provider])
}

export interface ModelInfo {
  id: string
  name: string
  contextLength?: number
  promptPerM?: number
  completionPerM?: number
  free?: boolean
}

// Conversations

export interface ToolCallRecord {
  callId: string
  name: string
  args: unknown
  result?: string
  ok?: boolean
  ms?: number
  status: 'running' | 'awaiting_approval' | 'done' | 'error' | 'denied'
}

export interface TurnMetrics {
  sttMs?: number
  firstTokenMs?: number
  firstAudioMs?: number
  totalMs?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  toolCalls?: ToolCallRecord[]
  interrupted?: boolean
  error?: string
  source?: 'voice' | 'text'
  metrics?: TurnMetrics
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  preview: string
}

// Agent events (main -> renderer)

export type AgentEvent =
  | { runId: string; type: 'token'; text: string }
  | { runId: string; type: 'tool_start'; callId: string; name: string; args: unknown }
  | { runId: string; type: 'tool_approval'; approvalId: string; name: string; args: unknown; summary: string }
  | { runId: string; type: 'tool_end'; callId: string; name: string; result: string; ok: boolean; ms: number }
  | { runId: string; type: 'done'; text: string; firstTokenMs?: number; totalMs: number }
  | { runId: string; type: 'error'; message: string }
  | { runId: string; type: 'cancelled' }

export interface ToolInfo {
  id: string
  label: string
  description: string
  category: 'Information' | 'System' | 'Files' | 'Productivity'
  sensitive: boolean
  defaultEnabled: boolean
}

export interface ModelsStatus {
  ready: boolean
  dir: string
  missing: string[]
}

export interface DownloadProgress {
  file: string
  received: number
  total: number
  overallReceived: number
  overallTotal: number
  done: boolean
  error?: string
}

export interface MemoryItem {
  id: string
  text: string
  createdAt: number
}

export interface KeyCheck {
  ok: boolean
  message: string
  label?: string
  usage?: number
  limit?: number | null
}

export const SUPERTONIC_FILES = [
  'onnx/duration_predictor.onnx',
  'onnx/text_encoder.onnx',
  'onnx/vector_estimator.onnx',
  'onnx/vocoder.onnx',
  'onnx/tts.json',
  'onnx/unicode_indexer.json',
  ...['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map((v) => `voice_styles/${v}.json`)
]

export const SUPERTONIC_REPO = 'Supertone/supertonic-3'
