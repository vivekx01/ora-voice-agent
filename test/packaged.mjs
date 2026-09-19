// Smoke test for the PACKAGED app (what users actually run): launches the built .exe and checks that it
// starts, serves its own files from inside the archive, loads both speech engines, embeds the icon,
// and completes an agent turn with every tool loaded.
// Usage: npm run dist:dir && node test/packaged.mjs [path/to/Ora.exe]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { startMockLlm } from './mock-llm.mjs'
import { findModelsDir } from './paths.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exe = resolve(process.argv[2] ?? join(root, 'dist', 'win-unpacked', 'Ora.exe'))
if (!existsSync(exe)) {
  console.error(`Not found: ${exe}\nBuild first with: npm run dist:dir`)
  process.exit(2)
}
const out = process.env.ORA_TEST_DIR || join(os.tmpdir(), 'ora-e2e')
mkdirSync(out, { recursive: true })
const userData = mkdtempSync(join(os.tmpdir(), 'ora-packaged-'))
let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }

console.log(`Testing ${exe}`)

// The icon embedded in the .exe itself (what Explorer and the taskbar pin show).
const iconFile = join(out, 'exe-icon.png').replace(/\\/g, '\\\\')
const exeIcon = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type -AssemblyName System.Drawing
$i = [System.Drawing.Icon]::ExtractAssociatedIcon('${exe.replace(/'/g, "''")}')
$b = $i.ToBitmap(); $b.Save('${iconFile}', [System.Drawing.Imaging.ImageFormat]::Png)
$c = $b.GetPixel([int]($b.Width/2), [int]($b.Height/2)); Write-Output ("RGB=" + $c.R + "," + $c.G + "," + $c.B)`], { encoding: 'utf8' }).trim()
const rgb = exeIcon.match(/RGB=(\d+),(\d+),(\d+)/)?.slice(1).map(Number)
check('the .exe file carries the Ora orb icon (not the default Electron one)', Boolean(rgb) && rgb[2] > rgb[0] && rgb[2] > rgb[1] && rgb[2] > 120, exeIcon)

const mock = await startMockLlm()
const env = { ...process.env, ORA_USER_DATA: userData, ORA_MODELS_DIR: findModelsDir(), ORA_LLM_BASE_URL: `http://127.0.0.1:${mock.port}` }
for (const k of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']) delete env[k]
delete env.NODE_ENV
const app = await electron.launch({ executablePath: exe, args: [], env })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/onnxruntime|Autofill/.test(m.text()) && errors.push(m.text().slice(0, 200)))

check('runs as a packaged app', await app.evaluate(({ app }) => app.isPackaged) === true)
await page.waitForSelector('.brand-mark', { timeout: 30000 })
check('the interface loads from inside the archive (ora:// protocol)', (await page.evaluate(() => location.href)).startsWith('ora://app/'), await page.evaluate(() => location.href))
const visible = async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
for (let i = 0; i < 40 && !(await visible()); i++) await new Promise((r) => setTimeout(r, 250))
check('the window is shown', await visible())

// Debug hook is only exposed with ?debug, so reload the page with it for the checks below.
await page.goto('ora://app/index.html?debug=1')
await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })
await page.waitForFunction(() => { const s = window.__ora.store.getState(); return s.tts.state === 'ready' && s.stt.state === 'ready' }, null, { timeout: 300000 })
const engines = await page.evaluate(() => { const s = window.__ora.store.getState(); return { tts: s.tts.backend, stt: s.stt.backend, ttsMs: s.tts.loadMs, sttMs: s.stt.loadMs } })
check('Supertonic and Whisper load from the packaged files', engines.tts && engines.stt, `voice on ${engines.tts} in ${engines.ttsMs}ms, hearing on ${engines.stt} in ${engines.sttMs}ms`)

await page.evaluate(async () => {
  const s = window.__ora.store.getState()
  await s.setApiKey('openrouter', 'good-key')
  await s.updateSettings({ general: { globalHotkey: '' }, tts: { volume: 0 } })
})
await page.evaluate(() => window.__ora.voice.submitText("What's the weather like in Mumbai?"))
await page.waitForFunction(() => { const s = window.__ora.store.getState(); const m = s.active.messages.at(-1); return m?.role === 'assistant' && s.voice === 'idle' }, null, { timeout: 90000 })
const turn = await page.evaluate(() => window.__ora.store.getState().active.messages.at(-1))
check('an agent turn works end to end (model, tool call, spoken answer)', turn.text.length > 20 && turn.toolCalls?.[0]?.status === 'done' && !turn.error, turn.error ?? turn.text.slice(0, 50))
const toolCount = mock.requests[0]?.tools?.length ?? 0
check('every tool loaded, including the LangChain community ones', toolCount === 15, `${toolCount} of 15 tools reached the model`)
check('first word was spoken (playback path works)', typeof turn.metrics?.firstAudioMs === 'number', `${turn.metrics?.firstAudioMs}ms`)
await page.screenshot({ path: join(out, 'packaged-app.png') })
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))

await app.close()
mock.close()
rmSync(userData, { recursive: true, force: true })
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
