// Minimal Electron main process used only by scripts/make-icons.mjs: a hidden window to draw on.
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  win.loadURL('data:text/html,<meta charset="utf-8"><body></body>')
})
app.on('window-all-closed', () => app.quit())
