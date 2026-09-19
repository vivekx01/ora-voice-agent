// Real microphone path, using Chromium's fake capture device fed from a WAV file:
//   mic -> Silero VAD -> Whisper -> agent -> Supertonic
// Scenarios: hands-free (with and without interrupt-by-speaking) and push-to-talk.
// Usage: npm run build && node test/mic.mjs
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { findModelsDir } from './paths.mjs'
import { startMockLlm } from './mock-llm.mjs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shots = process.env.ORA_TEST_DIR || join(os.tmpdir(), 'ora-e2e')
const userData = join(shots, 'userdata')
mkdirSync(userData, { recursive: true })
const modelsDir = findModelsDir()
const wavPath = join(shots, 'fake-mic.wav')
const mock = await startMockLlm()
const baseEnv = { ...process.env, NODE_ENV: 'production', ORA_USER_DATA: userData, ORA_MODELS_DIR: modelsDir, ORA_LLM_BASE_URL: `http://127.0.0.1:${mock.port}`, OPENROUTER_API_KEY: 'test-key' }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

async function launch(extraArgs = []) {
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', ...extraArgs], cwd: root, env: baseEnv })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
  await page.goto('ora://app/index.html?debug=1')
  await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })
  await page.waitForFunction(() => { const s = window.__ora.store.getState(); return s.tts.state === 'ready' && s.stt.state === 'ready' }, null, { timeout: 300000 })
  return { app, page }
}

const FAKE_MIC = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}%noloop`]

async function recordFakeMic() {
  const { app, page } = await launch()
  const out = await page.evaluate(async () => {
    const { TtsClient } = window.__ora
    const tts = new TtsClient()
    await tts.init('M1', () => {})
    const parts = []
    await tts.synth("What's the weather like in Mumbai?", { voice: 'M1', lang: 'en', steps: 8, speed: 1, maxChunk: 200 }, (a, sr) => parts.push({ a, sr })).done
    const sr = parts[0].sr
    const speech = parts.flatMap((p) => Array.from(p.a))
    const all = new Int16Array([...new Array(Math.round(sr * 1.4)).fill(0), ...speech, ...new Array(Math.round(sr * 7)).fill(0)].map((v) => Math.max(-1, Math.min(1, v)) * 32767))
    const bytes = new Uint8Array(all.buffer)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { b64: btoa(bin), sr }
  })
  const pcm = Buffer.from(out.b64, 'base64')
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(out.sr, 24); h.writeUInt32LE(out.sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  writeFileSync(wavPath, Buffer.concat([h, pcm]))
  console.log(`  wrote fake microphone recording (${(pcm.length / out.sr / 2).toFixed(1)}s)`)
  await app.close()
}

async function scenario(title, settings, drive) {
  console.log(`\n${title}`)
  const { app, page } = await launch(FAKE_MIC)
  await page.evaluate((s) => window.__ora.store.getState().updateSettings({ tts: { volume: 0 }, general: { globalHotkey: '' }, ui: { theme: 'dark' }, ...s }), settings)
  await page.evaluate(() => {
    window.__states = []
    window.__ora.store.subscribe((s, prev) => { if (s.voice !== prev.voice) window.__states.push(s.voice) })
  })
  await drive(page)
  await page.waitForFunction(() => window.__ora.store.getState().active.messages.some((m) => m.role === 'user'), null, { timeout: 60000 })
  const finalState = settings.stt.mode === 'ptt' ? 'idle' : 'listening'
  await page.waitForFunction((f) => { const s = window.__ora.store.getState(); return s.active.messages.at(-1)?.role === 'assistant' && s.voice === f }, finalState, { timeout: 90000 })
  const r = await page.evaluate(() => ({ states: window.__states, messages: window.__ora.store.getState().active.messages }))
  const user = r.messages.find((m) => m.role === 'user')
  const asst = r.messages.at(-1)
  console.log('  states:', r.states.join(' > '))
  check('heard the speech (hearing state)', r.states.includes('hearing'))
  check('transcribed correctly', /weather/i.test(user.text) && /mumbai/i.test(user.text), `"${user.text}"`)
  check('transcribing > thinking > speaking', ['transcribing', 'thinking', 'speaking'].every((s) => r.states.includes(s)))
  check('agent answered with the weather tool', asst.toolCalls?.[0]?.name === 'get_weather' && asst.text.length > 20)
  check(`ended in "${finalState}" state`, r.states.at(-1) === finalState, r.states.at(-1))
  check('latency metrics recorded', asst.metrics?.sttMs > 0 && asst.metrics?.firstAudioMs > 0, JSON.stringify(asst.metrics))
  await page.evaluate(() => window.__ora.voice.setMic(false))
  await app.close()
}

console.log('[0] recording a spoken question with Supertonic to use as the fake microphone')
await recordFakeMic()

await scenario('[1] hands-free, interrupt-by-speaking ON', { stt: { mode: 'vad', bargeIn: true } }, async (page) => {
  await page.evaluate(() => window.__ora.voice.setMic(true))
  await page.waitForTimeout(500)
  check('mic opened and VAD listening', (await page.evaluate(() => window.__ora.store.getState().micOn)) === true)
  await page.screenshot({ path: join(shots, 'mic-listening.png') })
})

await scenario('[2] hands-free, interrupt-by-speaking OFF (mic pauses while the assistant talks)', { stt: { mode: 'vad', bargeIn: false } }, async (page) => {
  await page.evaluate(() => window.__ora.voice.setMic(true))
})

await scenario('[3] push-to-talk: hold, speak, release', { stt: { mode: 'ptt', bargeIn: true } }, async (page) => {
  await page.evaluate(() => window.__ora.voice.pttDown())
  await page.waitForTimeout(5500)
  await page.evaluate(() => window.__ora.voice.pttUp())
})

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
mock.close()
process.exit(failures ? 1 : 0)
