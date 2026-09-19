import type {
  AgentEvent,
  ChatMessage,
  Conversation,
  ConversationSummary,
  DeepPartial,
  DownloadProgress,
  KeyCheck,
  MemoryItem,
  ModelsStatus,
  ModelInfo,
  ProviderId,
  ProviderKeys,
  Settings,
  ToolInfo
} from './types'

export type Unsubscribe = () => void

export interface OraApi {
  platform: string
  settings: {
    get(): Promise<{ settings: Settings; keys: ProviderKeys }>
    update(patch: DeepPartial<Settings>): Promise<Settings>
    reset(): Promise<Settings>
    setApiKey(provider: ProviderId, key: string): Promise<ProviderKeys>
    checkKey(provider: ProviderId, key?: string, baseUrl?: string): Promise<KeyCheck>
  }
  models: {
    status(): Promise<ModelsStatus>
    download(): Promise<{ ok: boolean; error?: string }>
    onProgress(cb: (p: DownloadProgress) => void): Unsubscribe
  }
  providers: {
    models(provider: ProviderId, opts?: { baseUrl?: string; force?: boolean }): Promise<ModelInfo[]>
  }
  conversations: {
    list(): Promise<ConversationSummary[]>
    get(id: string): Promise<Conversation | null>
    create(): Promise<Conversation>
    save(conv: Conversation): Promise<void>
    remove(id: string): Promise<void>
  }
  agent: {
    run(req: { history: ChatMessage[]; text: string }): Promise<string>
    cancel(runId: string): Promise<void>
    approve(approvalId: string, approved: boolean): Promise<void>
    onEvent(cb: (e: AgentEvent) => void): Unsubscribe
  }
  tools: {
    list(): Promise<ToolInfo[]>
  }
  memory: {
    list(): Promise<MemoryItem[]>
    remove(id: string): Promise<void>
    clear(): Promise<void>
  }
  system: {
    onHotkey(cb: () => void): Unsubscribe
    onTimer(cb: (t: { label: string }) => void): Unsubscribe
    openExternal(url: string): Promise<void>
    pickFolder(): Promise<string | null>
    setWindowTheme(dark: boolean): Promise<void>
    version(): Promise<string>
    resetGpuCache(): Promise<void>
  }
}
