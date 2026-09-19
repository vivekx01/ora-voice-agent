// Layout regression: a long chat must scroll inside the chat area and keep the dock on screen.
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
const userData = join(out, 'userdata-layout'); mkdirSync(userData, { recursive: true })
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', ORA_USER_DATA: userData, ORA_MODELS_DIR: findModelsDir(), OPENROUTER_API_KEY: 'x' } })
const page = await app.firstWindow()
await page.goto('ora://app/index.html?debug=1')
await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })
await page.waitForSelector('.dock')
await page.evaluate(() => {
  const long = 'This is a fairly long assistant reply that goes on for a while so that it wraps across several lines in the chat column. '.repeat(6)
  const msgs = []
  for (let i = 0; i < 14; i++) {
    msgs.push({ id: `u${i}`, role: 'user', text: `Question number ${i + 1}: tell me something interesting about topic ${i}`, createdAt: Date.now(), source: 'text' })
    msgs.push({ id: `a${i}`, role: 'assistant', text: long, createdAt: Date.now(), toolCalls: i % 3 === 0 ? [{ callId: `c${i}`, name: 'get_weather', args: { location: 'Mumbai' }, status: 'done', ms: 900, result: 'ok' }] : [], metrics: { firstAudioMs: 2100, totalMs: 9000 } })
  }
  const s = window.__ora.store.getState()
  s.set({ active: { ...s.active, messages: msgs }, sidebarOpen: true })
})
await page.waitForTimeout(600)

const measure = () => page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null }
  const dock = r('.dock'), scroller = document.querySelector('.chat-scroll'), composer = r('.composer'), main = r('.main'), app = r('.app')
  return {
    viewport: [innerWidth, innerHeight],
    docScroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight],
    appBottom: Math.round(app.bottom), mainBottom: Math.round(main.bottom), dockBottom: Math.round(dock.bottom), composerBottom: Math.round(composer.bottom),
    chatScrollable: scroller.scrollHeight > scroller.clientHeight, chatClient: scroller.clientHeight, chatScrollH: scroller.scrollHeight,
    chatHOverflow: scroller.scrollWidth - scroller.clientWidth
  }
})

let bad = 0
for (const [w, h] of [[1180, 780], [900, 620], [1920, 1040], [1366, 700]]) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(w, h); win.center() }, [w, h])
  await page.waitForTimeout(500)
  const m = await measure()
  const ok = m.dockBottom <= m.viewport[1] + 1 && m.mainBottom <= m.viewport[1] + 1 && m.chatScrollable && m.docScroll[0] <= 0 && m.docScroll[1] <= 0 && m.chatHOverflow <= 0
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${w}x${h}  viewport=${m.viewport}  mainBottom=${m.mainBottom} dockBottom=${m.dockBottom}  chat ${m.chatClient}px visible / ${m.chatScrollH}px content  hOverflow=${m.chatHOverflow}  docScroll=${m.docScroll}`)
  if (process.argv[2]) await page.screenshot({ path: join(out, `layout-${w}x${h}.png`) })
}
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
await page.waitForTimeout(600)
const m = await measure()
const ok = m.dockBottom <= m.viewport[1] + 1 && m.chatScrollable && m.docScroll[1] <= 0
if (!ok) bad++
console.log(`${ok ? 'PASS' : 'FAIL'}  maximized  viewport=${m.viewport}  mainBottom=${m.mainBottom} dockBottom=${m.dockBottom}  chat ${m.chatClient}px visible / ${m.chatScrollH}px content`)
if (process.argv[2]) await page.screenshot({ path: join(out, 'layout-maximized.png') })
console.log(bad ? `${bad} LAYOUT CHECK(S) FAILED` : 'ALL LAYOUT CHECKS PASSED')
await app.close()
process.exit(bad ? 1 : 0)
