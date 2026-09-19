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
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await page.goto('ora://app/index.html?debug=1')
await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })
for (let i = 0; i < 9; i++) {
  await page.waitForTimeout(10000)
  const s = await page.evaluate(() => { const st = window.__ora.store.getState(); return { tts: st.tts.state + ' ' + (st.tts.stage || st.tts.error || ''), stt: st.stt.state + ' ' + (st.stt.stage || st.stt.error || '') } })
  console.log(`t+${(i + 1) * 10}s`, JSON.stringify(s))
  if (s.tts.startsWith('ready') && s.stt.startsWith('ready')) break
}
console.log(logs.filter((l) => !/Autofill/.test(l)).slice(0, 12).join('\n'))
await app.close()
