import { net, protocol } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json'
}

// ora://app/...    -> the built renderer (production)
// ora://models/... -> on-device model files in the user data folder
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'ora', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
  ])
}

export function registerProtocolHandler(rendererDir: string, modelsDir: () => string): void {
  protocol.handle('ora', async (request) => {
    const url = new URL(request.url)
    const configured = url.hostname === 'app' ? rendererDir : url.hostname === 'models' ? modelsDir() : null
    if (!configured) return new Response('Not found', { status: 404 })
    const root = normalize(configured)

    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const file = normalize(join(root, rel))
    if (file !== root && !file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
    if (!existsSync(file) || !statSync(file).isFile()) return new Response('Not found', { status: 404 })

    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
    headers.set('Cache-Control', 'no-cache')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })
}
