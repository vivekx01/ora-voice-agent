import { app } from 'electron'
import { join } from 'node:path'

export const paths = {
  get userData(): string {
    return app.getPath('userData')
  },
  get models(): string {
    return process.env.ORA_MODELS_DIR || join(this.userData, 'models')
  },
  get supertonic(): string {
    return join(this.models, 'supertonic-3')
  },
  get conversations(): string {
    return join(this.userData, 'conversations')
  },
  get settings(): string {
    return join(this.userData, 'settings.json')
  },
  get secrets(): string {
    return join(this.userData, 'secrets.bin') // legacy: a single OpenRouter key
  },
  get secretsV2(): string {
    return join(this.userData, 'secrets-v2.bin') // one encrypted JSON blob with a key per provider
  },
  get memory(): string {
    return join(this.userData, 'memory.json')
  },
  get cache(): string {
    return join(this.userData, 'cache')
  },
  get defaultSandbox(): string {
    return join(app.getPath('documents'), 'Ora')
  }
}
