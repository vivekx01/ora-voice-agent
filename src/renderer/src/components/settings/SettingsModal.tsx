import { AudioLines, Bot, Brain, Check, Cpu, Download, FolderOpen, Key, Loader2, Palette, Play, RefreshCw, Search, Sparkles, Trash2, Wrench, X, Mic } from 'lucide-react'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, PROVIDERS, STT_MODELS, SUPERTONIC_LANGUAGES, SUPERTONIC_VOICES, isProviderConfigured, providerInfo,
  type AccentName, type KeyCheck, type MemoryItem, type ModelInfo, type ProviderId, type ReasoningEffort, type ToolInfo
} from '@shared/types'
import { useStore, type SettingsTab } from '../../store'
import { voice } from '../../voice/controller'
import { Group, Row, Segmented, Select, ShortcutInput, Slider, TextField, Toggle, useDevices } from './controls'

const TABS: Array<{ id: SettingsTab; label: string; icon: ComponentType<{ size?: number }>; title: string; sub: string }> = [
  { id: 'model', label: 'Model', icon: Sparkles, title: 'Model & API', sub: 'The language model that thinks and decides when to use tools. Pick a provider and add its key.' },
  { id: 'voice', label: 'Voice', icon: AudioLines, title: 'Voice', sub: 'Supertonic runs on this device to speak the answers.' },
  { id: 'listening', label: 'Listening', icon: Mic, title: 'Listening', sub: 'How Ora hears you. Speech recognition runs on this device too.' },
  { id: 'tools', label: 'Tools', icon: Wrench, title: 'Tools & permissions', sub: 'What the assistant is allowed to do on your behalf.' },
  { id: 'agent', label: 'Assistant', icon: Bot, title: 'Assistant', sub: 'Personality, context and long-term memory.' },
  { id: 'appearance', label: 'Appearance', icon: Palette, title: 'Appearance', sub: 'Make it yours.' },
  { id: 'advanced', label: 'Advanced', icon: Cpu, title: 'Advanced', sub: 'Files, resets and credits.' }
]

const price = (m: ModelInfo | undefined): string => (!m ? '' : m.free ? 'free' : m.promptPerM ? `$${m.promptPerM.toFixed(2)} / $${(m.completionPerM ?? 0).toFixed(2)}` : '')

const MONOGRAM: Record<ProviderId, string> = { openrouter: 'OR', openai: 'AI', anthropic: 'An', google: 'G', custom: '⌘' }

const REASONING: Partial<Record<ProviderId, { hint: string; options: Array<{ value: ReasoningEffort; label: string }> }>> = {
  openrouter: {
    hint: 'Thinking models pause before speaking. Turn it off or low for snappy replies.',
    options: [{ value: 'default', label: 'Model default' }, { value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]
  },
  openai: {
    hint: 'Only applies to GPT-5 and o-series models. Minimal or Low answers much faster.',
    options: [{ value: 'default', label: 'Model default' }, { value: 'off', label: 'Minimal' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]
  },
  google: {
    hint: 'Off stops Gemini 2.5 Flash from thinking first, so it answers at once. Other models ignore this.',
    options: [{ value: 'default', label: 'Model default' }, { value: 'off', label: 'Off (2.5 Flash)' }]
  }
}

// ---------------- Model ----------------

function ProviderPicker(): React.JSX.Element {
  const { settings, keys, selectProvider } = useStore()
  return (
    <div className="prov-grid" role="radiogroup" aria-label="Provider">
      {PROVIDERS.map((p) => {
        const on = settings.llm.provider === p.id
        const ready = p.id === 'custom' ? settings.llm.customBaseUrl.trim().length > 0 && on : keys[p.id]
        return (
          <button key={p.id} role="radio" aria-checked={on} className={`prov ${on ? 'on' : ''}`} onClick={() => void selectProvider(p.id)}>
            <span className="mono">{MONOGRAM[p.id]}</span>
            <b>{p.label}</b>
            <span>{p.tagline}</span>
            {ready && <i className="ok" title="Ready" />}
          </button>
        )
      })}
    </div>
  )
}

function ModelTab(): React.JSX.Element {
  const { settings, keys, updateSettings, setApiKey, toast } = useStore()
  const provider = settings.llm.provider
  const info = providerInfo(provider)
  const configured = isProviderConfigured(settings.llm, keys)
  const hasKey = keys[provider]
  const [key, setKey] = useState('')
  const [check, setCheck] = useState<KeyCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [modelError, setModelError] = useState('')
  const [query, setQuery] = useState('')
  const baseUrl = provider === 'custom' ? settings.llm.customBaseUrl : ''

  useEffect(() => {
    setKey('')
    setCheck(null)
    setQuery('')
  }, [provider])

  useEffect(() => {
    let alive = true
    setModels(null)
    setModelError('')
    if (!configured && provider !== 'openrouter') {
      setModelError(provider === 'custom' ? 'Enter the server address above to load its models.' : 'Add an API key to see the models available to your account.')
      return () => { alive = false }
    }
    window.ora.providers.models(provider, { baseUrl: baseUrl || undefined }).then((m) => alive && setModels(m)).catch((e: Error) => alive && setModelError(e.message))
    return () => { alive = false }
  }, [provider, configured, baseUrl])

  const byId = useMemo(() => new Map((models ?? []).map((m) => [m.id, m])), [models])
  const current = byId.get(settings.llm.model)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (models ?? []).filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 80)
  }, [models, query])
  // Once the live list is known, only suggest models the account can actually use.
  const recommended = info.recommended.filter((r) => !models || byId.has(r.id))

  const test = async (): Promise<void> => {
    setBusy(true)
    setCheck(await window.ora.settings.checkKey(provider, key || undefined, baseUrl || undefined))
    setBusy(false)
  }
  const save = async (): Promise<void> => {
    setBusy(true)
    const res = await window.ora.settings.checkKey(provider, key, baseUrl || undefined)
    setCheck(res)
    if (res.ok) {
      await setApiKey(provider, key)
      setKey('')
      toast('success', `${info.label} key saved`)
    }
    setBusy(false)
  }

  const reasoning = REASONING[provider]

  return (
    <>
      <Group title="Provider">
        <ProviderPicker />
      </Group>

      <Group title={provider === 'custom' ? 'Server' : 'Credentials'}>
        {provider === 'custom' && (
          <Row label="Server address" hint="Any OpenAI-compatible server. Ollama is http://localhost:11434/v1 and LM Studio is http://localhost:1234/v1.">
            <TextField label="Server address" value={settings.llm.customBaseUrl} onCommit={(v) => void updateSettings({ llm: { customBaseUrl: v.trim() } })} />
          </Row>
        )}
        <Row label={provider === 'custom' ? 'API key (optional)' : 'API key'} hint={info.keyUrl ? `Stored encrypted on this computer. Create one at ${info.keyUrl}.` : 'Only needed if your server requires one. Stored encrypted on this computer.'} stack>
          <div className="inline">
            <input className="field wide" type="password" aria-label={`${info.label} API key`} placeholder={hasKey ? '••••••••••••••••  (saved, paste to replace)' : info.keyPlaceholder} value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn primary" disabled={!key || busy} onClick={() => void save()}>{busy ? <Loader2 size={15} className="spin" /> : <Key size={15} />} Save</button>
            <button className="btn" disabled={busy || (provider !== 'custom' && !key && !hasKey)} onClick={() => void test()}>Test</button>
            {hasKey && <button className="btn ghost danger" onClick={() => void setApiKey(provider, '').then(() => setCheck(null))}>Remove</button>}
          </div>
          {check && (
            <div className={`key-status ${check.ok ? 'ok' : 'bad'}`}>
              {check.ok ? <Check size={14} /> : <X size={14} />} {check.message}
              {check.ok && check.usage !== undefined && ` Used $${check.usage.toFixed(2)}${check.limit ? ` of $${check.limit}` : ''}.`}
            </div>
          )}
        </Row>
      </Group>

      <Group title="Model">
        <div className="model-current" style={{ marginTop: 10 }}>
          <Sparkles size={18} />
          <div>
            <b className="selectable">{settings.llm.model}</b>
            <small>{[current?.contextLength ? `${(current.contextLength / 1000).toFixed(0)}k context` : '', price(current) ? `${price(current)} per million tokens` : ''].filter(Boolean).join(' · ') || info.label}</small>
          </div>
        </div>
        <Row label="Model ID" hint="Pick from the lists below, or type any model your provider offers.">
          <TextField label="Model ID" value={settings.llm.model} onCommit={(v) => { if (v.trim()) void updateSettings({ llm: { model: v.trim() } }) }} />
        </Row>
        {recommended.length > 0 && (
          <div className="row stack" style={{ borderBottom: 0 }}>
            <div className="lab">Recommended for voice</div>
            <div className="rec-list">
              {recommended.map((r) => (
                <button key={r.id} className={`rec ${settings.llm.model === r.id ? 'on' : ''}`} onClick={() => void updateSettings({ llm: { model: r.id } })}>
                  <div>
                    <div className="id">{r.id}</div>
                    <div className="bl">{r.blurb}</div>
                  </div>
                  <span className="price">{price(byId.get(r.id))}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="row stack" style={{ borderBottom: 0 }}>
          <div className="lab">Browse available models {models && <span className="badge">{models.length}</span>}</div>
          {models && (
            <div className="inline" style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, color: 'var(--text-3)' }} />
              <input className="field wide" style={{ paddingLeft: 32 }} placeholder="Search models…" aria-label="Search models" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
          {modelError && <div className="key-status"><X size={14} /> {modelError}</div>}
          {!models && !modelError && <div className="key-status"><Loader2 size={14} className="spin" /> Loading models…</div>}
          {models && (
            <div className="model-list">
              {filtered.map((m) => (
                <button key={m.id} className={settings.llm.model === m.id ? 'on' : ''} onClick={() => void updateSettings({ llm: { model: m.id } })}>
                  <span className="mid">{m.id}</span>
                  {m.free && <span className="badge ok">free</span>}
                  <span className="mp">{price(m)}</span>
                </button>
              ))}
              {filtered.length === 0 && <div style={{ padding: 14, color: 'var(--text-3)' }}>No models match “{query}”.</div>}
            </div>
          )}
        </div>
      </Group>

      <Group title="Generation">
        <Row label="Creativity" hint={provider === 'anthropic' ? 'Lower is more precise. Claude accepts 0 to 1, so higher values are capped at 1.' : provider === 'openai' ? 'Not used by GPT-5 and o-series models, which only run at their default.' : 'Lower is more precise and predictable. Higher is more varied.'}><Slider label="Temperature" value={settings.llm.temperature} min={0} max={1.5} step={0.05} format={(v) => v.toFixed(2)} onCommit={(v) => void updateSettings({ llm: { temperature: v } })} /></Row>
        <Row label="Max reply length" hint="Caps the tokens per answer. Voice replies are short, so 700 is plenty."><Slider label="Max tokens" value={settings.llm.maxTokens} min={100} max={4000} step={50} onCommit={(v) => void updateSettings({ llm: { maxTokens: v } })} /></Row>
        {provider === 'openrouter' && (
          <Row label="Provider routing" hint="Latency picks the provider that answers fastest, which matters most for voice.">
            <Select label="Provider routing" value={settings.llm.providerSort} onChange={(v) => void updateSettings({ llm: { providerSort: v } })} options={[{ value: 'latency', label: 'Fastest response' }, { value: 'throughput', label: 'Highest throughput' }, { value: 'price', label: 'Lowest price' }, { value: 'default', label: 'OpenRouter default' }]} />
          </Row>
        )}
        {reasoning && (
          <Row label="Reasoning" hint={reasoning.hint}>
            <Select label="Reasoning" value={reasoning.options.some((o) => o.value === settings.llm.reasoning) ? settings.llm.reasoning : 'default'} onChange={(v) => void updateSettings({ llm: { reasoning: v } })} options={reasoning.options} />
          </Row>
        )}
      </Group>
    </>
  )
}

// ---------------- Voice ----------------

function VoiceTab(): React.JSX.Element {
  const { settings, updateSettings, tts } = useStore()
  const outputs = useDevices('audiooutput')
  const t = settings.tts
  const preview = (id: string): void => {
    void updateSettings({ tts: { voice: id } }).then(() => voice.say(`Hi, I'm ${SUPERTONIC_VOICES.find((v) => v.id === id)?.label}. This is how I sound.`))
  }
  return (
    <>
      <Group>
        <Row label="Speak replies aloud" hint="Turn off for a text-only assistant."><Toggle label="Speak replies" value={t.enabled} onChange={(v) => void updateSettings({ tts: { enabled: v } })} /></Row>
        <Row label="Engine status" hint={tts.state === 'ready' ? `Loaded in ${((tts.loadMs ?? 0) / 1000).toFixed(1)}s` : tts.error ?? 'Loading…'}>
          <span className={`pill ${tts.state === 'ready' ? 'ok' : tts.state === 'error' ? 'bad' : 'busy'}`}><span className="dot" />Supertonic 3 · {tts.backend === 'webgpu' ? 'GPU (WebGPU)' : tts.backend ? 'CPU (WASM)' : tts.state}</span>
        </Row>
      </Group>
      <Group title="Voice">
        <div className="voice-grid" style={{ marginTop: 12 }}>
          {SUPERTONIC_VOICES.map((v) => (
            <div key={v.id} className={`voice ${t.voice === v.id ? 'on' : ''}`}>
              <button style={{ width: '100%' }} onClick={() => void updateSettings({ tts: { voice: v.id } })} aria-label={`Use ${v.label}`}>
                <b>{v.label}</b>
                <span>{v.kind} · {v.id}</span>
              </button>
              <button className="play" onClick={() => preview(v.id)} aria-label={`Preview ${v.label}`}><Play size={12} fill="currentColor" /></button>
            </div>
          ))}
        </div>
      </Group>
      <Group title="Delivery">
        <Row label="Language" hint="Supertonic speaks 31 languages. “Auto” lets it guess from the text.">
          <Select label="Speech language" value={t.language} onChange={(v) => void updateSettings({ tts: { language: v } })} options={SUPERTONIC_LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} />
        </Row>
        <Row label="Speed"><Slider label="Speed" value={t.speed} min={0.7} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)}×`} onCommit={(v) => void updateSettings({ tts: { speed: v } })} /></Row>
        <Row label="Quality" hint="More denoising steps sound cleaner but take longer. 5 to 8 is the sweet spot."><Slider label="Quality steps" value={t.steps} min={2} max={12} step={1} format={(v) => `${v} steps`} onCommit={(v) => void updateSettings({ tts: { steps: v } })} /></Row>
        <Row label="Volume"><Slider label="Volume" value={t.volume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => void updateSettings({ tts: { volume: v } })} /></Row>
        <Row label="Output device"><Select label="Output device" value={settings.stt.outputDeviceId} onChange={(v) => void updateSettings({ stt: { outputDeviceId: v } })} options={outputs} /></Row>
      </Group>
      <Group title="Streaming">
        <Row label="First chunk size" hint="Shorter means speech starts sooner. Only affects sentences without punctuation."><Slider label="First chunk" value={t.firstChunkChars} min={40} max={200} step={10} format={(v) => `${v} chars`} onCommit={(v) => void updateSettings({ tts: { firstChunkChars: v } })} /></Row>
        <Row label="Max chunk size" hint="Long sentences are split so the voice never stalls."><Slider label="Max chunk" value={t.maxChunkChars} min={100} max={300} step={10} format={(v) => `${v} chars`} onCommit={(v) => void updateSettings({ tts: { maxChunkChars: v } })} /></Row>
      </Group>
    </>
  )
}

// ---------------- Listening ----------------

function ListeningTab(): React.JSX.Element {
  const { settings, updateSettings, stt } = useStore()
  const inputs = useDevices('audioinput')
  const s = settings.stt
  const model = STT_MODELS.find((m) => m.id === s.model)
  const languages = [{ value: 'auto', label: 'Detect automatically' }, ...['en', 'hi', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'ja', 'ko', 'zh', 'ar', 'tr', 'pl', 'id', 'vi'].map((c) => ({ value: c, label: new Intl.DisplayNames(['en'], { type: 'language' }).of(c) ?? c }))]
  return (
    <>
      <Group>
        <Row label="Engine status" hint={stt.state === 'ready' ? `Loaded in ${((stt.loadMs ?? 0) / 1000).toFixed(1)}s` : stt.error ?? `${stt.stage || 'Loading…'}`}>
          <span className={`pill ${stt.state === 'ready' ? 'ok' : stt.state === 'error' ? 'bad' : 'busy'}`}><span className="dot" />Whisper · {stt.backend === 'webgpu' ? 'GPU (WebGPU)' : stt.backend ? 'CPU (WASM)' : stt.state}</span>
        </Row>
      </Group>
      <Group title="Talking">
        <Row label="Mode" hint="Hands-free listens continuously and detects when you stop. Push-to-talk records only while you hold Space or the orb.">
          <Segmented value={s.mode} onChange={(v) => void updateSettings({ stt: { mode: v } })} options={[{ value: 'vad', label: 'Hands-free' }, { value: 'ptt', label: 'Push to talk' }]} />
        </Row>
        <Row label="Sensitivity" hint="Raise it if Ora misses quiet speech. Lower it in a noisy room.">
          <Segmented value={s.vadSensitivity} onChange={(v) => void updateSettings({ stt: { vadSensitivity: v } })} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
        </Row>
        <Row label="Pause before replying" hint="How long you have to be quiet before Ora decides you’re done."><Slider label="Silence" value={s.silenceMs} min={400} max={2000} step={100} format={(v) => `${(v / 1000).toFixed(1)}s`} onCommit={(v) => void updateSettings({ stt: { silenceMs: v } })} /></Row>
        <Row label="Interrupt by speaking" hint="Talk over the assistant to stop it. Works best with headphones; on speakers it may pick up its own voice."><Toggle label="Interrupt by speaking" value={s.bargeIn} onChange={(v) => void updateSettings({ stt: { bargeIn: v } })} /></Row>
        <Row label="Start listening on launch"><Toggle label="Start listening on launch" value={s.autoListen} onChange={(v) => void updateSettings({ stt: { autoListen: v } })} /></Row>
      </Group>
      <Group title="Recognition">
        <Row label="Speech model" hint={model?.note}>
          <Select label="Speech model" value={s.model} onChange={(v) => void updateSettings({ stt: { model: v } })} options={STT_MODELS.map((m) => ({ value: m.id, label: m.label }))} />
        </Row>
        {model?.multilingual && <Row label="Spoken language"><Select label="Spoken language" value={s.language} onChange={(v) => void updateSettings({ stt: { language: v } })} options={languages} /></Row>}
        <Row label="Microphone"><Select label="Microphone" value={s.micDeviceId} onChange={(v) => void updateSettings({ stt: { micDeviceId: v } })} options={inputs} /></Row>
      </Group>
      <Group title="Shortcuts">
        <Row label="Global hotkey" hint="Toggles the microphone from anywhere, even when Ora is in the background.">
          <ShortcutInput value={settings.general.globalHotkey} onChange={(v) => void updateSettings({ general: { globalHotkey: v } })} />
        </Row>
      </Group>
    </>
  )
}

// ---------------- Tools ----------------

function ToolsTab(): React.JSX.Element {
  const { settings, tools, updateSettings } = useStore()
  const categories = useMemo(() => {
    const map = new Map<string, ToolInfo[]>()
    for (const t of tools) map.set(t.category, [...(map.get(t.category) ?? []), t])
    return [...map.entries()]
  }, [tools])
  const enabled = (t: ToolInfo): boolean => settings.tools.enabled[t.id] ?? t.defaultEnabled
  return (
    <>
      <Group title="Permissions">
        <Row label="Ask before acting" hint="Sensitive tools (marked below) show an Allow / Deny prompt and Ora reads it out.">
          <Segmented value={settings.tools.approval} onChange={(v) => void updateSettings({ tools: { approval: v } })} options={[{ value: 'sensitive', label: 'Sensitive only' }, { value: 'always', label: 'Every tool' }, { value: 'never', label: 'Never' }]} />
        </Row>
        <Row label="Files folder" hint="The only place file tools can read and write.">
          <div className="inline">
            <TextField label="Files folder" value={settings.tools.sandboxDir} onCommit={(v) => void updateSettings({ tools: { sandboxDir: v } })} />
            <button className="btn" onClick={() => void window.ora.system.pickFolder().then((p) => { if (p) void updateSettings({ tools: { sandboxDir: p } }) })}><FolderOpen size={15} /> Browse</button>
          </div>
        </Row>
      </Group>
      {categories.map(([cat, list]) => (
        <Group key={cat} title={cat}>
          {list.map((t) => (
            <div className="tool-row" key={t.id}>
              <div>
                <div className="lab">{t.label} {t.sensitive && <span className="badge warn">asks first</span>}</div>
                <div className="hint" style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{t.description}</div>
              </div>
              <Toggle label={`Enable ${t.label}`} value={enabled(t)} onChange={(v) => void updateSettings({ tools: { enabled: { [t.id]: v } } })} />
            </div>
          ))}
        </Group>
      ))}
    </>
  )
}

// ---------------- Assistant ----------------

function AgentTab(): React.JSX.Element {
  const { settings, updateSettings } = useStore()
  const a = settings.agent
  const [prompt, setPrompt] = useState(a.systemPrompt)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  useEffect(() => setPrompt(a.systemPrompt), [a.systemPrompt])
  useEffect(() => void window.ora.memory.list().then(setMemories), [])
  return (
    <>
      <Group title="Identity">
        <Row label="Assistant name" hint="Used in the prompt and shown above replies."><TextField label="Assistant name" value={a.name} onCommit={(v) => void updateSettings({ agent: { name: v } })} /></Row>
        <Row label="Your name" hint="So it can address you naturally."><TextField label="Your name" value={a.userName} placeholder="Optional" onCommit={(v) => void updateSettings({ agent: { userName: v } })} /></Row>
      </Group>
      <Group title="Behavior">
        <Row label="Conversation memory" hint="How many recent exchanges the assistant remembers within a chat."><Slider label="History turns" value={a.historyTurns} min={2} max={30} step={1} format={(v) => `${v} turns`} onCommit={(v) => void updateSettings({ agent: { historyTurns: v } })} /></Row>
        <Row label="Max tool steps" hint="Stops runaway loops when several tools are chained."><Slider label="Max tool steps" value={a.maxToolSteps} min={1} max={12} step={1} onCommit={(v) => void updateSettings({ agent: { maxToolSteps: v } })} /></Row>
        <Row label="Use long-term memory" hint="Include the facts you asked it to remember in every chat."><Toggle label="Use long-term memory" value={a.useMemory} onChange={(v) => void updateSettings({ agent: { useMemory: v } })} /></Row>
      </Group>
      <Group title="System prompt">
        <Row label="Instructions" hint="Placeholders: {{name}}, {{user}}, {{datetime}}, {{locale}}." stack>
          <textarea className="textarea selectable" aria-label="System prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={() => prompt !== a.systemPrompt && void updateSettings({ agent: { systemPrompt: prompt } })} />
          <div><button className="btn sm" onClick={() => { setPrompt(DEFAULT_SYSTEM_PROMPT); void updateSettings({ agent: { systemPrompt: DEFAULT_SYSTEM_PROMPT } }) }}><RefreshCw size={13} /> Restore default</button></div>
        </Row>
      </Group>
      <Group title="Things I remember">
        {memories.length === 0 && <div className="note" style={{ marginTop: 10 }}>Nothing yet. Say “remember that I prefer Celsius” and it will show up here.</div>}
        <div style={{ marginTop: 10 }}>
          {memories.map((m) => (
            <div className="mem" key={m.id}>
              <Brain size={15} style={{ color: 'var(--accent)' }} />
              <span className="selectable">{m.text}</span>
              <button className="icon-btn" aria-label="Forget" onClick={() => void window.ora.memory.remove(m.id).then(() => setMemories((x) => x.filter((i) => i.id !== m.id)))}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        {memories.length > 0 && <button className="btn sm danger" onClick={() => void window.ora.memory.clear().then(() => setMemories([]))}>Forget everything</button>}
      </Group>
    </>
  )
}

// ---------------- Appearance ----------------

const ACCENTS: Array<{ id: AccentName; color: string }> = [
  { id: 'violet', color: 'hsl(252 100% 72%)' }, { id: 'blue', color: 'hsl(216 100% 66%)' }, { id: 'teal', color: 'hsl(172 80% 52%)' },
  { id: 'rose', color: 'hsl(340 100% 70%)' }, { id: 'amber', color: 'hsl(36 100% 60%)' }
]

function AppearanceTab(): React.JSX.Element {
  const { settings, updateSettings } = useStore()
  return (
    <Group>
      <Row label="Theme"><Segmented value={settings.ui.theme} onChange={(v) => void updateSettings({ ui: { theme: v } })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></Row>
      <Row label="Accent colour">
        <div className="swatches">
          {ACCENTS.map((a) => <button key={a.id} className={`swatch ${settings.ui.accent === a.id ? 'on' : ''}`} style={{ background: a.color }} aria-label={a.id} onClick={() => void updateSettings({ ui: { accent: a.id } })} />)}
        </div>
      </Row>
      <Row label="Live captions" hint="Show the sentence being spoken under the orb."><Toggle label="Live captions" value={settings.ui.liveCaptions} onChange={(v) => void updateSettings({ ui: { liveCaptions: v } })} /></Row>
      <Row label="Latency readout" hint="Show hear / think / first word / total timings under each reply."><Toggle label="Latency readout" value={settings.ui.showLatency} onChange={(v) => void updateSettings({ ui: { showLatency: v } })} /></Row>
      <Row label="Expand tool details" hint="Open tool cards by default to see inputs and results."><Toggle label="Expand tool details" value={settings.ui.showToolDetails} onChange={(v) => void updateSettings({ ui: { showToolDetails: v } })} /></Row>
      <Row label="Keep window on top"><Toggle label="Keep window on top" value={settings.general.alwaysOnTop} onChange={(v) => void updateSettings({ general: { alwaysOnTop: v } })} /></Row>
    </Group>
  )
}

// ---------------- Advanced ----------------

function AdvancedTab(): React.JSX.Element {
  const { models, updateSettings, refreshModels, toast, version } = useStore()
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Group title="On-device voice files">
        <Row label="Supertonic 3 models" hint={models?.ready ? 'All files present.' : `${models?.missing.length ?? '?'} file(s) missing.`} stack>
          <div className="note selectable" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{models?.dir}</div>
          <div className="inline">
            <button className="btn" disabled={busy || models?.ready} onClick={() => { setBusy(true); void window.ora.models.download().then(async (r) => { setBusy(false); await refreshModels(); toast(r.ok ? 'success' : 'error', r.ok ? 'Voice files downloaded' : r.error ?? 'Download failed') }) }}>
              {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Download missing files
            </button>
            <button className="btn ghost" onClick={() => void refreshModels()}><RefreshCw size={15} /> Re-check</button>
          </div>
        </Row>
      </Group>
      <Group title="Troubleshooting">
        <Row label="Reset GPU cache" hint="If voice or hearing shows CPU mode, is very slow, or says the GPU was reset, clear the saved GPU shader cache and restart Ora.">
          <button className="btn" onClick={() => void window.ora.system.resetGpuCache()}><RefreshCw size={15} /> Reset &amp; restart</button>
        </Row>
      </Group>
      <Group title="Reset">
        <Row label="Reset all settings" hint="Restores defaults. Your chats, memories and API key are kept.">
          <button className="btn danger" onClick={() => void window.ora.settings.reset().then((s) => { useStore.getState().set({ settings: s }); toast('success', 'Settings reset') })}>Reset</button>
        </Row>
        <Row label="Defaults preview" hint={`Model ${DEFAULT_SETTINGS.llm.model}, voice ${DEFAULT_SETTINGS.tts.voice}, hands-free listening.`}>
          <button className="btn" onClick={() => void updateSettings({ llm: { model: DEFAULT_SETTINGS.llm.model } })}>Use default model</button>
        </Row>
      </Group>
      <Group title="About">
        <div className="note" style={{ marginTop: 10, lineHeight: 1.7 }}>
          <b>Ora {version}</b><br />
          Voice: Supertonic 3 (Supertone). Hearing: Whisper via Transformers.js, with Silero voice detection. Brain: LangGraph + LangChain through OpenRouter. Speech models run on your GPU with WebGPU; your audio never leaves this computer, only the text of your requests goes to OpenRouter.
        </div>
      </Group>
    </>
  )
}

// ---------------- Modal ----------------

export function SettingsModal(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  const tab = useStore((s) => s.settingsTab)
  const set = useStore((s) => s.set)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') set({ settingsOpen: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, set])
  if (!open) return null
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]
  const Body = { model: ModelTab, voice: VoiceTab, listening: ListeningTab, tools: ToolsTab, agent: AgentTab, appearance: AppearanceTab, advanced: AdvancedTab }[active.id]

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && set({ settingsOpen: false })}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
        <nav className="modal-nav">
          <h2>Settings</h2>
          {TABS.map((t) => (
            <button key={t.id} className={`nav-item ${t.id === active.id ? 'active' : ''}`} onClick={() => set({ settingsTab: t.id })}>
              <t.icon size={17} /> <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="modal-main">
          <div className="modal-head">
            <div>
              <h3>{active.title}</h3>
              <p>{active.sub}</p>
            </div>
            <button className="icon-btn" aria-label="Close settings" onClick={() => set({ settingsOpen: false })}><X size={18} /></button>
          </div>
          <div className="modal-body"><Body /></div>
        </div>
      </div>
    </div>
  )
}
