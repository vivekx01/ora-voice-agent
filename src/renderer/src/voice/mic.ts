import { MicVAD } from '@ricky0123/vad-web'
import type { ListenMode } from '@shared/types'
import { assetBase } from './clients'

export interface MicOptions {
  deviceId: string
  mode: ListenMode
  sensitivity: 'low' | 'medium' | 'high'
  silenceMs: number
}

export interface MicEvents {
  onSpeechStart: () => void
  onSpeechEnd: (audio: Float32Array) => void
  onMisfire: () => void
  onLevel: (rms: number, speechProbability: number) => void
}

const THRESHOLDS = {
  low: { pos: 0.7, neg: 0.5 },
  medium: { pos: 0.55, neg: 0.38 },
  high: { pos: 0.4, neg: 0.22 }
}

// Wraps Silero VAD: detects when the user starts and stops talking, and hands back the audio.
export class MicListener {
  private vad: MicVAD | null = null
  private stream: MediaStream | null = null
  private opts: MicOptions | null = null
  private strict = false

  constructor(private readonly events: MicEvents) {}

  get running(): boolean {
    return this.vad?.listening ?? false
  }

  private thresholds(): { positiveSpeechThreshold: number; negativeSpeechThreshold: number } {
    if (this.opts?.mode === 'ptt') return { positiveSpeechThreshold: 0.35, negativeSpeechThreshold: 0.2 }
    // While the assistant is talking, demand clearer speech so its own voice doesn't trigger an interruption.
    if (this.strict) return { positiveSpeechThreshold: 0.85, negativeSpeechThreshold: 0.65 }
    const t = THRESHOLDS[this.opts?.sensitivity ?? 'medium']
    return { positiveSpeechThreshold: t.pos, negativeSpeechThreshold: t.neg }
  }

  async open(opts: MicOptions): Promise<void> {
    await this.destroy()
    this.opts = opts
    const audio: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    if (opts.deviceId && opts.deviceId !== 'default') audio.deviceId = { exact: opts.deviceId }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio })
    const stream = this.stream

    this.vad = await MicVAD.new({
      model: 'v5',
      baseAssetPath: `${assetBase}vad/`,
      onnxWASMBasePath: `${assetBase}ort/`,
      ortConfig: (ort) => {
        ort.env.logLevel = 'error'
      },
      startOnLoad: false,
      submitUserSpeechOnPause: opts.mode === 'ptt',
      redemptionMs: opts.mode === 'ptt' ? 15_000 : opts.silenceMs,
      preSpeechPadMs: 320,
      minSpeechMs: opts.mode === 'ptt' ? 120 : 260,
      ...this.thresholds(),
      getStream: async () => stream,
      pauseStream: async (s) => s.getTracks().forEach((t) => (t.enabled = false)),
      resumeStream: async (s) => {
        s.getTracks().forEach((t) => (t.enabled = true))
        return s
      },
      onSpeechStart: () => this.events.onSpeechStart(),
      onSpeechEnd: (audio) => this.events.onSpeechEnd(audio),
      onVADMisfire: () => this.events.onMisfire(),
      onFrameProcessed: (probs, frame) => {
        let sum = 0
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
        this.events.onLevel(Math.sqrt(sum / frame.length), probs.isSpeech)
      }
    })
  }

  async start(): Promise<void> {
    if (this.vad && !this.vad.listening) await this.vad.start()
  }

  async pause(): Promise<void> {
    if (this.vad?.listening) await this.vad.pause()
  }

  // Ends the current segment right now and hands back whatever audio was captured, as if
  // the user had released push-to-talk - lets the user cut off a VAD listen that noise is
  // keeping open (or just wants to stop and let the answer proceed sooner).
  async forceEnd(): Promise<void> {
    if (!this.vad?.listening) return
    this.vad.setOptions({ submitUserSpeechOnPause: true })
    await this.vad.pause()
    this.vad.setOptions({ submitUserSpeechOnPause: this.opts?.mode === 'ptt' })
  }

  setStrict(strict: boolean): void {
    if (this.strict === strict) return
    this.strict = strict
    this.vad?.setOptions(this.thresholds())
  }

  async destroy(): Promise<void> {
    try {
      await this.vad?.destroy()
    } catch {
      /* ignore */
    }
    this.vad = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}
