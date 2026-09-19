// Supertonic 3 on-device inference (ONNX Runtime Web).
// The pipeline (duration predictor -> text encoder -> N denoising steps -> vocoder) follows the
// reference web demo published with the model (Supertone/supertonic-3, MIT-licensed sample code).
import * as ort from 'onnxruntime-web'

export interface EngineConfig {
  ae: { sample_rate: number; base_chunk_size: number }
  ttl: { chunk_compress_factor: number; latent_dim: number }
}

export interface Voice {
  name: string
  styleTtl: ort.Tensor
  styleDp: ort.Tensor
}

export type Backend = 'webgpu' | 'wasm'

export const SUPERTONIC_LANGS = [
  'en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it',
  'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'
]

const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu

const REPLACEMENTS: Array<[string, string]> = [
  ['–', '-'], ['‑', '-'], ['—', '-'], ['_', ' '], ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"],
  ['´', "'"], ['`', "'"], ['[', ' '], [']', ' '], ['|', ' '], ['/', ' '], ['#', ' '], ['→', ' '], ['←', ' ']
]

export function preprocessText(input: string, lang: string): string {
  let text = input.normalize('NFKD').replace(EMOJI, '')
  for (const [k, v] of REPLACEMENTS) text = text.replaceAll(k, v)
  text = text.replace(/[♥☆♡©\\]/g, '')
  text = text.replaceAll('@', ' at ').replaceAll('e.g.,', 'for example,').replaceAll('i.e.,', 'that is,')
  text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!').replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':').replace(/ '/g, "'")
  while (text.includes('""')) text = text.replace(/""/g, '"')
  while (text.includes("''")) text = text.replace(/''/g, "'")
  text = text.replace(/\s+/g, ' ').trim()
  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) text += '.'
  const tag = SUPERTONIC_LANGS.includes(lang) ? lang : 'na'
  return `<${tag}>${text}</${tag}>`
}

export function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = []
  for (const paragraph of text.trim().split(/\n\s*\n+/).filter((p) => p.trim())) {
    const sentences = paragraph.trim().split(/(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/)
    let current = ''
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= maxLen) current += (current ? ' ' : '') + sentence
      else {
        if (current) chunks.push(current.trim())
        current = sentence
      }
    }
    if (current) chunks.push(current.trim())
  }
  return chunks
}

// Calls `onLost` if the GPU device is reset (driver watchdog, sleep/wake, out of memory).
export function watchGpuDevice(onLost: (message: string) => void): void {
  const holder = ort.env.webgpu as unknown as { device?: unknown }
  void Promise.resolve(holder.device)
    .then((device) => (device as GPUDevice | undefined)?.lost.then((info) => onLost(info.message || info.reason)))
    .catch(() => undefined)
}

function gaussian(): number {
  const u1 = Math.random() || Number.MIN_VALUE
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random())
}

const f32 = (data: Float32Array | number[], dims: number[]): ort.Tensor =>
  new ort.Tensor('float32', data instanceof Float32Array ? data : Float32Array.from(data), dims)

interface LoadOptions {
  modelBase: string
  assetBase: string
  onProgress?: (stage: string, fraction: number) => void
}

export class SupertonicEngine {
  readonly sampleRate: number
  private voices = new Map<string, Voice>()

  private constructor(
    readonly backend: Backend,
    private readonly cfg: EngineConfig,
    private readonly indexer: ArrayLike<number>,
    private readonly modelBase: string,
    private readonly dp: ort.InferenceSession,
    private readonly textEnc: ort.InferenceSession,
    private readonly vectorEst: ort.InferenceSession,
    private readonly vocoder: ort.InferenceSession
  ) {
    this.sampleRate = cfg.ae.sample_rate
  }

  static async load(opts: LoadOptions): Promise<SupertonicEngine> {
    ort.env.wasm.wasmPaths = `${opts.assetBase}ort/`
    ort.env.wasm.numThreads = 1
    ort.env.logLevel = 'error'
    const onnx = `${opts.modelBase}/onnx`
    const [cfg, indexer] = await Promise.all([
      fetch(`${onnx}/tts.json`).then((r) => r.json() as Promise<EngineConfig>),
      fetch(`${onnx}/unicode_indexer.json`).then((r) => r.json() as Promise<number[]>)
    ])

    const names = ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']
    const create = async (provider: Backend): Promise<ort.InferenceSession[]> => {
      let done = 0
      return Promise.all(
        names.map(async (n) => {
          const session = await ort.InferenceSession.create(`${onnx}/${n}.onnx`, { executionProviders: [provider], graphOptimizationLevel: 'all' })
          opts.onProgress?.(`Loading ${n.replace('_', ' ')}`, ++done / names.length)
          return session
        })
      )
    }

    let backend: Backend = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm'
    let sessions: ort.InferenceSession[]
    try {
      sessions = await create(backend)
    } catch (err) {
      if (backend === 'wasm') throw err
      console.warn('[supertonic] WebGPU failed, falling back to WASM', err)
      backend = 'wasm'
      sessions = await create('wasm')
    }
    return new SupertonicEngine(backend, cfg, indexer, opts.modelBase, sessions[0], sessions[1], sessions[2], sessions[3])
  }

  async loadVoice(name: string): Promise<Voice> {
    const cached = this.voices.get(name)
    if (cached) return cached
    const res = await fetch(`${this.modelBase}/voice_styles/${name}.json`)
    if (!res.ok) throw new Error(`Voice ${name} is not available (HTTP ${res.status})`)
    const j = (await res.json()) as { style_ttl: { data: unknown[]; dims: number[] }; style_dp: { data: unknown[]; dims: number[] } }
    const voice: Voice = {
      name,
      styleTtl: f32((j.style_ttl.data as number[][]).flat(Infinity) as number[], j.style_ttl.dims),
      styleDp: f32((j.style_dp.data as number[][]).flat(Infinity) as number[], j.style_dp.dims)
    }
    this.voices.set(name, voice)
    return voice
  }

  private toIds(text: string): BigInt64Array {
    const ids: bigint[] = []
    for (const ch of Array.from(text)) {
      const idx = this.indexer[ch.charCodeAt(0)]
      if (idx !== undefined && idx !== null && idx !== -1) ids.push(BigInt(idx))
    }
    return BigInt64Array.from(ids)
  }

  // Synthesizes one chunk (up to a few hundred characters). Returns mono float PCM at `sampleRate`.
  async synthesize(rawText: string, o: { voice: Voice; lang: string; steps: number; speed: number }): Promise<{ audio: Float32Array; seconds: number }> {
    const ids = this.toIds(preprocessText(rawText, o.lang))
    const len = ids.length
    if (len <= 8) return { audio: new Float32Array(0), seconds: 0 }

    const textIds = new ort.Tensor('int64', ids, [1, len])
    const textMask = f32(new Float32Array(len).fill(1), [1, 1, len])

    const dpOut = await this.dp.run({ text_ids: textIds, style_dp: o.voice.styleDp, text_mask: textMask })
    const seconds = (dpOut.duration.data as Float32Array)[0] / (o.speed + 0.05)

    const textEmb = (await this.textEnc.run({ text_ids: textIds, style_ttl: o.voice.styleTtl, text_mask: textMask })).text_emb

    const { base_chunk_size, sample_rate } = this.cfg.ae
    const { chunk_compress_factor, latent_dim } = this.cfg.ttl
    const chunk = base_chunk_size * chunk_compress_factor
    const latentDim = latent_dim * chunk_compress_factor
    const latentLen = Math.max(1, Math.floor((seconds * sample_rate + chunk - 1) / chunk))
    const validLen = Math.floor((Math.floor(seconds * sample_rate) + chunk - 1) / chunk)

    const latent = new Float32Array(latentDim * latentLen)
    for (let d = 0; d < latentDim; d++) for (let t = 0; t < validLen && t < latentLen; t++) latent[d * latentLen + t] = gaussian()
    const latentMask = new Float32Array(latentLen)
    for (let t = 0; t < validLen && t < latentLen; t++) latentMask[t] = 1
    const latentMaskT = f32(latentMask, [1, 1, latentLen])
    const totalStep = f32([o.steps], [1])

    for (let step = 0; step < o.steps; step++) {
      const out = await this.vectorEst.run({
        noisy_latent: f32(latent, [1, latentDim, latentLen]),
        text_emb: textEmb,
        style_ttl: o.voice.styleTtl,
        text_mask: textMask,
        latent_mask: latentMaskT,
        total_step: totalStep,
        current_step: f32([step], [1])
      })
      latent.set(out.denoised_latent.data as Float32Array)
    }

    const wav = (await this.vocoder.run({ latent: f32(latent, [1, latentDim, latentLen]) })).wav_tts.data as Float32Array
    return { audio: wav.slice(0, Math.floor(sample_rate * seconds)), seconds }
  }
}
