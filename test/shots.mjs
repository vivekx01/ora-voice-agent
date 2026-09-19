// Launches the built app in an isolated profile and saves screenshots (dark + light).
// Usage: npm run build && node test/shots.mjs
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { findModelsDir } from './paths.mjs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.ORA_TEST_DIR || join(os.tmpdir(), 'ora-e2e')
const userData = join(out, 'userdata')
mkdirSync(userData, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', ORA_USER_DATA: userData, ORA_MODELS_DIR: findModelsDir(), OPENROUTER_API_KEY: 'test-key' }
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/onnxruntime|Autofill/.test(m.text()) && errors.push(m.text().slice(0, 200)))
await page.goto('ora://app/index.html?debug=1')
await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })
await page.waitForFunction(() => { const s = window.__ora.store.getState(); return s.tts.state === 'ready' && s.stt.state === 'ready' }, null, { timeout: 300000 })
await page.evaluate(() => window.__ora.store.getState().updateSettings({ general: { globalHotkey: '' } }))

for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => window.__ora.store.getState().updateSettings({ ui: { theme: t } }), theme)
  await page.evaluate(() => window.__ora.store.getState().set({ settingsOpen: false }))
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(out, `home-${theme}.png`) })
  for (const tab of ['model', 'agent', 'appearance', 'advanced']) {
    await page.evaluate((t) => window.__ora.store.getState().openSettings(t), tab)
    await page.waitForTimeout(tab === 'model' ? 1800 : 400)
    await page.screenshot({ path: join(out, `settings-${tab}-${theme}.png`) })
  }
}
console.log('screenshots in', out)
console.log('page errors:', errors.length ? errors : 'none')
await app.close()
