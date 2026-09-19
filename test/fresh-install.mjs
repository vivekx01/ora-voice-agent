// What a brand-new user experiences: no voice files on disk. The app must download Supertonic from
// Hugging Face, then load it and speak. Uses temp folders only (never your real data).
// Usage: npm run build && node test/fresh-install.mjs
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(os.tmpdir(), 'ora-fresh-'))
const userData = join(tmp, 'userdata'), models = join(tmp, 'models')
let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }

const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', ORA_USER_DATA: userData, ORA_MODELS_DIR: models, OPENROUTER_API_KEY: 'x' } })
const page = await app.firstWindow()
await page.goto('ora://app/index.html?debug=1')
await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })

const before = await page.evaluate(() => window.ora.models.status())
check('starts with NO voice files (fresh user)', !before.ready && before.missing.length === 16, `${before.missing.length} files missing`)
await page.waitForTimeout(800)
console.log('  first-run screen shows the download step:', await page.locator('.step').first().innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 90)))

console.log('  downloading Supertonic from Hugging Face…')
const t0 = Date.now()
let last = 0
await page.evaluate(() => { window.__lastProgress = null; window.ora.models.onProgress((p) => (window.__lastProgress = p)) })
const dl = page.evaluate(() => window.ora.models.download())
const poll = setInterval(async () => { const p = await page.evaluate(() => window.__lastProgress).catch(() => null); if (p && p.overallTotal && Date.now() - last > 15000) { last = Date.now(); console.log(`    ${(p.overallReceived / 1048576).toFixed(0)} / ${(p.overallTotal / 1048576).toFixed(0)} MB`) } }, 3000)
const result = await dl
clearInterval(poll)
check('download finished without error', result.ok, result.error ?? `${((Date.now() - t0) / 1000).toFixed(0)}s`)

const after = await page.evaluate(() => window.ora.models.status())
check('all voice files now on disk', after.ready)
const size = (f) => statSync(join(models, 'supertonic-3', f)).size
check('model weights are the expected sizes', size('onnx/vector_estimator.onnx') === 256534781 && size('onnx/vocoder.onnx') === 101424195 && size('onnx/text_encoder.onnx') === 36416150 && size('onnx/duration_predictor.onnx') === 3700147, 'matches the published files byte for byte')
check('no partial .part files left behind', !readdirSync(join(models, 'supertonic-3', 'onnx')).some((f) => f.endsWith('.part')))

console.log('  loading the freshly downloaded voice and speaking…')
const spoke = await page.evaluate(async () => {
  const { TtsClient } = window.__ora
  const tts = new TtsClient()
  const info = await tts.init('F1', () => {})
  let samples = 0
  await tts.synth('Hello, I am running from freshly downloaded files.', { voice: 'F1', lang: 'en', steps: 8, speed: 1, maxChunk: 200 }, (a) => (samples += a.length)).done
  return { backend: info.backend, seconds: +(samples / info.sampleRate).toFixed(1) }
})
check('Supertonic loads and speaks from the downloaded files', spoke.seconds > 1.5, `${spoke.seconds}s of audio on ${spoke.backend}`)

await app.close()
rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
