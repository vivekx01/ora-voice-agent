// End-to-end agent test in real Electron using a mock OpenAI-compatible server.
// Covers: streaming + tool call, approval allow/deny, interruption, and a full voice turn
// (Supertonic speech -> Whisper -> agent -> Supertonic).
// Usage: npm run build && node test/agent.mjs
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
const sandbox = mkdtempSync(join(os.tmpdir(), 'ora-sandbox-'))
const modelsDir = findModelsDir()

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const mock = await startMockLlm()
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', ORA_USER_DATA: userData, ORA_MODELS_DIR: modelsDir, ORA_LLM_BASE_URL: `http://127.0.0.1:${mock.port}`, OPENROUTER_API_KEY: 'test-key' }
})
const page = await app.firstWindow()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/onnxruntime|Autofill/.test(m.text()) && pageErrors.push(m.text().slice(0, 200)))
await page.goto('ora://app/index.html?debug=1')
await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })

console.log('waiting for speech engines (first run downloads the Whisper model)…')
await page.waitForFunction(() => { const s = window.__ora.store.getState(); return s.tts.state === 'ready' && s.stt.state === 'ready' }, null, { timeout: 300000 })
await page.evaluate((dir) => window.__ora.store.getState().updateSettings({ tts: { volume: 0 }, tools: { sandboxDir: dir }, general: { globalHotkey: '' }, ui: { theme: 'dark' } }), sandbox)
await page.evaluate(() => window.__ora.store.getState().set({ sidebarOpen: true }))

const state = () => page.evaluate(() => { const s = window.__ora.store.getState(); return { voice: s.voice, messages: s.active.messages, approvals: s.approvals, tts: s.tts, stt: s.stt } })
const waitIdle = (timeout = 90000) => page.waitForFunction(() => { const s = window.__ora.store.getState(); return s.voice === 'idle' && s.active.messages.length > 0 && s.active.messages.at(-1).role === 'assistant' }, null, { timeout })
const send = (text) => page.evaluate((t) => window.__ora.voice.submitText(t), text)

console.log('\n[A] text turn with a tool call (streamed tokens -> tool -> answer)')
await send("What's the weather like in Mumbai?")
await waitIdle()
let s = await state()
let a = s.messages.at(-1)
check('assistant produced text', a.text.length > 20, a.text.slice(0, 70))
check('tool call recorded', a.toolCalls?.length === 1 && a.toolCalls[0].name === 'get_weather', JSON.stringify(a.toolCalls?.map((t) => `${t.name}:${t.status}`)))
check('tool ran successfully', a.toolCalls?.[0]?.status === 'done' && /Mumbai/i.test(a.toolCalls[0].result ?? ''), (a.toolCalls?.[0]?.result ?? '').slice(0, 80).replace(/\n/g, ' '))
check('speech started (first audio measured)', typeof a.metrics?.firstAudioMs === 'number', `${a.metrics?.firstAudioMs}ms`)
check('space kept between tool steps', /for you\.\s+It looks/.test(a.text), a.text.slice(0, 60))
const req0 = mock.requests[0]
check('request targets configured model', req0.model === 'anthropic/claude-haiku-4.5', req0.model)
check('OpenRouter provider routing sent', req0.provider?.sort === 'latency', JSON.stringify(req0.provider))
check('tools exposed to the model', (req0.tools?.length ?? 0) >= 8, `${req0.tools?.length} tools`)
check('system prompt is voice-oriented', /spoken aloud/.test(req0.messages[0].content ?? ''), '')
await page.screenshot({ path: join(shots, 'chat-tool-turn.png') })

console.log('\n[B] approval flow: Allow')
await send('Please save a note for me')
await page.waitForFunction(() => window.__ora.store.getState().approvals.length === 1, null, { timeout: 30000 })
await page.waitForTimeout(400)
await page.screenshot({ path: join(shots, 'chat-approval.png') })
check('approval prompt shown', (await state()).approvals[0]?.name === 'write_file', (await state()).approvals[0]?.summary)
check('file not written before approval', !existsSync(join(sandbox, 'hello.txt')))
await page.click('.approve-bar .btn.primary')
await waitIdle()
s = await state()
check('file written after Allow', existsSync(join(sandbox, 'hello.txt')) && readFileSync(join(sandbox, 'hello.txt'), 'utf8') === 'hi from ora')
check('tool marked done', s.messages.at(-1).toolCalls?.[0]?.status === 'done', s.messages.at(-1).toolCalls?.[0]?.status)

console.log('\n[B2] approval flow: Deny')
rmSync(join(sandbox, 'hello.txt'))
await send('Please save a note again')
await page.waitForFunction(() => window.__ora.store.getState().approvals.length === 1, null, { timeout: 30000 })
await page.click('.approve-bar .btn:not(.primary)')
await waitIdle()
s = await state()
check('file NOT written after Deny', !existsSync(join(sandbox, 'hello.txt')))
check('tool marked declined', s.messages.at(-1).toolCalls?.[0]?.status === 'denied', s.messages.at(-1).toolCalls?.[0]?.status)

console.log('\n[C] interruption while speaking')
await send('Tell me a story')
await page.waitForFunction(() => window.__ora.store.getState().voice === 'speaking', null, { timeout: 60000 })
await page.evaluate(() => window.__ora.voice.interrupt())
await page.waitForFunction(() => window.__ora.store.getState().voice === 'idle', null, { timeout: 5000 })
s = await state()
a = s.messages.at(-1)
check('reply marked interrupted', a.interrupted === true, `${a.text.length} chars kept`)
check('stopped mid-story', a.text.length > 10 && !a.text.includes('everyone joined in'), a.text.slice(-40))

console.log('\n[D] full voice turn: TTS -> resample -> Whisper -> agent -> TTS')
const spoken = await page.evaluate(async () => {
  const { TtsClient, voice, store } = window.__ora
  const tts = new TtsClient()
  await tts.init('M1', () => {})
  const parts = []
  await tts.synth("What's the weather like in Mumbai?", { voice: 'M1', lang: 'en', steps: 8, speed: 1, maxChunk: 200 }, (audio, sr) => parts.push({ audio, sr })).done
  const total = parts.reduce((n, p) => n + p.audio.length, 0)
  const pcm = new Float32Array(total)
  let o = 0
  for (const p of parts) { pcm.set(p.audio, o); o += p.audio.length }
  const sr = parts[0].sr
  const ctx = new OfflineAudioContext(1, Math.ceil((pcm.length * 16000) / sr), 16000)
  const buf = ctx.createBuffer(1, pcm.length, sr)
  buf.copyToChannel(pcm, 0)
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start()
  const audio = (await ctx.startRendering()).getChannelData(0).slice()
  await voice.onSpeechEnd(audio)
  return audio.length / 16000
})
await waitIdle()
s = await state()
const user = s.messages.at(-2)
a = s.messages.at(-1)
check('heard the utterance', user.role === 'user' && /weather/i.test(user.text) && /mumbai/i.test(user.text), `"${user.text}"`)
check('marked as voice input', user.source === 'voice')
check('agent used the weather tool from the voice request', a.toolCalls?.[0]?.name === 'get_weather')
check('latency metrics captured', a.metrics?.sttMs > 0 && a.metrics?.firstAudioMs > 0, JSON.stringify(a.metrics))
await page.screenshot({ path: join(shots, 'chat-voice-turn.png') })

console.log('\n[E] persistence')
await page.waitForTimeout(800)
check('settings saved to disk', existsSync(join(userData, 'settings.json')) && JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).tts.volume === 0)
check('conversation saved to disk', existsSync(join(userData, 'conversations')))

console.log('\npage errors:', pageErrors.length ? pageErrors : 'none')
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
await app.close()
mock.close()
rmSync(sandbox, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
