// Captures the README screenshots into docs/screenshots. Uses an isolated profile, seeded demo
// conversations and a mock LLM for the approval card, so nothing personal ends up in the images.
// Each group of shots runs in its own app launch, so one failure cannot lose the rest.
// Usage: npm run build && node test/readme-shots.mjs [group ...]     groups: main orbs approval
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { startMockLlm } from './mock-llm.mjs'
import { findModelsDir } from './paths.mjs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs', 'screenshots')
mkdirSync(outDir, { recursive: true })
const wanted = process.argv.slice(2)

// ---------- demo conversations, seeded into the profile so the sidebar looks lived-in ----------

const DAY = 86_400_000
const now = Date.now()
let n = 0
const id = () => `demo-${++n}-0000-4000-8000-000000000000`
const msg = (role, text, extra = {}) => ({ id: id(), role, text, createdAt: now, ...extra })
const tool = (name, args, result, ms) => ({ callId: id(), name, args, result, ok: true, ms, status: 'done' })

const weather = {
  id: id(), title: "What's the weather like in Mumbai today?", createdAt: now, updatedAt: now,
  messages: [
    msg('user', "What's the weather like in Mumbai today?", { source: 'voice' }),
    msg('assistant', "It's about 29 degrees in Mumbai and mostly clear, though it feels closer to 33 with the humidity. No rain is expected today, so you can leave the umbrella at home.", {
      toolCalls: [tool('get_weather', { location: 'Mumbai' }, 'Weather for Mumbai, Maharashtra, India. Now: mainly clear, 29°C (feels like 33°C), humidity 71%, wind 14 km/h.', 1200)],
      metrics: { sttMs: 1180, firstTokenMs: 410, firstAudioMs: 2050, totalMs: 9400 }
    }),
    msg('user', 'Set a timer for five minutes for the tea.', { source: 'voice' }),
    msg('assistant', "Done. I'll let you know in five minutes when your tea is ready.", {
      toolCalls: [tool('set_timer', { seconds: 300, label: 'Tea' }, 'Timer set for 300 seconds (Tea).', 20)],
      metrics: { sttMs: 1090, firstTokenMs: 380, firstAudioMs: 1900, totalMs: 4200 }
    })
  ]
}
const others = [
  ['Explain how noise cancelling headphones work', 'Noise cancelling headphones listen to the sound around you with tiny microphones, then play a mirrored wave that cancels it out.', 0.2],
  ['Plan a three day trip to Goa', 'Day one, start with the beaches in North Goa. Day two is Old Goa and the spice farms, and day three is a lazy morning before your flight.', 1],
  ['Summarise this article for me', 'The article argues that small, on-device models are now good enough for most everyday assistant tasks, and that privacy is the main reason to run them locally.', 3],
  ['Remember that I prefer Celsius', "Got it. I'll use Celsius whenever I talk about temperatures.", 8]
].map(([title, reply, daysAgo]) => ({
  id: id(), title, createdAt: now - daysAgo * DAY, updatedAt: now - daysAgo * DAY,
  messages: [msg('user', title, { source: 'voice' }), msg('assistant', reply)]
}))

function seed(userData) {
  const dir = join(userData, 'conversations')
  mkdirSync(dir, { recursive: true })
  for (const c of [weather, ...others]) writeFileSync(join(dir, `${c.id}.json`), JSON.stringify(c))
}

// ---------- app helpers ----------

async function launch(env = {}) {
  // ORA_DOCS_PROFILE keeps one profile between runs so the GPU shader cache is warm (a cold start shows a slow load time).
  const userData = process.env.ORA_DOCS_PROFILE ?? mkdtempSync(join(os.tmpdir(), 'ora-docs-'))
  seed(userData)
  const base = { ...process.env, NODE_ENV: 'production', ORA_USER_DATA: userData, ORA_MODELS_DIR: findModelsDir(), ...env }
  for (const k of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']) delete base[k]
  const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env: base })
  const child = app.process()
  child.on('exit', (code, sig) => console.log(`  !! Electron exited (code ${code}, signal ${sig})`))
  const page = await app.firstWindow()
  page.on('crash', () => console.log('  !! renderer crashed'))
  page.on('pageerror', (e) => console.log('  !! page error:', e.message.slice(0, 160)))
  await page.goto('ora://app/index.html?debug=1')
  await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })
  await page.waitForFunction(() => { const s = window.__ora.store.getState(); return s.tts.state === 'ready' && s.stt.state === 'ready' }, null, { timeout: 300000 })
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1280, 800); w.center() })
  await page.evaluate(async () => {
    const s = window.__ora.store.getState()
    await s.setApiKey('openrouter', 'sk-or-v1-demo-key-not-real')
    await s.refreshConversations()
    // A neutral path so the screenshot does not show a real user name.
    await s.updateSettings({ general: { globalHotkey: '' }, tts: { volume: 0 }, ui: { theme: 'dark' }, tools: { sandboxDir: 'C:\\Users\\you\\Documents\\Ora' } })
  })
  await page.waitForTimeout(900)
  return { app, page, userData }
}

const act = (page, fn, arg) => page.evaluate(fn, arg)
const wait = (page, ms) => page.waitForTimeout(ms)
const shot = async (page, name, target) => {
  await (target ?? page).screenshot({ path: join(outDir, `${name}.png`) })
  console.log('  saved', `${name}.png`)
}
const newChat = async (page) => { await act(page, () => window.__ora.store.getState().newChat()); await wait(page, 600) }
const openConversation = async (page, cid) => { await act(page, (i) => window.__ora.store.getState().openConversation(i), cid); await wait(page, 800); await act(page, () => { document.querySelector('.chat-scroll').scrollTop = 0 }); await wait(page, 300) }
const openTab = async (page, tab) => { await act(page, (t) => window.__ora.store.getState().openSettings(t), tab) }
const setTheme = async (page, theme) => { await act(page, (t) => window.__ora.store.getState().updateSettings({ ui: { theme: t } }), theme); await wait(page, 700) }

async function group(name, env, fn) {
  if (wanted.length && !wanted.includes(name)) return
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`\n[${name}]${attempt > 1 ? ' (retry)' : ''}`)
    let ctx
    try {
      ctx = await launch(env?.())
      await fn(ctx)
      await ctx.app.close().catch(() => {})
      if (!process.env.ORA_DOCS_PROFILE) rmSync(ctx.userData, { recursive: true, force: true })
      return
    } catch (err) {
      console.log('  failed:', String(err.message ?? err).split('\n')[0])
      await ctx?.app.close().catch(() => {})
    }
  }
}

// ---------- the shots ----------

await group('main', null, async ({ page }) => {
  await newChat(page)
  await shot(page, 'home')
  await openConversation(page, weather.id)
  await shot(page, 'hero')

  for (const tab of ['model', 'voice', 'listening', 'tools']) {
    await openTab(page, tab)
    await wait(page, tab === 'model' ? 3000 : 800)
    await shot(page, `settings-${tab}`)
  }
  await act(page, () => window.__ora.store.getState().set({ settingsOpen: false }))
  await wait(page, 500)

  await setTheme(page, 'light')
  await openConversation(page, weather.id)
  await shot(page, 'light')
})

await group('orbs', null, async ({ page }) => {
  await newChat(page)
  for (const [state, caption] of [['listening', ''], ['thinking', ''], ['speaking', "It's about 29 degrees in Mumbai and mostly clear."]]) {
    await act(page, ([s, c]) => window.__ora.store.getState().set({ voice: s, caption: c }), [state, caption])
    await wait(page, 1200)
    await shot(page, `orb-${state}`, page.locator('.orb-hero'))
  }
})

const mock = !wanted.length || wanted.includes('approval') ? await startMockLlm() : null
await group('approval', () => ({ ORA_LLM_BASE_URL: `http://127.0.0.1:${mock?.port}` }), async ({ page, userData }) => {
  // Nothing is written: the card is captured and then denied. The folder is a temp one just in case.
  await act(page, (dir) => window.__ora.store.getState().updateSettings({ tools: { sandboxDir: dir } }), join(userData, 'files'))
  await newChat(page)
  await act(page, () => { window.__ora.voice.submitText('Please save my shopping list: milk, eggs, bread and tea.') })
  await page.waitForFunction(() => window.__ora.store.getState().approvals.length === 1, null, { timeout: 30000 })
  await wait(page, 1000)
  await shot(page, 'approval')
  await page.click('.approve-bar .btn:not(.primary)')
  await wait(page, 500)
})
mock?.close()

console.log('\ndone ->', outDir)
process.exit(0)
