// Multi-provider test: OpenRouter, OpenAI, Anthropic, Google and a custom server, all against the local
// mock (test/mock-llm.mjs). Checks request shapes, tool calling, model lists, key handling and error messages.
// Usage: npm run build && node test/providers.mjs
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { startMockLlm } from './mock-llm.mjs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shots = process.env.ORA_TEST_DIR || join(os.tmpdir(), 'ora-e2e')
mkdirSync(shots, { recursive: true })
const mock = await startMockLlm()

let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }

async function launch(userData, extraEnv = {}) {
  // Keys can come from the environment too; clear them so only what the test saves is used.
  const env = { ...process.env, NODE_ENV: 'production', ORA_USER_DATA: userData, ORA_LLM_BASE_URL: `http://127.0.0.1:${mock.port}`, ...extraEnv }
  for (const k of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']) delete env[k]
  const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('ora://app/index.html?debug=1')
  await page.waitForFunction(() => Boolean(window.__ora), null, { timeout: 30000 })
  await page.evaluate(() => window.__ora.store.getState().updateSettings({ general: { globalHotkey: '' }, ui: { theme: 'dark' } }))
  return { app, page, errors }
}

console.log('[0] Self-check: the mock rejects what the real providers reject (so a pass above means something)')
{
  const post = (path, body, headers = {}) => fetch(`http://127.0.0.1:${mock.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, text: await r.text() }))
  const gem = (params) => ({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: [{ functionDeclarations: [{ name: 't', description: 'd', parameters: params }] }] })
  const g = '/v1beta/models/gemini-2.5-flash:streamGenerateContent'
  const h = { 'x-goog-api-key': 'good' }
  check('Gemini: format "uri" on a string is refused', (await post(g, gem({ type: 'object', properties: { url: { type: 'string', format: 'uri' } } }), h)).status === 400)
  check('Gemini: an object with empty properties is refused', (await post(g, gem({ type: 'object', properties: {} }), h)).status === 400)
  check('Gemini: additionalProperties is refused', (await post(g, gem({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }), h)).status === 400)
  check('Gemini: a valid schema is accepted', (await post(g, gem({ type: 'object', properties: { a: { type: 'string' } } }), h)).status === 200)
  check('Gemini: history starting with the model is refused', (await post(g, { contents: [{ role: 'model', parts: [{ text: 'x' }] }, { role: 'user', parts: [{ text: 'hi' }] }] }, h)).status === 400)
  const ah = { 'x-api-key': 'good', 'anthropic-version': '2023-06-01' }
  check('Claude: two user turns in a row are refused', (await post('/v1/messages', { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] }, ah)).status === 400)
  check('Claude: temperature above 1 is refused', (await post('/v1/messages', { model: 'm', max_tokens: 10, temperature: 1.3, messages: [{ role: 'user', content: 'a' }] }, ah)).status === 400)
}

const userData = mkdtempSync(join(os.tmpdir(), 'ora-prov-'))
const { app, page, errors } = await launch(userData)

const configure = ({ provider, model, key, llm = {} }) =>
  page.evaluate(async ({ provider, model, key, llm }) => {
    const s = window.__ora.store.getState()
    if (key !== undefined) await s.setApiKey(provider, key)
    await s.selectProvider(provider)
    await window.__ora.store.getState().updateSettings({ llm: { model, ...llm } })
  }, { provider, model, key, llm })

const runTurn = async (text, seedMessages) => {
  await page.evaluate((seed) => {
    const s = window.__ora.store.getState()
    s.set({ active: { ...s.active, id: crypto.randomUUID(), messages: seed ?? [] }, voice: 'idle' })
  }, seedMessages ?? null)
  const before = mock.log.length
  await page.evaluate((t) => window.__ora.voice.submitText(t), text)
  await page.waitForFunction(() => { const s = window.__ora.store.getState(); const m = s.active.messages.at(-1); return m?.role === 'assistant' && s.voice === 'idle' }, null, { timeout: 60000 })
  const last = await page.evaluate(() => window.__ora.store.getState().active.messages.at(-1))
  return { last, sent: mock.log.slice(before) }
}

const WEATHER = "What's the weather like in Mumbai?"
const okTurn = (last) => last.text.length > 20 && last.toolCalls?.length === 1 && last.toolCalls[0].name === 'get_weather' && last.toolCalls[0].status === 'done' && !last.error

console.log('[1] OpenRouter (the original provider still works)')
{
  await configure({ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', key: 'good-or' })
  const { last, sent } = await runTurn(WEATHER)
  check('tool call, then a spoken answer', okTurn(last), last.text.slice(0, 50))
  check('sent to the OpenAI-compatible endpoint with the key', sent[0]?.protocol === 'openai' && sent[0].headers.authorization === 'Bearer good-or')
  check('OpenRouter routing (fastest provider) is sent', sent[0]?.body.provider?.sort === 'latency', JSON.stringify(sent[0]?.body.provider))
}

console.log('\n[2] OpenAI')
{
  await configure({ provider: 'openai', model: 'gpt-4.1-mini', key: 'good-oa', llm: { temperature: 0.4, reasoning: 'default' } })
  let { last, sent } = await runTurn(WEATHER)
  check('tool call, then a spoken answer', okTurn(last), last.text.slice(0, 50))
  check('classic model: temperature and max_tokens are sent', sent[0]?.body.temperature === 0.4 && sent[0].body.max_tokens === 700, `temp=${sent[0]?.body.temperature} max_tokens=${sent[0]?.body.max_tokens}`)
  check('OpenRouter-only options are NOT sent to OpenAI', sent[0]?.body.provider === undefined && sent[0]?.body.reasoning === undefined)
  check('uses the OpenAI key', sent[0]?.headers.authorization === 'Bearer good-oa')

  await configure({ provider: 'openai', model: 'gpt-5.4-mini', llm: { reasoning: 'off' } })
  ;({ last, sent } = await runTurn(WEATHER))
  check('GPT-5 model works', okTurn(last))
  check('GPT-5: no temperature (OpenAI would reject it)', sent[0]?.body.temperature === undefined, `temperature=${sent[0]?.body.temperature}`)
  check('GPT-5: max_completion_tokens instead of max_tokens', sent[0]?.body.max_completion_tokens === 700 && sent[0].body.max_tokens === undefined)
  check('GPT-5: reasoning "off" becomes minimal effort', sent[0]?.body.reasoning_effort === 'minimal', String(sent[0]?.body.reasoning_effort))

  await configure({ provider: 'openai', model: 'gpt-5.4-mini', llm: { reasoning: 'high' } })
  ;({ sent } = await runTurn(WEATHER))
  check('GPT-5: reasoning "high" is passed through', sent[0]?.body.reasoning_effort === 'high')
}

console.log('\n[3] Anthropic')
{
  await configure({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', key: 'good-an', llm: { temperature: 1.3, reasoning: 'default' } })
  const { last, sent } = await runTurn(WEATHER)
  check('tool call, then a spoken answer (both requests accepted)', okTurn(last) && sent.length === 2, `${sent.length} requests`)
  check('native Anthropic endpoint with x-api-key and version header', sent[0]?.protocol === 'anthropic' && sent[0].headers['x-api-key'] === 'good-an' && Boolean(sent[0].headers['anthropic-version']))
  check('temperature capped to Claude\'s 0 to 1 range', sent[0]?.body.temperature <= 1, `sent ${sent[0]?.body.temperature} for a setting of 1.3`)
  check('system prompt sent as the system field', JSON.stringify(sent[0]?.body.system ?? '').includes('spoken aloud'))
  check('every tool has an input_schema', sent[0]?.body.tools?.length >= 8 && sent[0].body.tools.every((t) => t.input_schema?.type === 'object'), `${sent[0]?.body.tools?.length} tools`)
}

console.log('\n[4] Google Gemini')
{
  await configure({ provider: 'google', model: 'gemini-2.5-flash', key: 'good-gg', llm: { reasoning: 'off', temperature: 0.6 } })
  const { last, sent } = await runTurn(WEATHER)
  check('tool call, then a spoken answer', okTurn(last), last.text || last.error)
  check('every tool schema is accepted by Gemini\'s strict rules', sent.length === 2 && !sent.some((e) => e.rejected), sent.map((e) => e.rejected?.join('; ')).filter(Boolean).join(' | ') || `${sent.length} requests`)
  check('native Gemini endpoint for the chosen model', sent[0]?.path === '/v1beta/models/gemini-2.5-flash:streamGenerateContent')
  check('key sent in the x-goog-api-key header (not the URL)', sent[0]?.headers['x-goog-api-key'] === 'good-gg')
  check('"Off" reasoning disables Gemini 2.5 Flash thinking', JSON.stringify(sent[0]?.body).includes('"thinkingBudget":0'))
  const decls = sent[0]?.body.tools?.[0]?.functionDeclarations ?? []
  check('all tools declared', decls.length >= 8, `${decls.length} tools`)
}

console.log('\n[5] Custom OpenAI-compatible server (Ollama-style, no key)')
{
  await configure({ provider: 'custom', model: 'llama3.1', llm: { customBaseUrl: 'http://localhost:11434/v1' } })
  const { last, sent } = await runTurn(WEATHER)
  check('tool call, then a spoken answer without an API key', okTurn(last), last.text.slice(0, 50))
  check('model id sent as typed', sent[0]?.body.model === 'llama3.1')
}

console.log('\n[6] Message-order robustness (Gemini and Claude reject bad histories)')
{
  const awkward = [
    { id: 'a0', role: 'assistant', text: 'A reply that starts the saved history', createdAt: 1 },
    { id: 'u1', role: 'user', text: 'first question', createdAt: 2 },
    { id: 'a1', role: 'assistant', text: '', error: 'The provider failed', createdAt: 3 },
    { id: 'u2', role: 'user', text: 'second question', createdAt: 4 }
  ]
  for (const [provider, model] of [['anthropic', 'claude-haiku-4-5-20251001'], ['google', 'gemini-2.5-flash']]) {
    await configure({ provider, model, llm: { reasoning: 'default', temperature: 0.6 } })
    const { last, sent } = await runTurn(WEATHER, awkward)
    check(`${provider}: history starting with the assistant and a failed turn is fixed up`, okTurn(last) && !sent.some((e) => e.rejected), sent.map((e) => e.rejected?.join('; ')).filter(Boolean).join(' | ') || last.error || '')
  }
}

console.log('\n[7] Switching providers remembers the model for each')
{
  await configure({ provider: 'openai', model: 'gpt-5.4-mini' })
  const models = await page.evaluate(async () => {
    const s = window.__ora.store.getState()
    const seen = {}
    await s.selectProvider('anthropic'); seen.anthropic = window.__ora.store.getState().settings.llm.model
    await window.__ora.store.getState().selectProvider('openai'); seen.openai = window.__ora.store.getState().settings.llm.model
    await window.__ora.store.getState().selectProvider('google'); seen.google = window.__ora.store.getState().settings.llm.model
    return seen
  })
  check('a provider you have not used yet starts on its default model', models.google === 'gemini-2.5-flash', models.google)
  check('returning to OpenAI restores gpt-5.4-mini', models.openai === 'gpt-5.4-mini', models.openai)
}

console.log('\n[8] Model lists are filtered to chat models')
{
  const ids = (p) => page.evaluate((provider) => window.ora.providers.models(provider, { force: true }).then((m) => m.map((x) => x.id)), p)
  const openai = await ids('openai')
  check('OpenAI: chat models only', openai.length === 4 && openai.includes('gpt-5.4-mini') && !openai.some((i) => /embedding|whisper|image|realtime|moderation/.test(i)), openai.join(', '))
  const google = await ids('google')
  check('Google: Gemini models that can chat (no embeddings, TTS or Gemma)', google.join(',') === 'gemini-2.5-flash-lite,gemini-2.5-flash', google.join(', '))
  const anthropic = await page.evaluate(() => window.ora.providers.models('anthropic', { force: true }))
  check('Anthropic: lists models with display names', anthropic.length === 2 && anthropic.some((m) => m.name === 'Claude Haiku 4.5'), anthropic.map((m) => m.name).join(', '))
  const or = await page.evaluate(() => window.ora.providers.models('openrouter', { force: true }))
  check('OpenRouter: tool-capable text models only, with prices', or.length === 2 && or.find((m) => m.id.endsWith(':free'))?.free === true && or.find((m) => m.id.includes('haiku'))?.promptPerM === 1, or.map((m) => m.id).join(', '))
  const custom = await ids('custom')
  check('Custom: lists whatever the server offers', custom.length > 8, `${custom.length} models`)
  await page.evaluate(() => window.ora.settings.setApiKey('openai', ''))
  const noKey = await page.evaluate(() => window.ora.providers.models('openai', { force: true }).then(() => 'loaded', (e) => e.message))
  check('OpenAI without a key explains what to do', /Add an API key/.test(noKey), noKey)
  await page.evaluate(() => window.ora.settings.setApiKey('openai', 'good-oa'))
}

console.log('\n[9] Key checks accept good keys and reject bad ones')
for (const provider of ['openrouter', 'openai', 'anthropic', 'google']) {
  const good = await page.evaluate((p) => window.ora.settings.checkKey(p, 'good-key'), provider)
  const bad = await page.evaluate((p) => window.ora.settings.checkKey(p, 'bad-key'), provider)
  const none = await page.evaluate((p) => window.ora.settings.checkKey(p, ''), provider)
  check(`${provider}: valid key accepted, bad key rejected, empty key refused`, good.ok && !bad.ok && !none.ok, `${good.message} | ${bad.message}`)
}

console.log('\n[10] Errors are explained in plain words')
{
  await configure({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', key: 'bad-key' })
  let { last } = await runTurn(WEATHER)
  check('Anthropic bad key: "rejected the API key"', /Anthropic rejected the API key/.test(last.error ?? ''), last.error)
  await configure({ provider: 'google', model: 'gemini-2.5-flash', key: 'bad-key' })
  ;({ last } = await runTurn(WEATHER))
  check('Google bad key: "rejected the API key"', /Google rejected the API key/.test(last.error ?? ''), last.error)
  await configure({ provider: 'openai', model: 'gpt-4.1-mini', key: 'bad-key' })
  ;({ last } = await runTurn(WEATHER))
  check('OpenAI bad key: "rejected the API key"', /OpenAI rejected the API key/.test(last.error ?? ''), last.error)
  await page.evaluate(() => window.ora.settings.setApiKey('google', ''))
  await configure({ provider: 'google', model: 'gemini-2.5-flash' })
  ;({ last } = await runTurn(WEATHER))
  check('No key saved: asks you to add one', /Add your Google API key/.test(last.error ?? ''), last.error)
}

console.log('\n[11] Keys are stored per provider')
{
  const keys = await page.evaluate(async () => {
    await window.ora.settings.setApiKey('openrouter', 'good-or')
    await window.ora.settings.setApiKey('anthropic', 'good-an')
    const both = await window.ora.settings.get().then((r) => r.keys)
    const after = await window.ora.settings.setApiKey('anthropic', '')
    return { both, after }
  })
  check('several providers can each hold a key', keys.both.openrouter && keys.both.anthropic && keys.both.openai)
  check('removing one key leaves the others', keys.after.anthropic === false && keys.after.openrouter === true)
}

console.log('\n[12] Model tab shows the provider picker (screenshots)')
{
  for (const provider of ['openai', 'anthropic', 'google', 'custom']) {
    await page.evaluate(async (p) => { await window.__ora.store.getState().selectProvider(p); window.__ora.store.getState().openSettings('model') }, provider)
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(shots, `providers-${provider}.png`) })
  }
  const picker = await page.evaluate(() => { window.__ora.store.getState().openSettings('model'); return [...document.querySelectorAll('.prov b')].map((e) => e.textContent) })
  check('all five providers are offered', picker.join(',') === 'OpenRouter,OpenAI,Anthropic,Google,Custom', picker.join(','))
}
check('no page errors', errors.length === 0, errors.join(' | '))
await app.close()
rmSync(userData, { recursive: true, force: true })

console.log('\n[13] Upgrading: a single OpenRouter key saved by the old version is picked up and migrated')
{
  const dir = mkdtempSync(join(os.tmpdir(), 'ora-prov-legacy-'))
  writeFileSync(join(dir, 'secrets.bin'), Buffer.concat([Buffer.from('plain:legacy-or-key'), Buffer.alloc(0)]))
  const second = await launch(dir)
  const before = await second.page.evaluate(() => window.ora.settings.get().then((r) => r.keys))
  check('the old OpenRouter key still works after upgrading', before.openrouter === true && before.openai === false)
  const migrated = await second.page.evaluate(async () => { await window.ora.settings.setApiKey('openai', 'good-oa'); return window.ora.settings.get().then((r) => r.keys) })
  check('adding a new key keeps the old one', migrated.openrouter === true && migrated.openai === true)
  check('the old single-key file is replaced by the per-provider store', !existsSync(join(dir, 'secrets.bin')) && existsSync(join(dir, 'secrets-v2.bin')))
  await second.app.close()
  rmSync(dir, { recursive: true, force: true })
}

mock.close()
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
