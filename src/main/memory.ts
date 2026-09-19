import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MemoryItem } from '@shared/types'
import { paths } from './paths'

function read(): MemoryItem[] {
  try {
    if (existsSync(paths.memory)) return JSON.parse(readFileSync(paths.memory, 'utf8')) as MemoryItem[]
  } catch {
    /* fall through */
  }
  return []
}

function write(items: MemoryItem[]): void {
  mkdirSync(dirname(paths.memory), { recursive: true })
  writeFileSync(paths.memory, JSON.stringify(items, null, 2), 'utf8')
}

export const memory = {
  list: (): MemoryItem[] => read(),
  add(text: string): MemoryItem {
    const items = read()
    const clean = text.trim().slice(0, 400)
    const existing = items.find((i) => i.text.toLowerCase() === clean.toLowerCase())
    if (existing) return existing
    const item: MemoryItem = { id: randomUUID(), text: clean, createdAt: Date.now() }
    write([...items, item].slice(-100))
    return item
  },
  remove(id: string): void {
    write(read().filter((i) => i.id !== id))
  },
  removeMatching(query: string): number {
    const q = query.toLowerCase()
    const items = read()
    const keep = items.filter((i) => !i.text.toLowerCase().includes(q))
    write(keep)
    return items.length - keep.length
  },
  clear(): void {
    write([])
  }
}
