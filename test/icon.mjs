// Checks the icon Windows actually shows for the running window (taskbar / Alt+Tab), plus the title-bar mark.
// Usage: npm run build && node test/icon.mjs
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.ORA_TEST_DIR || join(os.tmpdir(), 'ora-e2e')
mkdirSync(out, { recursive: true })
const userData = mkdtempSync(join(os.tmpdir(), 'ora-icon-'))
let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }

const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', ORA_USER_DATA: userData } })
const page = await app.firstWindow()
await page.waitForSelector('.brand-mark', { timeout: 30000 })
const isVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
for (let i = 0; i < 40 && !(await isVisible()); i++) await new Promise((r) => setTimeout(r, 250))
check('the window is shown on screen', await isVisible())
const hwnd = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE(0).toString())

// Ask Windows for the window's big icon (WM_GETICON) and save it as a PNG.
const png = join(out, 'window-icon.png')
const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l); [DllImport("user32.dll")] public static extern IntPtr GetClassLongPtr(IntPtr h, int i); }'
$h = [IntPtr]::new(${hwnd})
$icon = [W]::SendMessage($h, 0x7F, [IntPtr]1, [IntPtr]0)
if ($icon -eq [IntPtr]::Zero) { $icon = [W]::SendMessage($h, 0x7F, [IntPtr]2, [IntPtr]0) }
if ($icon -eq [IntPtr]::Zero) { $icon = [W]::GetClassLongPtr($h, -14) }
if ($icon -eq [IntPtr]::Zero) { Write-Output 'NOICON'; exit }
$bmp = [System.Drawing.Icon]::FromHandle($icon).ToBitmap()
$bmp.Save('${png.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$c = $bmp.GetPixel([int]($bmp.Width/2), [int]($bmp.Height/2))
Write-Output ("SIZE=" + $bmp.Width + "x" + $bmp.Height + " CENTER=" + $c.R + "," + $c.G + "," + $c.B)
`
const res = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim().split('\n').pop().trim()
console.log('  Windows reports:', res)
const m = res.match(/SIZE=(\d+)x(\d+) CENTER=(\d+),(\d+),(\d+)/)
check('the window has a custom icon set', Boolean(m))
if (m) {
  const [, w, , r, g, b] = m.map(Number)
  check('icon is the violet orb (blue is the dominant channel at the centre)', b > r && b > g && b > 120, `RGB ${r},${g},${b}`)
  check('icon is high resolution', w >= 32, `${w}px`)
}

const mark = await page.evaluate(() => { const i = document.querySelector('.brand-mark'); return { tag: i?.tagName, loaded: i?.complete && i.naturalWidth > 0, w: i?.naturalWidth } })
check('title bar shows the orb icon (image loaded)', mark.tag === 'IMG' && mark.loaded, `${mark.w}px source`)
await page.screenshot({ path: join(out, 'titlebar.png'), clip: { x: 0, y: 0, width: 420, height: 60 } })

await app.close()
rmSync(userData, { recursive: true, force: true })
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
