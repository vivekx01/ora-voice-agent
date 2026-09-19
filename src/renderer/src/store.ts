import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  type ChatMessage,
  type Conversation,
  type ConversationSummary,
  type DeepPartial,
  type DownloadProgress,
  type ModelsStatus,
  type ProviderId,
  type ProviderKeys,
  type Settings,
  type ToolInfo,
  isProviderConfigured,
  providerInfo
} from '@shared/types'

export type VoiceState = 'booting' | 'idle' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking'

export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  stage: string
  progress: number
  backend?: string
  loadMs?: number
  error?: string
}

export interface PendingApproval {
  approvalId: string
  runId: string
  name: string
  args: unknown
  summary: string
}

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}

export type SettingsTab = 'model' | 'voice' | 'listening' | 'tools' | 'agent' | 'appearance' | 'advanced'

function merge<T>(base: T, patch: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base) || typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return (patch === undefined ? base : patch) as T
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = merge((base as Record<string, unknown>)[k], v)
  return out as T
}

const idle: EngineStatus = { state: 'idle', stage: '', progress: 0 }
let toastId = 1
let persistTimer: ReturnType<typeof setTimeout> | null = null

interface State {
  loaded: boolean
  settings: Settings
  keys: ProviderKeys
  tools: ToolInfo[]
  version: string
  models: ModelsStatus | null
  download: DownloadProgress | null
  tts: EngineStatus
  stt: EngineStatus
  conversations: ConversationSummary[]
  active: Conversation
  voice: VoiceState
  micOn: boolean
  caption: string
  approvals: PendingApproval[]
  toasts: Toast[]
  settingsOpen: boolean
  settingsTab: SettingsTab
  sidebarOpen: boolean

  init: () => Promise<void>
  updateSettings: (patch: DeepPartial<Settings>) => Promise<void>
  setApiKey: (provider: ProviderId, key: string) => Promise<void>
  selectProvider: (id: ProviderId) => Promise<void>
  refreshModels: () => Promise<void>
  refreshConversations: () => Promise<void>
  newChat: () => Promise<void>
  openConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  addMessage: (m: ChatMessage) => void
  mutateMessage: (id: string, fn: (m: ChatMessage) => ChatMessage) => void
  persist: (immediate?: boolean) => void
  set: (patch: Partial<State>) => void
  toast: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: number) => void
  openSettings: (tab?: SettingsTab) => void
}

const emptyConversation = (): Conversation => ({ id: crypto.randomUUID(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] })

export const useStore = create<State>((set, get) => ({
  loaded: false,
  settings: DEFAULT_SETTINGS,
  keys: { openrouter: false, openai: false, anthropic: false, google: false, custom: false },
  tools: [],
  version: '',
  models: null,
  download: null,
  tts: idle,
  stt: idle,
  conversations: [],
  active: emptyConversation(),
  voice: 'booting',
  micOn: false,
  caption: '',
  approvals: [],
  toasts: [],
  settingsOpen: false,
  settingsTab: 'model',
  sidebarOpen: true,

  async init() {
    const [{ settings, keys }, tools, models, conversations, version] = await Promise.all([
      window.ora.settings.get(),
      window.ora.tools.list(),
      window.ora.models.status(),
      window.ora.conversations.list(),
      window.ora.system.version()
    ])
    set({ settings, keys, tools, models, conversations, version, loaded: true })
  },

  async updateSettings(patch) {
    set({ settings: merge(get().settings, patch) })
    const saved = await window.ora.settings.update(patch)
    set({ settings: saved })
  },

  async setApiKey(provider, key) {
    set({ keys: await window.ora.settings.setApiKey(provider, key) })
  },

  // Switching provider remembers the model you were using and restores the one you last used there.
  async selectProvider(id) {
    const { llm } = get().settings
    if (llm.provider === id) return
    const remembered = { ...llm.modelByProvider, [llm.provider]: llm.model }
    await get().updateSettings({ llm: { provider: id, model: remembered[id] ?? providerInfo(id).defaultModel, modelByProvider: remembered } })
  },

  async refreshModels() {
    set({ models: await window.ora.models.status() })
  },

  async refreshConversations() {
    set({ conversations: await window.ora.conversations.list() })
  },

  async newChat() {
    get().persist(true)
    set({ active: await window.ora.conversations.create() })
  },

  async openConversation(id) {
    get().persist(true)
    const conv = await window.ora.conversations.get(id)
    if (conv) set({ active: conv })
  },

  async deleteConversation(id) {
    await window.ora.conversations.remove(id)
    if (get().active.id === id) set({ active: await window.ora.conversations.create() })
    await get().refreshConversations()
  },

  addMessage(m) {
    set((s) => ({ active: { ...s.active, messages: [...s.active.messages, m] } }))
  },

  mutateMessage(id, fn) {
    set((s) => ({ active: { ...s.active, messages: s.active.messages.map((m) => (m.id === id ? fn(m) : m)) } }))
  },

  persist(immediate = false) {
    const run = async (): Promise<void> => {
      persistTimer = null
      const conv = get().active
      if (conv.messages.length === 0) return
      let title = conv.title
      if (title === 'New chat') {
        const first = conv.messages.find((m) => m.role === 'user')?.text.trim() ?? ''
        if (first) title = first.length > 48 ? `${first.slice(0, 46)}…` : first
      }
      const next = { ...conv, title }
      if (title !== conv.title) set({ active: next })
      await window.ora.conversations.save(next)
      await get().refreshConversations()
    }
    if (persistTimer) clearTimeout(persistTimer)
    if (immediate) void run()
    else persistTimer = setTimeout(() => void run(), 500)
  },

  set: (patch) => set(patch),

  toast(kind, text) {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-4) }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3800)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openSettings: (tab) => set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab }))
}))

/** Whether the selected provider has a key (or, for a custom server, an address). */
export const useProviderReady = (): boolean => useStore((s) => isProviderConfigured(s.settings.llm, s.keys))
