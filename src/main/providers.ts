import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KeyCheck, ModelInfo, ProviderId } from '@shared/types'
import { paths } from './paths'

// Live model lists and key checks for each provider. Requests go from the main process, never the page.

const TTL_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000

const DEFAULT_BASE: Record<Exclude<ProviderId, 'custom'>, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com'
}

// ORA_LLM_BASE_URL points every provider at a local mock server; used by the automated tests only.
export function baseUrlFor(provider: ProviderId, customBaseUrl: string): string {
  const override = process.env.ORA_LLM_BASE_URL
  if (provider === 'custom') return (override ? `${override}/v1` : customBaseUrl).replace(/\/+$/, '')
  if (override) return provider === 'openrouter' || provider === 'openai' ? `${override}/v1` : override
  return DEFAULT_BASE[provider]
}

const withTimeout = (): AbortSignal => AbortSignal.timeout(TIMEOUT_MS)

async function getJson<T>(url: string, headers: Record<string, string>): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url, { headers, signal: withTimeout() })
  let body: T | null = null
  try {
    body = (await res.json()) as T
  } catch {
    /* not JSON */
  }
  return { status: res.status, body }
}

function authHeaders(provider: ProviderId, key: string): Record<string, string> {
  switch (provider) {
    case 'anthropic': return { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    case 'google': return { 'x-goog-api-key': key }
    default: return key ? { Authorization: `Bearer ${key}` } : {}
  }
}

// ---------- model lists ----------

interface OpenRouterRaw {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
  architecture?: { output_modalities?: string[] }
}

function fromOpenRouter(m: OpenRouterRaw): ModelInfo {
  const prompt = Number(m.pricing?.prompt ?? 0) * 1e6
  const completion = Number(m.pricing?.completion ?? 0) * 1e6
  return {
    id: m.id,
    name: m.name ?? m.id,
    contextLength: m.context_length,
    promptPerM: Number.isFinite(prompt) ? prompt : 0,
    completionPerM: Number.isFinite(completion) ? completion : 0,
    free: prompt === 0 && completion === 0
  }
}

// Only models that can call tools and answer in text are useful for the agent.
function usableOnOpenRouter(m: OpenRouterRaw): boolean {
  const out = m.architecture?.output_modalities ?? ['text']
  return (m.supported_parameters ?? []).includes('tools') && out.includes('text') && !out.includes('image') && !m.id.endsWith(':batch')
}

const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/
const OPENAI_NOT_CHAT = /(instruct|embedding|tts|whisper|audio|realtime|transcribe|image|search|moderation|dall-e|davinci|babbage|codex|computer-use|deep-research)/

const GOOGLE_NOT_CHAT = /(embedding|tts|image|live|audio|aqa|imagen|veo|robotics|computer-use|vision)/

const cache = new Map<string, { at: number; models: ModelInfo[] }>()
const openRouterDisk = (): string => join(paths.cache, 'openrouter-models.json')

async function fetchModels(provider: ProviderId, key: string, customBaseUrl: string): Promise<ModelInfo[]> {
  const base = baseUrlFor(provider, customBaseUrl)
  const headers = authHeaders(provider, key)

  if (provider === 'openrouter') {
    const { status, body } = await getJson<{ data: OpenRouterRaw[] }>(`${base}/models`, {})
    if (status !== 200 || !body) throw new Error(`OpenRouter returned HTTP ${status}`)
    return body.data.filter(usableOnOpenRouter).map(fromOpenRouter).sort((a, b) => a.id.localeCompare(b.id))
  }

  if (provider === 'anthropic') {
    const { status, body } = await getJson<{ data: Array<{ id: string; display_name?: string }> }>(`${base}/v1/models?limit=1000`, headers)
    if (status === 401 || status === 403) throw new Error('Anthropic rejected the API key.')
    if (status !== 200 || !body) throw new Error(`Anthropic returned HTTP ${status}`)
    return body.data.map((m) => ({ id: m.id, name: m.display_name ?? m.id }))
  }

  if (provider === 'google') {
    interface GoogleRaw { name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }
    const { status, body } = await getJson<{ models?: GoogleRaw[] }>(`${base}/v1beta/models?pageSize=1000`, headers)
    if (status === 400 || status === 401 || status === 403) throw new Error('Google rejected the API key.')
    if (status !== 200 || !body) throw new Error(`Google returned HTTP ${status}`)
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /^models\/gemini/.test(m.name) && !GOOGLE_NOT_CHAT.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName ?? m.name, contextLength: m.inputTokenLimit }))
      .sort((a, b) => b.id.localeCompare(a.id))
  }

  // OpenAI and custom OpenAI-compatible servers share the same /models shape.
  const { status, body } = await getJson<{ data?: Array<{ id: string }> }>(`${base}/models`, headers)
  if (status === 401 || status === 403) throw new Error(`${provider === 'openai' ? 'OpenAI' : 'The server'} rejected the API key.`)
  if (status !== 200 || !body?.data) throw new Error(`${provider === 'openai' ? 'OpenAI' : 'The server'} returned HTTP ${status}`)
  const list = body.data.map((m) => ({ id: m.id, name: m.id }))
  const filtered = provider === 'openai' ? list.filter((m) => OPENAI_CHAT.test(m.id) && !OPENAI_NOT_CHAT.test(m.id)) : list
  return filtered.sort((a, b) => b.id.localeCompare(a.id))
}

export async function listModels(provider: ProviderId, key: string, customBaseUrl: string, force = false): Promise<ModelInfo[]> {
  const cacheKey = `${provider}|${provider === 'custom' ? customBaseUrl : ''}|${key.slice(-6)}`
  const hit = cache.get(cacheKey)
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.models

  if (provider !== 'openrouter' && provider !== 'custom' && !key) throw new Error('Add an API key to see the models available to your account.')
  try {
    const models = await fetchModels(provider, key, customBaseUrl)
    cache.set(cacheKey, { at: Date.now(), models })
    if (provider === 'openrouter') {
      mkdirSync(paths.cache, { recursive: true })
      writeFileSync(openRouterDisk(), JSON.stringify({ at: Date.now(), models }))
    }
    return models
  } catch (err) {
    if (hit) return hit.models
    if (provider === 'openrouter' && existsSync(openRouterDisk())) return (JSON.parse(readFileSync(openRouterDisk(), 'utf8')) as { models: ModelInfo[] }).models
    throw err
  }
}

// ---------- key checks ----------

export async function checkKey(provider: ProviderId, key: string, customBaseUrl: string): Promise<KeyCheck> {
  const trimmed = key.trim()
  if (!trimmed && provider !== 'custom') return { ok: false, message: 'No key entered.' }
  const base = baseUrlFor(provider, customBaseUrl)
  try {
    if (provider === 'openrouter') {
      const { status, body } = await getJson<{ data?: { label?: string; usage?: number; limit?: number | null } }>(`${base}/key`, authHeaders(provider, trimmed))
      if (status === 401 || status === 403) return { ok: false, message: 'OpenRouter rejected this key.' }
      if (status !== 200) return { ok: false, message: `OpenRouter returned HTTP ${status}.` }
      return { ok: true, message: 'Key is valid.', label: body?.data?.label, usage: body?.data?.usage, limit: body?.data?.limit ?? null }
    }
    // For the others, listing models is the cheapest authenticated call.
    const models = await fetchModels(provider, trimmed, customBaseUrl)
    return { ok: true, message: provider === 'custom' ? `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.` : 'Key is valid.' }
  } catch (err) {
    const message = (err as Error).message
    if (provider === 'custom') return { ok: false, message: `Couldn't reach ${base}. Is the server running? (${message})` }
    return { ok: false, message: /rejected|HTTP/.test(message) ? message : `Could not reach the provider: ${message}` }
  }
}
