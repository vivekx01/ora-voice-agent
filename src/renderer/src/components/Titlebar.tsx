import { PanelLeft } from 'lucide-react'
import { useProviderReady, useStore, type EngineStatus } from '../store'

function Pill({ label, status, onClick }: { label: string; status: EngineStatus; onClick?: () => void }): React.JSX.Element {
  const tone = status.state === 'ready' ? 'ok' : status.state === 'error' ? 'bad' : status.state === 'loading' ? 'busy' : ''
  const detail = status.state === 'ready' ? (status.backend === 'webgpu' ? 'GPU' : 'CPU') : status.state === 'loading' ? `${Math.round(status.progress * 100)}%` : status.state === 'error' ? 'error' : 'off'
  return (
    <button className={`pill ${tone}`} onClick={onClick} title={status.error ?? `${label}: ${status.state}`}>
      <span className="dot" />
      {label} · {detail}
    </button>
  )
}

export function Titlebar(): React.JSX.Element {
  const open = useStore((s) => s.sidebarOpen)
  const tts = useStore((s) => s.tts)
  const stt = useStore((s) => s.stt)
  const model = useStore((s) => s.settings.llm.model)
  const hasKey = useProviderReady()
  const { set, openSettings } = useStore.getState()

  return (
    <div className="titlebar">
      <button className="icon-btn" onClick={() => set({ sidebarOpen: !open })} title="Toggle sidebar (Ctrl+B)" aria-label="Toggle sidebar">
        <PanelLeft size={18} />
      </button>
      <div className="brand"><span className="brand-mark" /> Ora</div>
      <div className="grow" />
      <button className={`pill ${hasKey ? 'ok' : 'warn'}`} onClick={() => openSettings('model')} title="Change model">
        <span className="dot" />
        {hasKey ? model.split('/').pop() : 'Set up a model'}
      </button>
      <Pill label="Voice" status={tts} onClick={() => openSettings('voice')} />
      <Pill label="Hearing" status={stt} onClick={() => openSettings('listening')} />
    </div>
  )
}
