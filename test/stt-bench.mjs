// Compares Whisper models on this machine by switching the model through the app's own settings,
// which also exercises the "change speech model" path users will use.
import { createRequire } from 'node:module'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { findModelsDir } from './paths.mjs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.ORA_TEST_DIR || join(os.tmpdir(), 'ora-e2e')
const userData = join(out, 'userdata'); mkdirSync(userData, { recursive: true })
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', ORA_USER_DATA: userData, ORA_MODELS_DIR: findModelsDir() } })
const page = await app.firstWindow()
await page.goto('ora://app/index.html?debug=1')
await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })
await page.waitForFunction(() => { const s = window.__ora.store.getState(); return s.tts.state === 'ready' && s.stt.state === 'ready' }, null, { timeout: 300000 })

const phrases = ["What's the weather like in Mumbai today?", 'Set a timer for five minutes for the tea.', 'Remind me to call my mother when I get home.']
await page.evaluate(async (phrases) => {
  const { voice } = window.__ora
  window.__clips = []
  for (const text of phrases) {
    const parts = []
    await voice.tts.synth(text, { voice: 'M1', lang: 'en', steps: 8, speed: 1, maxChunk: 200 }, (a, sr) => parts.push({ a, sr })).done
    const sr = parts[0].sr, n = parts.reduce((k, p) => k + p.a.length, 0), pcm = new Float32Array(n); let o = 0
    for (const p of parts) { pcm.set(p.a, o); o += p.a.length }
    const ctx = new OfflineAudioContext(1, Math.ceil(n * 16000 / sr), 16000), b = ctx.createBuffer(1, n, sr); b.copyToChannel(pcm, 0)
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start()
    window.__clips.push({ text, audio: (await ctx.startRendering()).getChannelData(0).slice() })
  }
}, phrases)

const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
for (const model of ['onnx-community/whisper-tiny.en', 'onnx-community/whisper-base.en', 'onnx-community/whisper-small.en']) {
  const t0 = Date.now()
  await page.evaluate((m) => window.__ora.store.getState().updateSettings({ stt: { model: m } }), model)
  await page.waitForFunction((m) => { const s = window.__ora.store.getState(); return s.settings.stt.model === m && s.stt.state === 'ready' }, model, { timeout: 300000 })
  const loadS = ((Date.now() - t0) / 1000).toFixed(1)
  const runs = await page.evaluate(async () => {
    const out = []
    for (const c of window.__clips) {
      await window.__ora.voice.stt.transcribe(c.audio.slice(), 'en') // warm
      const r = await window.__ora.voice.stt.transcribe(c.audio.slice(), 'en')
      out.push({ ms: r.ms, want: c.text, got: r.text, secs: +(c.audio.length / 16000).toFixed(1) })
    }
    return out
  })
  const avg = Math.round(runs.reduce((a, b) => a + b.ms, 0) / runs.length)
  console.log(`\n${model}: switched+loaded in ${loadS}s, avg transcribe ${avg}ms`)
  for (const x of runs) console.log(`  ${String(x.ms).padStart(5)}ms  ${x.secs}s audio  ${norm(x.want) === norm(x.got) ? 'exact' : 'DIFF '}  "${x.got}"`)
}
await app.close()
