// Ends any leftover Ora / dev-server processes started from this project folder.
// Usage: npm run stop
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (process.platform !== 'win32') {
  console.log('npm run stop currently supports Windows only. Use: pkill -f electron-vite; pkill -f electron')
  process.exit(0)
}

const script = `
$root = '${root.replace(/'/g, "''")}'
$self = $PID
$hits = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $self -and $_.CommandLine -and $_.CommandLine -like "*$root*" -and
  ( $_.Name -eq 'electron.exe' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*electron-vite*') )
}
foreach ($p in $hits) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Output ("stopped " + $p.Name + " (pid " + $p.ProcessId + ")") } catch {} }
if (-not $hits) { Write-Output 'nothing to stop' }
`
console.log(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim())
