import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Models live in %APPDATA%\Ora\models. Before the app has run once after the rename they are still under \Vox.
export function findModelsDir() {
  const ora = join(process.env.APPDATA, 'Ora', 'models')
  const legacy = join(process.env.APPDATA, 'Vox', 'models')
  return existsSync(ora) || !existsSync(legacy) ? ora : legacy
}
