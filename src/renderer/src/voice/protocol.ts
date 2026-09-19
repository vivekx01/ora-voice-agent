// Message shapes exchanged with the speech workers.

export interface TtsParams {
  voice: string
  lang: string
  steps: number
  speed: number
  maxChunk: number
}

export type TtsRequest =
  | { type: 'init'; assetBase: string; modelBase: string; voice: string }
  | { type: 'synth'; id: number; text: string; params: TtsParams }
  | { type: 'cancel' }

export type TtsResponse =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'ready'; backend: 'webgpu' | 'wasm'; sampleRate: number; loadMs: number }
  | { type: 'chunk'; id: number; index: number; audio: Float32Array; sampleRate: number; ms: number }
  | { type: 'done'; id: number; ms: number; cancelled: boolean }
  | { type: 'error'; id?: number; message: string }
  | { type: 'lost'; message: string }

export type SttRequest =
  | { type: 'init'; assetBase: string; model: string }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string }

export type SttResponse =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'ready'; backend: 'webgpu' | 'wasm'; loadMs: number }
  | { type: 'result'; id: number; text: string; ms: number }
  | { type: 'error'; id?: number; message: string }
  | { type: 'lost'; message: string }
