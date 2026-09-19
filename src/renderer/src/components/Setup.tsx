import { Check, Download, Key, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PROVIDERS, providerInfo, type DownloadProgress, type ProviderId } from '@shared/types'
import { useProviderReady, useStore } from '../store'
import { voice } from '../voice/controller'

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(0)} MB`

export function Setup(): React.JSX.Element | null {
  const models = useStore((s) => s.models)
  const provider = useStore((s) => s.settings.llm.provider)
  const providerReady = useProviderReady()
  const tts = useStore((s) => s.tts)
  const stt = useStore((s) => s.stt)
  const { setApiKey, selectProvider, refreshModels, toast, openSettings } = useStore.getState()
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [key, setKey] = useState('')
  const [checking, setChecking] = useState(false)
  const info = providerInfo(provider)

  useEffect(() => window.ora.models.onProgress(setProgress), [])

  const download = async (): Promise<void> => {
    setDownloading(true)
    const res = await window.ora.models.download()
    setDownloading(false)
    if (!res.ok) return void toast('error', res.error ?? 'Download failed')
    await refreshModels()
    void voice.boot()
  }

  const saveKey = async (): Promise<void> => {
    setChecking(true)
    const check = await window.ora.settings.checkKey(provider, key)
    if (!check.ok) {
      setChecking(false)
      return void toast('error', check.message)
    }
    await setApiKey(provider, key)
    setKey('')
    setChecking(false)
    toast('success', `${info.label} key saved`)
  }

  const enginesReady = tts.state === 'ready' && stt.state === 'ready'
  const modelsReady = models?.ready ?? false
  if (modelsReady && providerReady && enginesReady) return null

  const pct = progress && progress.overallTotal ? Math.round((progress.overallReceived / progress.overallTotal) * 100) : 0
  const engineNote = (e: typeof tts, name: string): string =>
    e.state === 'ready' ? `${name} ready on ${e.backend === 'webgpu' ? 'GPU' : 'CPU'}` : e.state === 'error' ? `${name} failed` : e.state === 'loading' ? `${name}: ${e.stage || 'loading'}` : ''

  return (
    <div className="setup">
      <div className={`step ${modelsReady ? 'done' : ''}`}>
        <div className="n">{modelsReady ? <Check size={16} /> : '1'}</div>
        <div>
          <h4>Voice engine</h4>
          <p>
            {modelsReady
              ? 'Supertonic voice files are on this device.'
              : downloading && progress
                ? `Downloading… ${mb(progress.overallReceived)} of ${mb(progress.overallTotal)}`
                : 'One-time download (about 380 MB). Everything runs on your device afterwards.'}
          </p>
          {downloading && <div className="bar"><i style={{ width: `${pct}%` }} /></div>}
        </div>
        {!modelsReady && (
          <button className="btn primary" disabled={downloading} onClick={() => void download()}>
            {downloading ? <Loader2 size={15} className="spin" /> : <Download size={15} />} {downloading ? `${pct}%` : 'Download'}
          </button>
        )}
      </div>

      <div className={`step ${providerReady ? 'done' : ''}`}>
        <div className="n">{providerReady ? <Check size={16} /> : '2'}</div>
        <div>
          <h4>Assistant brain</h4>
          <p>{providerReady ? `${info.label} is ready. Change it any time in Settings.` : `Choose a provider and add a key. It's stored encrypted on this computer.`}</p>
          {!providerReady && (
            <div className="inline" style={{ marginTop: 8 }}>
              <select className="select" style={{ width: 150, flex: 'none' }} aria-label="Provider" value={provider} onChange={(e) => void selectProvider(e.target.value as ProviderId)}>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {provider !== 'custom' && (
                <input
                  className="field wide"
                  type="password"
                  placeholder={info.keyPlaceholder}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && key && void saveKey()}
                  aria-label={`${info.label} API key`}
                />
              )}
            </div>
          )}
          {!providerReady && info.keyUrl && <p style={{ marginTop: 6 }}>Get a key at {info.keyUrl}</p>}
        </div>
        {!providerReady && (provider === 'custom' ? (
          <button className="btn primary" onClick={() => openSettings('model')}>Set up</button>
        ) : (
          <button className="btn primary" disabled={!key || checking} onClick={() => void saveKey()}>
            {checking ? <Loader2 size={15} className="spin" /> : <Key size={15} />} Save
          </button>
        ))}
      </div>

      <div className={`step ${enginesReady ? 'done' : ''}`}>
        <div className="n">{enginesReady ? <Check size={16} /> : '3'}</div>
        <div>
          <h4>Speech engines</h4>
          <p>
            {[engineNote(tts, 'Voice'), engineNote(stt, 'Hearing')].filter(Boolean).join(' · ') || (modelsReady ? 'Starting…' : 'Waiting for the voice engine.')}
          </p>
          {(tts.state === 'loading' || stt.state === 'loading') && (
            <div className="bar"><i style={{ width: `${Math.round(((tts.progress + stt.progress) / 2) * 100)}%` }} /></div>
          )}
          {(tts.state === 'error' || stt.state === 'error') && <p style={{ color: 'var(--bad)' }}>{tts.error ?? stt.error}</p>}
        </div>
        {(tts.state === 'loading' || stt.state === 'loading') && <Loader2 size={18} className="spin" style={{ color: 'var(--text-3)' }} />}
        {(tts.state === 'error' || stt.state === 'error') && <button className="btn" onClick={() => void voice.retry()}>Retry</button>}
      </div>
    </div>
  )
}
