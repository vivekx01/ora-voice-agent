// Attaches to a running `npm run dev` (started with --remote-debugging-port=9333) and checks it works.
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 60000 })
const page = browser.contexts()[0].pages().find((p) => !p.url().startsWith('devtools')) ?? (await browser.contexts()[0].waitForEvent('page'))
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/onnxruntime|Autofill|Download the React DevTools/.test(m.text()) && errors.push(m.text().slice(0, 240)))
console.log('page url:', page.url())
await page.goto(`${page.url().split('?')[0]}?debug=1`)
await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 60000 })
await page.waitForFunction(() => { const s = window.__ora.store.getState(); return s.tts.state === 'ready' && s.stt.state === 'ready' }, null, { timeout: 240000 })
const info = await page.evaluate(() => ({ origin: location.origin, secure: isSecureContext, tts: window.__ora.store.getState().tts.backend, stt: window.__ora.store.getState().stt.backend }))
console.log('dev environment:', JSON.stringify(info))
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
