import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, PROVIDERS, type DeepPartial, type ProviderId, type ProviderKeys, type Settings } from '@shared/types'
import { paths } from './paths'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : (patch as T))
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlainObject(out[k]) && isPlainObject(v) ? deepMerge(out[k], v) : v
  }
  return out as T
}

function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}

let current: Settings | null = null

export function getSettings(): Settings {
  if (current) return current
  let stored: unknown = {}
  try {
    if (existsSync(paths.settings)) stored = JSON.parse(readFileSync(paths.settings, 'utf8'))
  } catch (err) {
    console.error('[settings] failed to read, using defaults', err)
  }
  const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), stored)
  if (!merged.tools.sandboxDir) merged.tools.sandboxDir = paths.defaultSandbox
  if (merged.agent.name === 'Vox') merged.agent.name = 'Ora' // renamed app: carry over the old default name
  current = merged
  return current
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  current = deepMerge(getSettings(), patch)
  writeJsonAtomic(paths.settings, current)
  return current
}

export function resetSettings(): Settings {
  current = structuredClone(DEFAULT_SETTINGS)
  current.tools.sandboxDir = paths.defaultSandbox
  writeJsonAtomic(paths.settings, current)
  return current
}

// API keys: one encrypted blob (OS keychain / DPAPI when available) holding a key per provider.

type Secrets = Partial<Record<ProviderId, string>>

const ENV_KEYS: Record<ProviderId, string[]> = {
  openrouter: ['OPENROUTER_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  custom: []
}

const PLAIN = Buffer.from('plain:')

function encode(text: string): Buffer {
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.concat([PLAIN, Buffer.from(text, 'utf8')])
}

function decode(raw: Buffer): string {
  if (raw.subarray(0, PLAIN.length).equals(PLAIN)) return raw.subarray(PLAIN.length).toString('utf8')
  return safeStorage.decryptString(raw)
}

function readSecrets(): Secrets {
  try {
    if (existsSync(paths.secretsV2)) return JSON.parse(decode(readFileSync(paths.secretsV2))) as Secrets
    // Older versions stored a single OpenRouter key.
    if (existsSync(paths.secrets)) {
      const legacy = readFileSync(paths.secrets)
      if (legacy.length) return { openrouter: decode(legacy) }
    }
  } catch (err) {
    console.error('[settings] failed to read API keys', err)
  }
  return {}
}

function writeSecrets(secrets: Secrets): void {
  mkdirSync(dirname(paths.secretsV2), { recursive: true })
  writeFileSync(paths.secretsV2, encode(JSON.stringify(secrets)))
  if (existsSync(paths.secrets)) unlinkSync(paths.secrets)
}

export function getApiKey(provider: ProviderId): string {
  const stored = readSecrets()[provider]
  if (stored) return stored
  for (const name of ENV_KEYS[provider]) if (process.env[name]) return process.env[name] as string
  return ''
}

export function keyStatus(): ProviderKeys {
  const status = {} as ProviderKeys
  for (const p of PROVIDERS) status[p.id] = getApiKey(p.id).length > 0
  return status
}

export function setApiKey(provider: ProviderId, key: string): void {
  const secrets = readSecrets()
  const trimmed = key.trim()
  if (trimmed) secrets[provider] = trimmed
  else delete secrets[provider]
  writeSecrets(secrets)
}
