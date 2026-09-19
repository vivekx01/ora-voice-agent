// Gapless playback of streamed PCM chunks with a level meter for the UI.
export class AudioPlayer {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private readonly meter = new Uint8Array(1024)
  private nextTime = 0
  private readonly active = new Set<AudioBufferSourceNode>()
  private inputClosed = true
  private onDrained: (() => void) | null = null
  private volume = 1
  private sinkId = 'default'

  get playing(): boolean {
    return this.active.size > 0
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      this.gain = ctx.createGain()
      this.gain.gain.value = this.volume
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.gain.connect(this.analyser)
      this.analyser.connect(ctx.destination)
      this.ctx = ctx
      void this.applySink()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private async applySink(): Promise<void> {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
    if (!ctx?.setSinkId) return
    try {
      await ctx.setSinkId(this.sinkId === 'default' ? '' : this.sinkId)
    } catch (err) {
      console.warn('[player] could not switch output device', err)
    }
  }

  setVolume(v: number): void {
    this.volume = v
    if (this.gain) this.gain.gain.value = v
  }

  setSink(id: string): void {
    this.sinkId = id
    void this.applySink()
  }

  // Start a new utterance; `onDrained` fires once all audio has played after finish().
  begin(onDrained: () => void): void {
    this.stop()
    this.inputClosed = false
    this.onDrained = onDrained
  }

  enqueue(pcm: Float32Array, sampleRate: number, leadGap = 0.07): void {
    const ctx = this.ensure()
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
    buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.gain as GainNode)
    const startAt = Math.max(this.nextTime + (this.nextTime > ctx.currentTime ? leadGap : 0), ctx.currentTime + 0.03)
    src.start(startAt)
    this.nextTime = startAt + buffer.duration
    this.active.add(src)
    src.onended = () => {
      this.active.delete(src)
      this.checkDrained()
    }
  }

  finish(): void {
    this.inputClosed = true
    this.checkDrained()
  }

  stop(): void {
    for (const s of this.active) {
      s.onended = null
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }
    this.active.clear()
    this.nextTime = 0
    this.inputClosed = true
    this.onDrained = null
  }

  private checkDrained(): void {
    if (this.inputClosed && this.active.size === 0 && this.onDrained) {
      const cb = this.onDrained
      this.onDrained = null
      cb()
    }
  }

  // 0..1 output level, for the orb.
  level(): number {
    if (!this.analyser || this.active.size === 0) return 0
    this.analyser.getByteTimeDomainData(this.meter)
    let sum = 0
    for (const v of this.meter) {
      const x = (v - 128) / 128
      sum += x * x
    }
    return Math.min(1, Math.sqrt(sum / this.meter.length) * 3.2)
  }
}
