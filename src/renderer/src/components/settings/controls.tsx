import { useEffect, useState, type ReactNode } from 'react'

export function Group({ title, children }: { title?: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="group">
      {title && <h5>{title}</h5>}
      {children}
    </section>
  )
}

export function Row({ label, hint, children, stack }: { label: string; hint?: string; children: ReactNode; stack?: boolean }): React.JSX.Element {
  return (
    <div className={`row ${stack ? 'stack' : ''}`}>
      <div>
        <div className="lab">{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return <button role="switch" aria-checked={value} aria-label={label} className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)} />
}

export function Slider({ value, onCommit, min, max, step, format, label }: { value: number; onCommit: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string; label: string }): React.JSX.Element {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  const commit = (): void => {
    if (local !== value) onCommit(local)
  }
  return (
    <div className="slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{format ? format(local) : local}</output>
    </div>
  )
}

export function Select<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string }): React.JSX.Element {
  return (
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }): React.JSX.Element {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function TextField({ value, onCommit, placeholder, label, wide }: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string; wide?: boolean }): React.JSX.Element {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <input
      className={`field ${wide ? 'wide' : ''}`}
      aria-label={label}
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => local !== value && onCommit(local)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

const KEY_NAMES: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' }

export function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const pretty = value ? value.replace('CommandOrControl', 'Ctrl').replaceAll('+', ' + ') : 'Not set'
  return (
    <div className="inline">
      <button
        className="field"
        style={{ textAlign: 'left', width: 220, cursor: 'pointer', borderColor: recording ? 'var(--accent)' : undefined }}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return
          e.preventDefault()
          if (e.key === 'Escape') return setRecording(false)
          if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
          if (!e.ctrlKey && !e.metaKey && !e.altKey) return
          const parts = []
          if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
          if (e.altKey) parts.push('Alt')
          if (e.shiftKey) parts.push('Shift')
          parts.push(KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key))
          onChange(parts.join('+'))
          setRecording(false)
        }}
      >
        {recording ? 'Press a shortcut… (Esc to cancel)' : pretty}
      </button>
      {value && <button className="btn sm ghost" onClick={() => onChange('')}>Clear</button>}
    </div>
  )
}

export function useDevices(kind: 'audioinput' | 'audiooutput'): Array<{ value: string; label: string }> {
  const [devices, setDevices] = useState<Array<{ value: string; label: string }>>([{ value: 'default', label: 'System default' }])
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        const list = all
          .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications')
          .map((d, i) => ({ value: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${i + 1}` }))
        if (alive) setDevices([{ value: 'default', label: 'System default' }, ...list])
      } catch {
        /* keep default */
      }
    }
    void load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', load)
    }
  }, [kind])
  return devices
}
