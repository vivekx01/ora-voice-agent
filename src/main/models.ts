import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { SUPERTONIC_FILES, SUPERTONIC_REPO, type DownloadProgress, type ModelsStatus } from '@shared/types'
import { paths } from './paths'

export function modelsStatus(): ModelsStatus {
  const missing = SUPERTONIC_FILES.filter((f) => !existsSync(join(paths.supertonic, f)))
  return { ready: missing.length === 0, dir: paths.supertonic, missing }
}

const urlFor = (file: string): string => `https://huggingface.co/${SUPERTONIC_REPO}/resolve/main/${file}`

async function remoteSize(file: string, signal?: AbortSignal): Promise<number> {
  const res = await fetch(urlFor(file), { method: 'HEAD', redirect: 'follow', signal })
  if (!res.ok) throw new Error(`Cannot reach ${file} (HTTP ${res.status})`)
  return Number(res.headers.get('content-length') ?? 0)
}

// Downloads any missing Supertonic files from Hugging Face. Existing files are kept.
export async function downloadModels(onProgress: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
  const todo = modelsStatus().missing
  if (todo.length === 0) return

  const sizes = new Map<string, number>()
  await Promise.all(todo.map(async (f) => sizes.set(f, await remoteSize(f, signal))))
  const overallTotal = [...sizes.values()].reduce((a, b) => a + b, 0)
  let overallDone = 0

  for (const file of todo) {
    const dest = join(paths.supertonic, file)
    const part = `${dest}.part`
    mkdirSync(dirname(dest), { recursive: true })
    const total = sizes.get(file) ?? 0
    let received = 0

    const res = await fetch(urlFor(file), { redirect: 'follow', signal })
    if (!res.ok || !res.body) throw new Error(`Download failed for ${file} (HTTP ${res.status})`)

    const source = Readable.fromWeb(res.body as never)
    source.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress({ file, received, total, overallReceived: overallDone + received, overallTotal, done: false })
    })
    try {
      await pipeline(source, createWriteStream(part))
      if (total && statSync(part).size !== total) throw new Error(`Incomplete download for ${file}`)
      renameSync(part, dest)
    } catch (err) {
      if (existsSync(part)) unlinkSync(part)
      throw err
    }
    overallDone += total || received
  }
  onProgress({ file: '', received: 0, total: 0, overallReceived: overallTotal, overallTotal, done: true })
}
