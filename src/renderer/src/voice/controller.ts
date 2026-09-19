import type { AgentEvent, ChatMessage, Settings, ToolCallRecord } from '@shared/types'
import { levels } from '../levels'
import { useStore, type VoiceState } from '../store'
import { SttClient, TtsClient } from './clients'
import { MicListener } from './mic'
import { AudioPlayer } from './player'
import { isNoiseTranscript, SentenceStream } from './sentences'

interface Turn {
  assistantId: string
  startedAt: number
  sttMs?: number
  runId: string | null
  sentences: SentenceStream
  pending: number
  agentEnded: boolean
  needSpace: boolean
  firstAudioAt?: number
  firstTokenMs?: number
  cancelled: boolean
  buffered: string
  flushQueued: boolean
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

const DEVICE_LOST = /device.{0,12}lost|OrtRun|out of memory|GPUDevice/i

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()
const cfg = (): Settings => useStore.getState().settings
const set = (patch: Parameters<ReturnType<typeof useStore.getState>['set']>[0]): void => useStore.getState().set(patch)

class VoiceController {
  private tts: TtsClient = this.makeTts()
  private stt: SttClient = this.makeStt()
  private loadChain: Promise<unknown> = Promise.resolve()
  private readonly player = new AudioPlayer()
  private readonly mic: MicListener
  private turn: Turn | null = null
  private booted = false
  private ttsReady = false
  private sttReady = false
  private micKey = ''
  private eventBuffer: AgentEvent[] = []
  private utteranceBusy = false
  private readonly recovering = { tts: false, stt: false }
  private readonly recoveries: Record<'tts' | 'stt', number[]> = { tts: [], stt: [] }

  constructor() {
    this.mic = new MicListener({
      onSpeechStart: () => this.onSpeechStart(),
      onSpeechEnd: (audio) => void this.onSpeechEnd(audio),
      onMisfire: () => {
        if (st().voice === 'hearing') this.setVoice(this.listeningState())
      },
      onLevel: (rms) => {
        levels.mic = Math.max(levels.mic * 0.8, Math.min(1, rms * 9))
      }
    })
    window.ora.agent.onEvent((e) => this.onAgentEvent(e))
    window.ora.system.onTimer(({ label }) => void this.say(`Your ${label.toLowerCase().includes('timer') ? label : `${label} timer`} is done.`))
    window.ora.system.onHotkey(() => this.onHotkey())
    const tick = (): void => {
      levels.out = levels.out * 0.6 + this.player.level() * 0.4
      levels.mic *= 0.92
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // ---------- lifecycle ----------

  async boot(): Promise<void> {
    if (this.booted) return
    this.booted = true
    const s = cfg()
    this.player.setVolume(s.tts.volume)
    this.player.setSink(s.stt.outputDeviceId)
    await this.queueLoad(() => this.loadTts())
    await this.queueLoad(() => this.loadStt())
    this.setVoice('idle')
    if (cfg().stt.autoListen && cfg().stt.mode === 'vad') void this.setMic(true)
  }

  // Engines load one at a time: on an integrated GPU, warming both up together can trip the
  // driver's watchdog and reset the device.
  private queueLoad(fn: () => Promise<void>): Promise<void> {
    const next = this.loadChain.then(fn, fn)
    this.loadChain = next.catch(() => undefined)
    return next
  }

  private makeTts(): TtsClient {
    const client = new TtsClient()
    client.onError = (message) => {
      if (DEVICE_LOST.test(message)) void this.recoverTts()
      else st().toast('error', message)
    }
    client.onLost = () => void this.recoverTts()
    return client
  }

  private makeStt(): SttClient {
    const client = new SttClient()
    client.onLost = () => void this.recoverStt()
    return client
  }

  private canRecover(kind: 'tts' | 'stt'): boolean {
    const now = Date.now()
    const recent = this.recoveries[kind].filter((at) => now - at < 5 * 60_000)
    this.recoveries[kind] = recent
    if (recent.length >= 3) return false
    this.recoveries[kind].push(now)
    return true
  }

  // The GPU can reset (sleep/wake, driver watchdog). Rebuild the engine instead of staying broken.
  private async recoverTts(): Promise<void> {
    if (this.recovering.tts || !this.booted) return
    if (!this.canRecover('tts')) return void st().toast('error', 'The voice engine keeps failing. Restart Ora or turn the voice off in Settings.')
    this.recovering.tts = true
    st().toast('info', 'The GPU was reset. Restarting the voice engine…')
    this.player.stop()
    this.ttsReady = false
    this.tts.dispose()
    this.tts = this.makeTts()
    await this.queueLoad(() => this.loadTts())
    this.recovering.tts = false
    if (this.turn) this.interrupt()
  }

  private async recoverStt(): Promise<void> {
    if (this.recovering.stt || !this.booted) return
    if (!this.canRecover('stt')) return void st().toast('error', 'Speech recognition keeps failing. Restart Ora.')
    this.recovering.stt = true
    st().toast('info', 'The GPU was reset. Restarting speech recognition…')
    this.sttReady = false
    this.stt.dispose()
    this.stt = this.makeStt()
    await this.queueLoad(() => this.loadStt())
    this.recovering.stt = false
  }

  private warnCpu(what: string): void {
    st().toast('error', `${what} is running on the CPU because the GPU couldn't be used, so it will be slow. Try Settings > Advanced > Reset GPU cache.`)
  }

  // Manual retry (Setup card / status pills) after an engine failed to start.
  async retry(): Promise<void> {
    if (this.recovering.tts || this.recovering.stt) return
    this.ttsReady = false
    this.sttReady = false
    this.tts.dispose()
    this.stt.dispose()
    this.tts = this.makeTts()
    this.stt = this.makeStt()
    await this.queueLoad(() => this.loadTts())
    await this.queueLoad(() => this.loadStt())
    if (!this.turn && st().voice === 'booting') this.setVoice('idle')
  }

  private async loadTts(): Promise<void> {
    set({ tts: { state: 'loading', stage: 'Starting', progress: 0 } })
    try {
      const info = await withTimeout(
        this.tts.init(cfg().tts.voice, (stage, progress) => set({ tts: { state: 'loading', stage, progress } })),
        120_000,
        'The voice engine took too long to start. The GPU may be busy or reset.'
      )
      this.ttsReady = true
      if (info.backend === 'wasm') this.warnCpu('Voice')
      set({ tts: { state: 'ready', stage: '', progress: 1, backend: info.backend, loadMs: info.loadMs } })
    } catch (err) {
      set({ tts: { state: 'error', stage: '', progress: 0, error: (err as Error).message } })
    }
  }

  private async loadStt(): Promise<void> {
    this.sttReady = false
    set({ stt: { state: 'loading', stage: 'Starting', progress: 0 } })
    try {
      const info = await withTimeout(
        this.stt.init(cfg().stt.model, (stage, progress) => set({ stt: { state: 'loading', stage, progress } })),
        420_000,
        'Speech recognition took too long to start (slow download or a busy GPU).'
      )
      this.sttReady = true
      if (info.backend === 'wasm') this.warnCpu('Speech recognition')
      set({ stt: { state: 'ready', stage: '', progress: 1, backend: info.backend, loadMs: info.loadMs } })
    } catch (err) {
      set({ stt: { state: 'error', stage: '', progress: 0, error: (err as Error).message } })
    }
  }

  async applySettings(prev: Settings, next: Settings): Promise<void> {
    this.player.setVolume(next.tts.volume)
    if (prev.stt.outputDeviceId !== next.stt.outputDeviceId) this.player.setSink(next.stt.outputDeviceId)
    if (prev.stt.model !== next.stt.model && this.booted) {
      this.sttReady = false
      this.stt.dispose()
      this.stt = this.makeStt()
      await this.queueLoad(() => this.loadStt())
    }
    const key = this.currentMicKey(next)
    if (this.micKey && key !== this.micKey) {
      const wasOn = st().micOn
      await this.mic.destroy()
      this.micKey = ''
      if (wasOn && next.stt.mode === 'vad') await this.setMic(true)
      else set({ micOn: false })
    }
  }

  // ---------- microphone ----------

  private currentMicKey(s: Settings): string {
    return [s.stt.micDeviceId, s.stt.mode, s.stt.vadSensitivity, s.stt.silenceMs].join('|')
  }

  private async openMic(): Promise<void> {
    const s = cfg()
    await this.mic.open({ deviceId: s.stt.micDeviceId, mode: s.stt.mode, sensitivity: s.stt.vadSensitivity, silenceMs: s.stt.silenceMs })
    this.micKey = this.currentMicKey(s)
  }

  private listeningState(): VoiceState {
    return st().micOn && cfg().stt.mode === 'vad' ? 'listening' : 'idle'
  }

  async setMic(on: boolean): Promise<void> {
    if (on) {
      if (!this.sttReady) {
        st().toast('info', 'Speech recognition is still loading. You can type in the meantime.')
        return
      }
      try {
        if (!this.micKey) await this.openMic()
        set({ micOn: true })
        if (cfg().stt.mode === 'vad') {
          await this.mic.start()
          if (!this.turn) this.setVoice('listening')
        }
      } catch (err) {
        set({ micOn: false })
        st().toast('error', `Microphone unavailable: ${(err as Error).message}`)
      }
    } else {
      set({ micOn: false })
      await this.mic.pause()
      if (!this.turn) this.setVoice('idle')
    }
  }

  async pttDown(): Promise<void> {
    if (cfg().stt.mode !== 'ptt' || !this.sttReady) return
    if (this.turn) this.interrupt()
    try {
      if (!this.micKey) await this.openMic()
      await this.mic.start()
      this.setVoice('hearing')
      set({ caption: 'Listening…' })
    } catch (err) {
      st().toast('error', `Microphone unavailable: ${(err as Error).message}`)
    }
  }

  async pttUp(): Promise<void> {
    if (cfg().stt.mode !== 'ptt') return
    await this.mic.pause()
    setTimeout(() => {
      if (st().voice === 'hearing' && !this.utteranceBusy) {
        this.setVoice('idle')
        set({ caption: '' })
      }
    }, 350)
  }

  private onSpeechStart(): void {
    const v = st().voice
    if (v === 'speaking' || v === 'thinking' || v === 'transcribing') {
      if (!cfg().stt.bargeIn) return
      this.interrupt()
    }
    this.setVoice('hearing')
    set({ caption: 'Listening…' })
  }

  private async onSpeechEnd(audio: Float32Array): Promise<void> {
    if (audio.length < 16000 * 0.3) {
      this.setVoice(this.listeningState())
      set({ caption: '' })
      return
    }
    this.utteranceBusy = true
    const endedAt = performance.now()
    this.setVoice('transcribing')
    set({ caption: 'Transcribing…' })
    try {
      const { text, ms } = await this.stt.transcribe(audio, cfg().stt.language)
      if (isNoiseTranscript(text)) {
        this.setVoice(this.listeningState())
        set({ caption: '' })
        return
      }
      await this.runTurn(text, 'voice', { sttMs: ms, startedAt: endedAt })
    } catch (err) {
      const message = (err as Error).message
      if (DEVICE_LOST.test(message)) void this.recoverStt()
      else st().toast('error', message)
      this.setVoice(this.listeningState())
      set({ caption: '' })
    } finally {
      this.utteranceBusy = false
    }
  }

  private onHotkey(): void {
    const v = st().voice
    if (v === 'speaking' || v === 'thinking') this.interrupt()
    else if (cfg().stt.mode === 'vad') void this.setMic(!st().micOn)
  }

  // ---------- state ----------

  private setVoice(v: VoiceState): void {
    if (st().voice !== v) set({ voice: v })
    this.mic.setStrict(v === 'speaking' && cfg().stt.bargeIn)
  }

  // ---------- turns ----------

  async submitText(text: string): Promise<void> {
    const t = text.trim()
    if (!t) return
    if (this.turn || st().voice === 'transcribing') this.interrupt()
    await this.runTurn(t, 'text', { startedAt: performance.now() })
  }

  private async runTurn(text: string, source: 'voice' | 'text', opts: { sttMs?: number; startedAt: number }): Promise<void> {
    if (this.turn) this.interrupt()
    const store = st()
    const history = store.active.messages.slice()
    const assistantId = crypto.randomUUID()
    store.addMessage({ id: crypto.randomUUID(), role: 'user', text, createdAt: Date.now(), source })
    store.addMessage({ id: assistantId, role: 'assistant', text: '', createdAt: Date.now(), toolCalls: [] })
    store.persist()

    const s = cfg()
    const turn: Turn = {
      assistantId,
      startedAt: opts.startedAt,
      sttMs: opts.sttMs,
      runId: null,
      sentences: new SentenceStream(s.tts.firstChunkChars, s.tts.maxChunkChars),
      pending: 0,
      agentEnded: false,
      needSpace: false,
      cancelled: false,
      buffered: '',
      flushQueued: false
    }
    this.turn = turn
    this.eventBuffer = []
    this.setVoice('thinking')
    set({ caption: '' })
    if (!s.stt.bargeIn) await this.mic.pause()
    this.player.begin(() => this.endTurn(turn))

    try {
      turn.runId = await window.ora.agent.run({ history, text })
    } catch (err) {
      this.failTurn(turn, (err as Error).message)
      return
    }
    const queued = this.eventBuffer
    this.eventBuffer = []
    for (const e of queued) this.onAgentEvent(e)
  }

  private failTurn(turn: Turn, message: string): void {
    st().mutateMessage(turn.assistantId, (m) => ({ ...m, error: message }))
    turn.agentEnded = true
    this.maybeFinish(turn)
  }

  private patchTool(callId: string, name: string, fn: (t: ToolCallRecord) => ToolCallRecord): void {
    const turn = this.turn
    if (!turn) return
    st().mutateMessage(turn.assistantId, (m) => {
      const calls = [...(m.toolCalls ?? [])]
      let idx = calls.findIndex((c) => c.callId === callId)
      if (idx < 0) idx = calls.map((c, i) => ({ c, i })).reverse().find(({ c }) => c.name === name && (c.status === 'running' || c.status === 'awaiting_approval'))?.i ?? -1
      if (idx >= 0) calls[idx] = fn(calls[idx])
      return { ...m, toolCalls: calls }
    })
  }

  private appendText(turn: Turn, chunk: string): void {
    turn.buffered += chunk
    if (turn.flushQueued) return
    turn.flushQueued = true
    requestAnimationFrame(() => {
      turn.flushQueued = false
      const add = turn.buffered
      turn.buffered = ''
      if (add) st().mutateMessage(turn.assistantId, (m) => ({ ...m, text: m.text + add }))
    })
  }

  private flushText(turn: Turn): void {
    const add = turn.buffered
    turn.buffered = ''
    if (add) st().mutateMessage(turn.assistantId, (m) => ({ ...m, text: m.text + add }))
  }

  private onAgentEvent(e: AgentEvent): void {
    const turn = this.turn
    if (!turn) return
    if (!turn.runId) {
      this.eventBuffer.push(e)
      return
    }
    if (e.runId !== turn.runId) return

    switch (e.type) {
      case 'token': {
        const chunk = (turn.needSpace ? ' ' : '') + e.text
        turn.needSpace = false
        this.appendText(turn, chunk)
        for (const sentence of turn.sentences.push(chunk)) this.speak(turn, sentence)
        break
      }
      case 'tool_start': {
        turn.needSpace = true
        for (const sentence of turn.sentences.flush()) this.speak(turn, sentence)
        const call: ToolCallRecord = { callId: e.callId, name: e.name, args: e.args, status: 'running' }
        st().mutateMessage(turn.assistantId, (m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), call] }))
        break
      }
      case 'tool_approval': {
        this.patchTool('', e.name, (t) => ({ ...t, status: 'awaiting_approval' }))
        set({ approvals: [...st().approvals, { approvalId: e.approvalId, runId: e.runId, name: e.name, args: e.args, summary: e.summary }] })
        this.speak(turn, `I need your OK to ${e.summary.charAt(0).toLowerCase()}${e.summary.slice(1)}.`)
        break
      }
      case 'tool_end': {
        turn.needSpace = true
        this.patchTool(e.callId, e.name, (t) => (t.status === 'denied' ? t : { ...t, status: e.ok ? 'done' : 'error', result: e.result, ok: e.ok, ms: e.ms }))
        break
      }
      case 'done': {
        turn.firstTokenMs = e.firstTokenMs
        for (const sentence of turn.sentences.flush()) this.speak(turn, sentence)
        this.flushText(turn)
        turn.agentEnded = true
        this.maybeFinish(turn)
        break
      }
      case 'error': {
        this.flushText(turn)
        st().mutateMessage(turn.assistantId, (m) => ({ ...m, error: e.message }))
        st().toast('error', e.message)
        this.speak(turn, e.message)
        turn.agentEnded = true
        this.maybeFinish(turn)
        break
      }
      case 'cancelled': {
        turn.agentEnded = true
        this.maybeFinish(turn)
        break
      }
    }
  }

  // ---------- speech output ----------

  private speak(turn: Turn, sentence: string): void {
    const s = cfg()
    if (!s.tts.enabled || !this.ttsReady || turn.cancelled) return
    turn.pending++
    if (s.ui.liveCaptions) set({ caption: sentence })
    const handle = this.tts.synth(
      sentence,
      { voice: s.tts.voice, lang: s.tts.language, steps: s.tts.steps, speed: s.tts.speed, maxChunk: s.tts.maxChunkChars },
      (audio, sampleRate) => {
        if (this.turn !== turn || turn.cancelled) return
        if (turn.firstAudioAt === undefined) turn.firstAudioAt = performance.now()
        if (st().voice !== 'speaking') this.setVoice('speaking')
        this.player.enqueue(audio, sampleRate)
      }
    )
    void handle.done.then(() => {
      turn.pending--
      this.maybeFinish(turn)
    })
  }

  private maybeFinish(turn: Turn): void {
    if (this.turn !== turn || turn.cancelled) return
    if (turn.agentEnded && turn.pending === 0) this.player.finish()
  }

  private endTurn(turn: Turn): void {
    if (this.turn !== turn) return
    this.turn = null
    this.flushText(turn)
    const metrics = {
      sttMs: turn.sttMs,
      firstTokenMs: turn.firstTokenMs,
      firstAudioMs: turn.firstAudioAt ? Math.round(turn.firstAudioAt - turn.startedAt) : undefined,
      totalMs: Math.round(performance.now() - turn.startedAt)
    }
    st().mutateMessage(turn.assistantId, (m) => ({ ...m, metrics }))
    set({ caption: '' })
    st().persist(true)
    if (st().micOn && cfg().stt.mode === 'vad') {
      void this.mic.start()
      this.setVoice('listening')
    } else {
      this.setVoice('idle')
    }
  }

  interrupt(): void {
    const turn = this.turn
    this.player.stop()
    this.tts.cancelAll()
    levels.out = 0
    if (turn) {
      turn.cancelled = true
      if (turn.runId) void window.ora.agent.cancel(turn.runId)
      this.flushText(turn)
      st().mutateMessage(turn.assistantId, (m) => ({ ...m, interrupted: m.text.trim().length > 0 }))
      set({ approvals: st().approvals.filter((a) => a.runId !== turn.runId) })
      this.turn = null
      st().persist(true)
    }
    set({ caption: '' })
    if (st().micOn && cfg().stt.mode === 'vad') {
      void this.mic.start()
      this.setVoice('listening')
    } else {
      this.setVoice('idle')
    }
  }

  resolveApproval(approvalId: string, ok: boolean): void {
    const a = st().approvals.find((x) => x.approvalId === approvalId)
    void window.ora.agent.approve(approvalId, ok)
    set({ approvals: st().approvals.filter((x) => x.approvalId !== approvalId) })
    if (a) this.patchTool('', a.name, (t) => ({ ...t, status: ok ? 'running' : 'denied' }))
  }

  // Speaks arbitrary text (message replay, timer alerts) without involving the agent.
  async say(text: string, messageId = ''): Promise<void> {
    if (!cfg().tts.enabled || !this.ttsReady) return
    if (this.turn) this.interrupt()
    const stream = new SentenceStream(cfg().tts.firstChunkChars, cfg().tts.maxChunkChars)
    const turn: Turn = {
      assistantId: messageId,
      startedAt: performance.now(),
      runId: 'local',
      sentences: stream,
      pending: 0,
      agentEnded: true,
      needSpace: false,
      cancelled: false,
      buffered: '',
      flushQueued: false
    }
    this.turn = turn
    if (!cfg().stt.bargeIn) await this.mic.pause()
    this.player.begin(() => this.endTurn(turn))
    for (const sentence of [...stream.push(text + ' '), ...stream.flush()]) this.speak(turn, sentence)
    this.maybeFinish(turn)
  }
}

export const voice = new VoiceController()
