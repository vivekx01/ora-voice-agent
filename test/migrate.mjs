// Verifies the one-time move of the old "Vox" data folder to "Ora", in a throwaway fake AppData.
// Usage: npm run build && node test/migrate.mjs
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }

function seed(appData, { withOra = false } = {}) {
  const legacy = join(appData, 'Vox')
  mkdirSync(join(legacy, 'conversations'), { recursive: true })
  mkdirSync(join(legacy, 'models', 'supertonic-3', 'onnx'), { recursive: true })
  writeFileSync(join(legacy, 'models', 'supertonic-3', 'onnx', 'tts.json'), '{"marker":"model-file"}')
  writeFileSync(join(legacy, 'settings.json'), JSON.stringify({ agent: { name: 'Vox', userName: 'Vivek' }, llm: { model: 'google/gemini-2.5-flash' } }))
  writeFileSync(join(legacy, 'conversations', 'abc.json'), JSON.stringify({ id: 'abc', title: 'old chat', createdAt: 1, updatedAt: 1, messages: [{ id: 'm', role: 'user', text: 'hello', createdAt: 1 }] }))
  writeFileSync(join(legacy, 'memory.json'), JSON.stringify([{ id: 'x', text: 'likes tea', createdAt: 1 }]))
  if (withOra) { mkdirSync(join(appData, 'Ora'), { recursive: true }); writeFileSync(join(appData, 'Ora', 'settings.json'), JSON.stringify({ agent: { userName: 'Already' } })) }
}

async function run(appData) {
  const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', ORA_APPDATA: appData } })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.ora), null, { timeout: 30000 })
  const title = await page.title()
  const data = await page.evaluate(async () => ({ settings: (await window.ora.settings.get()).settings, chats: await window.ora.conversations.list(), memory: await window.ora.memory.list(), models: await window.ora.models.status() }))
  await app.close()
  return { title, data }
}

console.log('[1] old Vox folder exists, no Ora folder: everything moves over')
{
  const appData = mkdtempSync(join(os.tmpdir(), 'ora-migrate-'))
  seed(appData)
  const { title, data } = await run(appData)
  check('window title is Ora', title === 'Ora', title)
  check('Ora folder now exists, Vox folder is gone', existsSync(join(appData, 'Ora')) && !existsSync(join(appData, 'Vox')))
  check('voice model file moved', readFileSync(join(appData, 'Ora', 'models', 'supertonic-3', 'onnx', 'tts.json'), 'utf8').includes('model-file'))
  check('app reads the migrated models folder', data.models.dir.startsWith(join(appData, 'Ora')), data.models.dir)
  check('assistant default name carried over Vox -> Ora', data.settings.agent.name === 'Ora', data.settings.agent.name)
  check('other saved settings preserved', data.settings.agent.userName === 'Vivek' && data.settings.llm.model === 'google/gemini-2.5-flash')
  check('old chat is still listed', data.chats.some((c) => c.title === 'old chat'))
  check('memory preserved', data.memory.some((m) => m.text === 'likes tea'))
  rmSync(appData, { recursive: true, force: true })
}

console.log('\n[2] both folders exist: nothing is overwritten')
{
  const appData = mkdtempSync(join(os.tmpdir(), 'ora-migrate-'))
  seed(appData, { withOra: true })
  const { data } = await run(appData)
  check('Vox folder left untouched', existsSync(join(appData, 'Vox', 'settings.json')))
  check('existing Ora settings kept', data.settings.agent.userName === 'Already', data.settings.agent.userName)
  rmSync(appData, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
