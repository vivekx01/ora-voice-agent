// Copies the WASM/ONNX runtime files and the VAD model out of node_modules so the renderer can
// load them from a stable URL (no CDN, works offline). Runs on install and before dev/build.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const pub = join(root, 'src', 'renderer', 'public')

const jobs = [
  ['onnxruntime-web/dist', 'ort', [
    'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm',
    'ort-wasm-simd-threaded.jspi.mjs', 'ort-wasm-simd-threaded.jspi.wasm',
    'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'
  ]],
  ['@ricky0123/vad-web/dist', 'vad', ['silero_vad_v5.onnx', 'vad.worklet.bundle.min.js']]
]

let missing = 0
for (const [from, to, files] of jobs) {
  const outDir = join(pub, to)
  mkdirSync(outDir, { recursive: true })
  for (const f of files) {
    const src = join(nm, from, f)
    if (!existsSync(src)) {
      console.warn(`[assets] missing ${src}`)
      missing++
      continue
    }
    copyFileSync(src, join(outDir, f))
  }
}
console.log(missing ? `[assets] done with ${missing} missing file(s)` : '[assets] runtime files copied')
