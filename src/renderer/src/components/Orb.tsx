import { useEffect, useRef } from 'react'
import { levels } from '../levels'
import type { VoiceState } from '../store'

interface Look {
  hue: number | null // null = follow the accent colour
  sat: number
  light: number
  energy: number
  speed: number
}

const LOOKS: Record<VoiceState, Look> = {
  booting: { hue: null, sat: 20, light: 50, energy: 0.03, speed: 0.4 },
  idle: { hue: null, sat: 55, light: 62, energy: 0.05, speed: 0.6 },
  listening: { hue: 168, sat: 80, light: 58, energy: 0.1, speed: 0.9 },
  hearing: { hue: 176, sat: 90, light: 62, energy: 0.16, speed: 1.4 },
  transcribing: { hue: 40, sat: 95, light: 62, energy: 0.16, speed: 1.6 },
  thinking: { hue: 40, sat: 95, light: 62, energy: 0.2, speed: 1.8 },
  speaking: { hue: null, sat: 95, light: 68, energy: 0.2, speed: 1.2 }
}

function readAccentHue(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent-h')
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 252
}

export function Orb({ size, state, className }: { size: number; state: VoiceState; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    let raf = 0
    let level = 0
    let accent = readAccentHue()
    let lastAccentRead = 0
    let hue = accent
    const start = performance.now()

    const blob = (cx: number, cy: number, r: number, t: number, amp: number, phase: number, speed: number): void => {
      const n = 72
      ctx.beginPath()
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2
        const wob = Math.sin(a * 3 + t * speed + phase) * 0.55 + Math.sin(a * 5 - t * speed * 1.3 + phase * 2) * 0.3 + Math.sin(a * 2 + t * speed * 0.7) * 0.4
        const rr = r * (1 + amp * wob)
        const x = cx + Math.cos(a) * rr
        const y = cy + Math.sin(a) * rr
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
    }

    const frame = (now: number): void => {
      const t = (now - start) / 1000
      if (now - lastAccentRead > 600) {
        accent = readAccentHue()
        lastAccentRead = now
      }
      const s = stateRef.current
      const look = LOOKS[s]
      const target = look.hue ?? accent
      let dh = target - hue
      if (dh > 180) dh -= 360
      if (dh < -180) dh += 360
      hue = (hue + dh * 0.08 + 360) % 360

      let signal = 0
      if (s === 'hearing' || s === 'listening') signal = levels.mic
      else if (s === 'speaking') signal = levels.out
      else if (s === 'thinking' || s === 'transcribing') signal = 0.35 + Math.sin(t * 3.2) * 0.2
      else signal = Math.sin(t * 1.4) * 0.12 + 0.12
      level += (Math.max(0, signal) - level) * 0.22

      const c = size / 2
      const R = size * 0.24
      const amp = look.energy + level * 0.34
      ctx.clearRect(0, 0, size, size)

      // outer glow
      const glowR = Math.min(size / 2, R * (1.9 + level * 0.5))
      const glow = ctx.createRadialGradient(c, c, R * 0.6, c, c, glowR)
      glow.addColorStop(0, `hsla(${hue} ${look.sat}% ${look.light}% / ${0.32 + level * 0.3})`)
      glow.addColorStop(1, `hsla(${hue} ${look.sat}% ${look.light}% / 0)`)
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, size, size)

      // layered blobs
      const layers = [
        { k: 1.18, a: 0.42, ph: 0, sp: 1, dl: 0 },
        { k: 1.06, a: 0.6, ph: 2.1, sp: -0.8, dl: 6 },
        { k: 0.95, a: 1, ph: 4.2, sp: 0.6, dl: 12 }
      ]
      for (const L of layers) {
        blob(c, c, R * L.k, t, amp, L.ph, look.speed * L.sp * 1.6)
        const g = ctx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.05, c, c, R * L.k * 1.1)
        g.addColorStop(0, `hsla(${hue + 25} ${look.sat}% ${Math.min(90, look.light + 20 + L.dl)}% / ${L.a})`)
        g.addColorStop(0.55, `hsla(${hue} ${look.sat}% ${look.light}% / ${L.a})`)
        g.addColorStop(1, `hsla(${hue - 30} ${look.sat}% ${Math.max(28, look.light - 22)}% / ${L.a})`)
        ctx.fillStyle = g
        ctx.fill()
      }

      // thinking: orbiting sparks
      if (s === 'thinking' || s === 'transcribing') {
        for (let i = 0; i < 3; i++) {
          const a = t * 2.2 + (i * Math.PI * 2) / 3
          const x = c + Math.cos(a) * R * 1.45
          const y = c + Math.sin(a) * R * 1.45
          const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.22)
          g.addColorStop(0, `hsla(${hue} 100% 80% / 0.95)`)
          g.addColorStop(1, `hsla(${hue} 100% 70% / 0)`)
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(x, y, R * 0.22, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // specular highlight
      const hl = ctx.createRadialGradient(c - R * 0.35, c - R * 0.45, 0, c - R * 0.35, c - R * 0.45, R * 0.6)
      hl.addColorStop(0, 'rgba(255,255,255,0.55)')
      hl.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = hl
      ctx.beginPath()
      ctx.arc(c - R * 0.35, c - R * 0.45, R * 0.6, 0, Math.PI * 2)
      ctx.fill()

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [size])

  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden />
}
