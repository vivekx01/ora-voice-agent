import type { SttRequest, SttResponse, TtsParams, TtsRequest, TtsResponse } from './protocol'
import SttWorker from './stt.worker?worker'
import TtsWorker from './tts.worker?worker'

export const assetBase = new URL('./', document.baseURI).href
export const MODEL_BASE = 'ora://models/supertonic-3'

export type ProgressFn = (stage: string, fraction: number) => void

export interface SynthHandle {
  id: number
  done: Promise<{ cancelled: boolean; ms: number }>
}

export class TtsClient {
  private worker = new TtsWorker()
  private nextId = 1
  private jobs = new Map<number, { onChunk: (audio: Float32Array, sampleRate: number, ms: number) => void; resolve: (r: { cancelled: boolean; ms: number }) => void }>()
  private ready: { resolve: (v: { backend: 'webgpu' | 'wasm'; sampleRate: number; loadMs: number }) => void; reject: (e: Error) => void; onProgress?: ProgressFn } | null = null
  onError?: (message: string) => void
  onLost?: (message: string) => void

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<TtsResponse>) => {
      const m = ev.data
      if (m.type === 'lost') return this.onLost?.(m.message)
      if (m.type === 'progress') this.ready?.onProgress?.(m.stage, m.fraction)
      else if (m.type === 'ready') this.ready?.resolve({ backend: m.backend, sampleRate: m.sampleRate, loadMs: m.loadMs })
      else if (m.type === 'chunk') this.jobs.get(m.id)?.onChunk(m.audio, m.sampleRate, m.ms)
      else if (m.type === 'done') {
        this.jobs.get(m.id)?.resolve({ cancelled: m.cancelled, ms: m.ms })
        this.jobs.delete(m.id)
      } else if (m.type === 'error') {
        if (m.id === undefined) this.ready?.reject(new Error(m.message))
        else this.onError?.(m.message)
      }
    }
  }

  init(voice: string, onProgress?: ProgressFn): Promise<{ backend: 'webgpu' | 'wasm'; sampleRate: number; loadMs: number }> {
    return new Promise((resolve, reject) => {
      this.ready = { resolve, reject, onProgress }
      this.post({ type: 'init', assetBase, modelBase: MODEL_BASE, voice })
    })
  }

  synth(text: string, params: TtsParams, onChunk: (audio: Float32Array, sampleRate: number, ms: number) => void): SynthHandle {
    const id = this.nextId++
    const done = new Promise<{ cancelled: boolean; ms: number }>((resolve) => this.jobs.set(id, { onChunk, resolve }))
    this.post({ type: 'synth', id, text, params })
    return { id, done }
  }

  cancelAll(): void {
    this.post({ type: 'cancel' })
  }

  dispose(): void {
    this.worker.terminate()
  }

  private post(req: TtsRequest): void {
    this.worker.postMessage(req)
  }
}

export class SttClient {
  private worker = new SttWorker()
  private nextId = 1
  private jobs = new Map<number, { resolve: (r: { text: string; ms: number }) => void; reject: (e: Error) => void }>()
  private ready: { resolve: (v: { backend: 'webgpu' | 'wasm'; loadMs: number }) => void; reject: (e: Error) => void; onProgress?: ProgressFn } | null = null
  onLost?: (message: string) => void

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<SttResponse>) => {
      const m = ev.data
      if (m.type === 'lost') return this.onLost?.(m.message)
      if (m.type === 'progress') this.ready?.onProgress?.(m.stage, m.fraction)
      else if (m.type === 'ready') this.ready?.resolve({ backend: m.backend, loadMs: m.loadMs })
      else if (m.type === 'result') {
        this.jobs.get(m.id)?.resolve({ text: m.text, ms: m.ms })
        this.jobs.delete(m.id)
      } else if (m.type === 'error') {
        if (m.id === undefined) this.ready?.reject(new Error(m.message))
        else {
          this.jobs.get(m.id)?.reject(new Error(m.message))
          this.jobs.delete(m.id)
        }
      }
    }
  }

  init(model: string, onProgress?: ProgressFn): Promise<{ backend: 'webgpu' | 'wasm'; loadMs: number }> {
    return new Promise((resolve, reject) => {
      this.ready = { resolve, reject, onProgress }
      this.post({ type: 'init', assetBase, model })
    })
  }

  transcribe(audio: Float32Array, language: string): Promise<{ text: string; ms: number }> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject })
      this.worker.postMessage({ type: 'transcribe', id, audio, language } satisfies SttRequest, [audio.buffer])
    })
  }

  dispose(): void {
    this.worker.terminate()
  }

  private post(req: SttRequest): void {
    this.worker.postMessage(req)
  }
}
