import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { applyWindowSettings, registerHotkey, registerIpc, shutdownIpc } from './ipc'
import { paths } from './paths'
import { registerProtocolHandler, registerSchemes } from './protocol'
import { getSettings } from './settings'

app.setName('Ora')

// The app used to be called Vox. Move its data (voice files, settings, chats, memories) to the new
// folder once, so nothing is lost and the 380 MB voice files aren't downloaded again.
function resolveUserData(): string {
  if (process.env.ORA_USER_DATA) return process.env.ORA_USER_DATA
  const appData = process.env.ORA_APPDATA || app.getPath('appData') // ORA_APPDATA: test hook
  const current = join(appData, 'Ora')
  const legacy = join(appData, 'Vox')
  if (!existsSync(current) && existsSync(legacy)) {
    try {
      renameSync(legacy, current)
      console.log('[ora] moved your data from the old Vox folder to', current)
    } catch (err) {
      console.warn('[ora] could not move the old Vox data folder (is an old copy still running?). Using it in place.', err)
      return legacy
    }
  }
  return current
}
app.setPath('userData', resolveUserData())
registerSchemes()

// "Reset GPU cache" from Settings leaves a marker; the caches are removed here, before Chromium opens them.
const gpuResetMarker = join(app.getPath('userData'), 'reset-gpu-cache')
if (existsSync(gpuResetMarker)) {
  for (const dir of ['DawnWebGPUCache', 'DawnGraphiteCache', 'GPUCache', 'Code Cache']) rmSync(join(app.getPath('userData'), dir), { recursive: true, force: true })
  rmSync(gpuResetMarker, { force: true })
}

let mainWindow: BrowserWindow | null = null
const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])

function bg(): string {
  return nativeTheme.shouldUseDarkColors ? '#0b0c10' : '#f5f6fa'
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  const settings = getSettings()
  nativeTheme.themeSource = settings.ui.theme
  const dark = nativeTheme.shouldUseDarkColors

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: bg(),
    title: 'Ora',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: dark ? '#0b0c10' : '#f5f6fa', symbolColor: dark ? '#a1a7b5' : '#4a5060', height: 44 },
    alwaysOnTop: settings.general.alwaysOnTop,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  const reveal = (): void => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
  }
  mainWindow.once('ready-to-show', reveal)
  setTimeout(reveal, 3500) // never leave the user with an invisible window if the page is slow or fails to load
  mainWindow.webContents.on('did-fail-load', (_e, code, description, url) => {
    console.error(`[ora] the window failed to load ${url}: ${description} (${code})`)
    reveal()
  })
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('ora://app') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'ora://app')) e.preventDefault()
  })

  if (isDev) void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  else void mainWindow.loadURL('ora://app/index.html')
}

function hardenSession(): void {
  const allowed = new Set(['media', 'audioCapture', 'clipboard-sanitized-write', 'notifications', 'fullscreen'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const types = (details as { mediaTypes?: string[] }).mediaTypes
    callback(allowed.has(permission) && (!types || types.every((t) => t === 'audio')))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders }
      if (details.url.startsWith('ora://app')) {
        headers['Content-Security-Policy'] = [
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; " +
            "connect-src 'self' ora: blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co"
        ]
      }
      callback({ responseHeaders: headers })
    })
  }
}

if (!app.requestSingleInstanceLock()) {
  console.error('[ora] Ora is already running, so this copy is closing and the existing window is being brought to the front.')
  console.error('[ora] If you see no window, run "npm run stop" to end leftover processes, then start again.')
  app.quit()
} else {
  app.on('second-instance', showWindow)

  void app.whenReady().then(() => {
    registerProtocolHandler(join(__dirname, '../renderer'), () => paths.models)
    hardenSession()
    const deps = { getWindow: () => mainWindow, showWindow }
    registerIpc(deps)
    createWindow()
    registerHotkey(deps)
    applyWindowSettings(mainWindow, getSettings())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('will-quit', shutdownIpc)
}
