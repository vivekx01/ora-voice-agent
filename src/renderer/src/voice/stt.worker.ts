/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers'
import { watchGpuDevice } from '../engine/supertonic'
import type { SttRequest, SttResponse } from './protocol'

const post = (msg: SttResponse): void => self.postMessage(msg)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null
let multilingual = false
let queue: Promise<void> = Promise.resolve()

async function init(req: Extract<SttRequest, { type: 'init' }>): Promise<void> {
  const t0 = performance.now()
  env.allowLocalModels = false
  env.useBrowserCache = true
  const onnx = env.backends.onnx as { logLevel?: string; wasm?: { wasmPaths?: string; numThreads?: number } }
  onnx.logLevel = 'error'
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = `${req.assetBase}ort/`
    onnx.wasm.numThreads = 1
  }
  multilingual = !/\.en$/.test(req.model)

  const files = new Map<string, { loaded: number; total: number }>()
  const progress_callback = (p: { status?: string; file?: string; loaded?: number; total?: number }): void => {
    if (p.status === 'progress' && p.file && p.total) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
      let loaded = 0
      let total = 0
      for (const f of files.values()) {
        loaded += f.loaded
        total += f.total
      }
      post({ type: 'progress', stage: 'Downloading speech recognition model', fraction: total ? Math.min(0.9, (loaded / total) * 0.9) : 0 })
    }
  }

  const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: Record<string, string> }> = []
  if ('gpu' in self.navigator) attempts.push({ device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } })
  attempts.push({ device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } })

  let lastError: unknown
  for (const a of attempts) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      asr = await (pipeline as any)('automatic-speech-recognition', req.model, { device: a.device, dtype: a.dtype, progress_callback })
      if (a.device === 'webgpu') watchGpuDevice((message) => post({ type: 'lost', message }))
      if (a.device === 'webgpu') {
        post({ type: 'progress', stage: 'Warming up', fraction: 0.95 })
        await asr(new Float32Array(16000), multilingual ? { language: 'en', task: 'transcribe' } : {})
      }
      post({ type: 'ready', backend: a.device, loadMs: Math.round(performance.now() - t0) })
      return
    } catch (err) {
      lastError = err
      console.warn(`[stt] ${a.device} failed`, err)
    }
  }
  post({ type: 'error', message: `Speech recognition failed to start: ${(lastError as Error)?.message ?? lastError}` })
}

async function transcribe(req: Extract<SttRequest, { type: 'transcribe' }>): Promise<void> {
  if (!asr) return post({ type: 'error', id: req.id, message: 'Speech recognition is not ready yet.' })
  const t0 = performance.now()
  try {
    const opts: Record<string, unknown> = { chunk_length_s: 30, return_timestamps: false }
    if (multilingual) {
      opts.task = 'transcribe'
      if (req.language && req.language !== 'auto') opts.language = req.language
    }
    const out = await asr(req.audio, opts)
    const text = (Array.isArray(out) ? out.map((o: { text: string }) => o.text).join(' ') : out.text) as string
    post({ type: 'result', id: req.id, text: text.trim(), ms: Math.round(performance.now() - t0) })
  } catch (err) {
    post({ type: 'error', id: req.id, message: (err as Error).message })
  }
}

self.onmessage = (ev: MessageEvent<SttRequest>): void => {
  const req = ev.data
  if (req.type === 'init') void init(req)
  else queue = queue.then(() => transcribe(req))
}
