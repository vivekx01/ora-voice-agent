// Draws the Ora orb as the app icon and writes every size the app needs.
//   resources/icon.png     window + taskbar icon (512px)
//   build/icon.png         installer source (1024px)
//   build/icon.ico         Windows icon with 16..256px images
//   src/renderer/src/assets/icon.png   small copy shown in the title bar
// The orb is drawn with the same layers as the live one in the app (components/Orb.tsx).
// Usage: npm run icons
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Runs inside the page: draws the icon at the given sizes and returns PNGs as base64.
function renderAll(sizes) {
  const HUE = 252 // the violet accent

  function draw(ctx, S) {
    ctx.clearRect(0, 0, S, S)
    const pad = S * 0.02
    const w = S - pad * 2
    const radius = w * 0.225

    // rounded tile
    ctx.beginPath()
    ctx.roundRect(pad, pad, w, w, radius)
    const tile = ctx.createLinearGradient(0, 0, S, S)
    tile.addColorStop(0, '#1a1e2e')
    tile.addColorStop(1, '#07080c')
    ctx.fillStyle = tile
    ctx.fill()
    ctx.save()
    ctx.clip()

    const c = S / 2
    const small = S <= 40
    const R = S * (small ? 0.31 : 0.265)

    // soft glow behind the orb
    const glow = ctx.createRadialGradient(c, c, R * 0.5, c, c, R * 2.3)
    glow.addColorStop(0, `hsla(${HUE} 90% 62% / 0.55)`)
    glow.addColorStop(1, `hsla(${HUE} 90% 62% / 0)`)
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, S, S)

    // layered blobs, same recipe as the live orb
    const t = 1.7
    const amp = small ? 0.05 : 0.085
    const blob = (r, phase, speed) => {
      const n = 96
      ctx.beginPath()
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2
        const wob = Math.sin(a * 3 + t * speed + phase) * 0.55 + Math.sin(a * 5 - t * speed * 1.3 + phase * 2) * 0.3 + Math.sin(a * 2 + t * speed * 0.7) * 0.4
        const rr = r * (1 + amp * wob)
        const x = c + Math.cos(a) * rr
        const y = c + Math.sin(a) * rr
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
    }
    const sat = 82
    const light = 63
    for (const L of [{ k: 1.18, a: 0.45, ph: 0, sp: 1.6, dl: 0 }, { k: 1.06, a: 0.65, ph: 2.1, sp: -1.3, dl: 6 }, { k: 0.95, a: 1, ph: 4.2, sp: 1, dl: 12 }]) {
      blob(R * L.k, L.ph, L.sp)
      const g = ctx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.05, c, c, R * L.k * 1.1)
      g.addColorStop(0, `hsla(${HUE + 25} ${sat}% ${Math.min(90, light + 20 + L.dl)}% / ${L.a})`)
      g.addColorStop(0.55, `hsla(${HUE} ${sat}% ${light}% / ${L.a})`)
      g.addColorStop(1, `hsla(${HUE - 30} ${sat}% ${Math.max(28, light - 22)}% / ${L.a})`)
      ctx.fillStyle = g
      ctx.fill()
    }

    // specular highlight
    const hx = c - R * 0.35
    const hy = c - R * 0.45
    const hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, R * 0.6)
    hl.addColorStop(0, 'rgba(255,255,255,0.6)')
    hl.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = hl
    ctx.beginPath()
    ctx.arc(hx, hy, R * 0.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // hairline edge so the tile reads on dark backgrounds
    ctx.beginPath()
    ctx.roundRect(pad + 0.5, pad + 0.5, w - 1, w - 1, radius)
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = Math.max(1, S / 256)
    ctx.stroke()
  }

  const out = {}
  for (const size of sizes) {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    draw(canvas.getContext('2d'), size)
    out[size] = canvas.toDataURL('image/png').split(',')[1]
  }
  return out
}

// A Windows .ico can hold PNG images directly (Vista and later).
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let offset = header.length + entries.length
  images.forEach(({ size, png }, i) => {
    const e = i * 16
    entries.writeUInt8(size >= 256 ? 0 : size, e)
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1)
    entries.writeUInt8(0, e + 2)
    entries.writeUInt8(0, e + 3)
    entries.writeUInt16LE(1, e + 4)
    entries.writeUInt16LE(32, e + 6)
    entries.writeUInt32LE(png.length, e + 8)
    entries.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([header, entries, ...images.map((i) => i.png)])
}

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

const app = await electron.launch({ executablePath: require('electron'), args: [join(root, 'scripts/icon-tool/main.cjs')] })
const page = await app.firstWindow()
const rendered = await page.evaluate(renderAll, SIZES)
await app.close()
const png = (size) => Buffer.from(rendered[size], 'base64')

const write = (rel, data) => {
  const file = join(root, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  console.log(`wrote ${rel} (${(data.length / 1024).toFixed(0)} KB)`)
}
write('resources/icon.png', png(512))
write('build/icon.png', png(1024))
write('build/icon.ico', buildIco(ICO_SIZES.map((size) => ({ size, png: png(size) }))))
write('src/renderer/src/assets/icon.png', png(128))
