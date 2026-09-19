// Turns a token stream from the LLM into speakable sentences, so audio can start
// after the first sentence instead of after the whole reply.

const ABBREVIATION = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Co|No)|\b[A-Z]|e\.g|i\.e)\.$/

function isBoundary(buf: string, i: number): boolean {
  const c = buf[i]
  if (c === '\n') return true
  if (c !== '.' && c !== '!' && c !== '?' && c !== '…') return false
  let j = i + 1
  while (j < buf.length && /["')\]”’*_]/.test(buf[j])) j++
  if (j >= buf.length) return false // can't tell yet (could be "3.5" or "Dr.")
  if (!/\s/.test(buf[j])) return false
  if (c === '.' && ABBREVIATION.test(buf.slice(0, i + 1))) return false
  return true
}

// Removes markdown so it isn't read aloud ("asterisk asterisk").
export function toSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\|/g, ', ')
    .replace(/(\d)\s?%/g, '$1 percent')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
}

export class SentenceStream {
  private buf = ''
  private emitted = 0
  private fenceOpen = false

  constructor(
    private readonly firstChunkChars = 90,
    private readonly maxChars = 220
  ) {}

  push(text: string): string[] {
    this.buf += text
    return this.drain(false)
  }

  flush(): string[] {
    return this.drain(true)
  }

  private drain(final: boolean): string[] {
    const out: string[] = []
    for (;;) {
      let cut = -1
      for (let i = 0; i < this.buf.length; i++) {
        if (isBoundary(this.buf, i)) {
          cut = i + 1
          break
        }
      }
      if (cut < 0) cut = this.softCut()
      if (cut < 0) break
      this.take(this.buf.slice(0, cut), out)
      this.buf = this.buf.slice(cut)
    }
    if (final && this.buf.trim()) {
      this.take(this.buf, out)
      this.buf = ''
    }
    return out
  }

  // Long run without punctuation: break at a comma so speech can still start early.
  private softCut(): number {
    const limit = this.emitted === 0 ? this.firstChunkChars : this.maxChars
    if (this.buf.length < limit) return -1
    const window = this.buf.slice(0, limit + 40)
    const m = [...window.matchAll(/[,;:—-]\s/g)].pop()
    if (m?.index !== undefined && m.index > 25) return m.index + 1
    const space = window.lastIndexOf(' ', limit)
    return space > 25 ? space : -1
  }

  private take(raw: string, out: string[]): void {
    const speakable = this.stripFences(raw)
    const text = toSpeech(speakable)
    if (/[\p{L}\p{N}]/u.test(text)) {
      out.push(text)
      this.emitted++
    }
  }

  private stripFences(sentence: string): string {
    const fences = (sentence.match(/```/g) ?? []).length
    if (this.fenceOpen) {
      if (fences % 2 === 1) this.fenceOpen = false
      return ''
    }
    if (fences % 2 === 1) {
      this.fenceOpen = true
      return sentence.slice(0, sentence.indexOf('```'))
    }
    return sentence
  }
}

// Whisper sometimes "hears" noise as bracketed tags or filler. Ignore those.
export function isNoiseTranscript(text: string): boolean {
  const t = text.trim()
  if (t.length < 2) return true
  if (/^[\[(*♪].*[\])*♪]$/.test(t)) return true
  return /^(you|thank you\.?|thanks for watching!?|bye\.?|\.+)$/i.test(t)
}
