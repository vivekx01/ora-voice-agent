import { contextBridge, ipcRenderer } from 'electron'
import type { OraApi, Unsubscribe } from '../shared/api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: OraApi = {
  platform: process.platform,
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    reset: () => invoke('settings:reset'),
    setApiKey: (provider, key) => invoke('settings:setApiKey', provider, key),
    checkKey: (provider, key, baseUrl) => invoke('settings:checkKey', provider, key, baseUrl)
  },
  models: {
    status: () => invoke('models:status'),
    download: () => invoke('models:download'),
    onProgress: (cb) => on('models:progress', cb)
  },
  providers: { models: (provider, opts) => invoke('providers:models', provider, opts) },
  conversations: {
    list: () => invoke('conv:list'),
    get: (id) => invoke('conv:get', id),
    create: () => invoke('conv:create'),
    save: (conv) => invoke('conv:save', conv),
    remove: (id) => invoke('conv:remove', id)
  },
  agent: {
    run: (req) => invoke('agent:run', req),
    cancel: (runId) => invoke('agent:cancel', runId),
    approve: (approvalId, approved) => invoke('agent:approve', approvalId, approved),
    onEvent: (cb) => on('agent:event', cb)
  },
  tools: { list: () => invoke('tools:list') },
  memory: {
    list: () => invoke('memory:list'),
    remove: (id) => invoke('memory:remove', id),
    clear: () => invoke('memory:clear')
  },
  system: {
    onHotkey: (cb) => on('hotkey:pressed', () => cb()),
    onTimer: (cb) => on('timer:fired', cb),
    openExternal: (url) => invoke('system:openExternal', url),
    pickFolder: () => invoke('system:pickFolder'),
    setWindowTheme: (dark) => invoke('system:setWindowTheme', dark),
    version: () => invoke('system:version'),
    resetGpuCache: () => invoke('system:resetGpuCache')
  }
}

contextBridge.exposeInMainWorld('ora', api)
