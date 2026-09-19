import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeTheme, Notification, shell } from 'electron'
import { isProviderConfigured, providerInfo, type AgentEvent, type ChatMessage, type Conversation, type DeepPartial, type ProviderId, type Settings } from '@shared/types'
import { runAgent } from './agent'
import { TOOL_INFOS } from './agent/tools'
import { createConversation, deleteConversation, getConversation, listConversations, saveConversation } from './conversations'
import { memory } from './memory'
import { downloadModels, modelsStatus } from './models'
import { checkKey, listModels } from './providers'
import { getApiKey, getSettings, keyStatus, resetSettings, setApiKey, updateSettings } from './settings'

interface Run {
  controller: AbortController
  approvals: Set<string>
}

const runs = new Map<string, Run>()
const approvals = new Map<string, (ok: boolean) => void>()
const timers = new Set<NodeJS.Timeout>()

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  showWindow: () => void
}

export function applyWindowSettings(win: BrowserWindow | null, s: Settings): void {
  nativeTheme.themeSource = s.ui.theme
  win?.setAlwaysOnTop(s.general.alwaysOnTop)
}

export function registerHotkey(deps: IpcDeps): void {
  globalShortcut.unregisterAll()
  const accel = getSettings().general.globalHotkey
  if (!accel) return
  try {
    globalShortcut.register(accel, () => {
      deps.showWindow()
      deps.getWindow()?.webContents.send('hotkey:pressed')
    })
  } catch (err) {
    console.warn('[hotkey] could not register', accel, err)
  }
}

export function registerIpc(deps: IpcDeps): void {
  const send = (channel: string, payload: unknown): void => {
    const win = deps.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  ipcMain.handle('settings:get', () => ({ settings: getSettings(), keys: keyStatus() }))
  ipcMain.handle('settings:update', (_e, patch: DeepPartial<Settings>) => {
    const before = getSettings().general.globalHotkey
    const next = updateSettings(patch)
    applyWindowSettings(deps.getWindow(), next)
    if (next.general.globalHotkey !== before) registerHotkey(deps)
    return next
  })
  ipcMain.handle('settings:reset', () => {
    const next = resetSettings()
    applyWindowSettings(deps.getWindow(), next)
    registerHotkey(deps)
    return next
  })
  ipcMain.handle('settings:setApiKey', (_e, provider: ProviderId, key: string) => {
    setApiKey(provider, key)
    return keyStatus()
  })
  ipcMain.handle('settings:checkKey', (_e, provider: ProviderId, key?: string, baseUrl?: string) =>
    checkKey(provider, key ?? getApiKey(provider), baseUrl ?? getSettings().llm.customBaseUrl)
  )

  ipcMain.handle('models:status', () => modelsStatus())
  ipcMain.handle('models:download', async () => {
    try {
      await downloadModels((p) => send('models:progress', p))
      return { ok: true }
    } catch (err) {
      const message = (err as Error).message
      send('models:progress', { file: '', received: 0, total: 0, overallReceived: 0, overallTotal: 0, done: true, error: message })
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('providers:models', (_e, provider: ProviderId, opts?: { baseUrl?: string; force?: boolean }) =>
    listModels(provider, getApiKey(provider), opts?.baseUrl ?? getSettings().llm.customBaseUrl, Boolean(opts?.force))
  )

  ipcMain.handle('conv:list', () => listConversations())
  ipcMain.handle('conv:get', (_e, id: string) => getConversation(id))
  ipcMain.handle('conv:create', () => createConversation())
  ipcMain.handle('conv:save', (_e, conv: Conversation) => saveConversation(conv))
  ipcMain.handle('conv:remove', (_e, id: string) => deleteConversation(id))

  ipcMain.handle('tools:list', () => TOOL_INFOS)
  ipcMain.handle('memory:list', () => memory.list())
  ipcMain.handle('memory:remove', (_e, id: string) => memory.remove(id))
  ipcMain.handle('memory:clear', () => memory.clear())

  ipcMain.handle('agent:run', (_e, req: { history: ChatMessage[]; text: string }) => {
    const runId = randomUUID()
    const run: Run = { controller: new AbortController(), approvals: new Set() }
    runs.set(runId, run)
    const settings = getSettings()

    const emit = (event: AgentEvent): void => {
      send('agent:event', event)
      if (event.type === 'done' || event.type === 'error' || event.type === 'cancelled') runs.delete(runId)
    }

    if (!isProviderConfigured(settings.llm, keyStatus())) {
      const label = providerInfo(settings.llm.provider).label
      const message = settings.llm.provider === 'custom' ? 'Set the server address in Settings > Model first.' : `Add your ${label} API key in Settings first.`
      queueMicrotask(() => emit({ runId, type: 'error', message }))
      return runId
    }

    void runAgent({
      runId,
      history: req.history,
      text: req.text,
      settings,
      apiKey: getApiKey(settings.llm.provider),
      signal: run.controller.signal,
      emit,
      requestApproval: (info) =>
        new Promise<boolean>((resolve) => {
          const approvalId = randomUUID()
          run.approvals.add(approvalId)
          const timeout = setTimeout(() => finish(false), 90_000)
          const finish = (ok: boolean): void => {
            clearTimeout(timeout)
            run.approvals.delete(approvalId)
            approvals.delete(approvalId)
            resolve(ok)
          }
          approvals.set(approvalId, finish)
          emit({ runId, type: 'tool_approval', approvalId, name: info.name, args: info.args, summary: info.summary })
          run.controller.signal.addEventListener('abort', () => finish(false), { once: true })
        }),
      onTimer: (label, seconds) => {
        const handle = setTimeout(() => {
          timers.delete(handle)
          new Notification({ title: 'Timer finished', body: label }).show()
          send('timer:fired', { label })
        }, seconds * 1000)
        timers.add(handle)
      }
    })
    return runId
  })

  ipcMain.handle('agent:cancel', (_e, runId: string) => {
    const run = runs.get(runId)
    if (!run) return
    run.controller.abort()
    for (const id of run.approvals) approvals.get(id)?.(false)
  })
  ipcMain.handle('agent:approve', (_e, approvalId: string, ok: boolean) => approvals.get(approvalId)?.(ok))

  ipcMain.handle('system:openExternal', async (_e, url: string) => {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'http:') await shell.openExternal(u.toString())
  })
  ipcMain.handle('system:pickFolder', async () => {
    const win = deps.getWindow()
    const res = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('system:setWindowTheme', (_e, dark: boolean) => {
    const win = deps.getWindow()
    if (process.platform === 'win32' && win) {
      win.setBackgroundColor(dark ? '#0b0c10' : '#f5f6fa')
      win.setTitleBarOverlay({ color: dark ? '#0b0c10' : '#f5f6fa', symbolColor: dark ? '#a1a7b5' : '#4a5060', height: 44 })
    }
  })
  ipcMain.handle('system:version', () => app.getVersion())
  ipcMain.handle('system:resetGpuCache', () => {
    writeFileSync(join(app.getPath('userData'), 'reset-gpu-cache'), '')
    app.relaunch()
    app.exit(0)
  })
}

export function shutdownIpc(): void {
  for (const run of runs.values()) run.controller.abort()
  for (const t of timers) clearTimeout(t)
  globalShortcut.unregisterAll()
}
