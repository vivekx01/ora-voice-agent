import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Conversation, ConversationSummary } from '@shared/types'
import { paths } from './paths'

const fileFor = (id: string): string => join(paths.conversations, `${id.replace(/[^a-zA-Z0-9-]/g, '')}.json`)

export function createConversation(): Conversation {
  const now = Date.now()
  return { id: randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, messages: [] }
}

export function getConversation(id: string): Conversation | null {
  const file = fileFor(id)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Conversation
  } catch {
    return null
  }
}

export function saveConversation(conv: Conversation): void {
  mkdirSync(paths.conversations, { recursive: true })
  const file = fileFor(conv.id)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify({ ...conv, updatedAt: Date.now() }), 'utf8')
  renameSync(tmp, file)
}

export function deleteConversation(id: string): void {
  const file = fileFor(id)
  if (existsSync(file)) unlinkSync(file)
}

export function listConversations(): ConversationSummary[] {
  if (!existsSync(paths.conversations)) return []
  const out: ConversationSummary[] = []
  for (const name of readdirSync(paths.conversations)) {
    if (!name.endsWith('.json')) continue
    try {
      const c = JSON.parse(readFileSync(join(paths.conversations, name), 'utf8')) as Conversation
      if (c.messages.length === 0) continue
      const last = [...c.messages].reverse().find((m) => m.text.trim())
      out.push({ id: c.id, title: c.title, updatedAt: c.updatedAt, preview: last?.text.slice(0, 90) ?? '' })
    } catch {
      /* skip unreadable file */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}
