/// <reference lib="webworker" />
import { chunkText, SupertonicEngine, watchGpuDevice } from '../engine/supertonic'
import type { TtsRequest, TtsResponse } from './protocol'

const post = (msg: TtsResponse, transfer: Transferable[] = []): void => self.postMessage(msg, { transfer })

let engine: SupertonicEngine | null = null
let generation = 0
let queue: Promise<void> = Promise.resolve()

async function init(req: Extract<TtsRequest, { type: 'init' }>): Promise<void> {
  const t0 = performance.now()
  try {
    engine = await SupertonicEngine.load({
      modelBase: req.modelBase,
      assetBase: req.assetBase,
      onProgress: (stage, fraction) => post({ type: 'progress', stage, fraction })
    })
    if (engine.backend === 'webgpu') watchGpuDevice((message) => post({ type: 'lost', message }))
    post({ type: 'progress', stage: 'Warming up', fraction: 0.95 })
    const voice = await engine.loadVoice(req.voice)
    await engine.synthesize('Hello, this is a warm up.', { voice, lang: 'en', steps: 2, speed: 1 })
    post({ type: 'ready', backend: engine.backend, sampleRate: engine.sampleRate, loadMs: Math.round(performance.now() - t0) })
  } catch (err) {
    post({ type: 'error', message: `Text-to-speech failed to start: ${(err as Error).message}` })
  }
}

async function synth(req: Extract<TtsRequest, { type: 'synth' }>, gen: number): Promise<void> {
  if (!engine) return post({ type: 'error', id: req.id, message: 'Text-to-speech is not ready yet.' })
  const started = performance.now()
  try {
    const voice = await engine.loadVoice(req.params.voice)
    const pieces = chunkText(req.text, req.params.maxChunk)
    for (let i = 0; i < pieces.length; i++) {
      if (gen !== generation) return post({ type: 'done', id: req.id, ms: 0, cancelled: true })
      const t = performance.now()
      const { audio } = await engine.synthesize(pieces[i], { voice, lang: req.params.lang, steps: req.params.steps, speed: req.params.speed })
      if (gen !== generation) return post({ type: 'done', id: req.id, ms: 0, cancelled: true })
      if (audio.length) post({ type: 'chunk', id: req.id, index: i, audio, sampleRate: engine.sampleRate, ms: Math.round(performance.now() - t) }, [audio.buffer])
    }
    post({ type: 'done', id: req.id, ms: Math.round(performance.now() - started), cancelled: false })
  } catch (err) {
    post({ type: 'error', id: req.id, message: (err as Error).message })
    post({ type: 'done', id: req.id, ms: 0, cancelled: true })
  }
}

self.onmessage = (ev: MessageEvent<TtsRequest>): void => {
  const req = ev.data
  if (req.type === 'init') void init(req)
  else if (req.type === 'cancel') generation++
  else if (req.type === 'synth') {
    const gen = generation
    queue = queue.then(() => synth(req, gen))
  }
}
