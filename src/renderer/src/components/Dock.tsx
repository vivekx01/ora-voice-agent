import { ArrowUp, AudioLines, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore, type VoiceState } from '../store'
import { voice } from '../voice/controller'
import { Orb } from './Orb'

const LABEL: Record<VoiceState, string> = {
  booting: 'Getting ready…',
  idle: 'Tap the orb to talk, or type a message',
  listening: 'Listening… go ahead',
  hearing: 'Listening…',
  transcribing: 'Transcribing…',
  thinking: 'Thinking…',
  speaking: 'Speaking…'
}

export function Dock(): React.JSX.Element {
  const state = useStore((s) => s.voice)
  const micOn = useStore((s) => s.micOn)
  const caption = useStore((s) => s.caption)
  const mode = useStore((s) => s.settings.stt.mode)
  const liveCaptions = useStore((s) => s.settings.ui.liveCaptions)
  const sttReady = useStore((s) => s.stt.state === 'ready')
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const busy = state === 'thinking' || state === 'speaking' || state === 'transcribing'

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])

  const send = (): void => {
    if (busy && !text.trim()) return voice.interrupt()
    if (!text.trim()) return
    void voice.submitText(text)
    setText('')
  }

  const orbPress = (): void => {
    if (busy) return voice.interrupt()
    if (mode === 'vad') voice.enterVoiceMode()
  }

  const label = liveCaptions && caption ? caption : LABEL[state]
  const Icon = busy ? Square : micOn ? AudioLines : Mic
  const showDot = state !== 'booting'

  return (
    <div className="dock-wrap">
      <div className="dock">
        <div className={`caption ${state}`} aria-live="polite">
          {showDot && <span className="state-dot" />}
          <span className="cap-text">{label}</span>
        </div>
        <div className="composer">
          <button
            className="orb-btn"
            aria-label={mode === 'ptt' ? 'Hold to talk' : micOn ? 'Stop listening' : 'Start listening'}
            title={mode === 'ptt' ? 'Hold to talk' : micOn ? 'Stop listening' : 'Start listening'}
            disabled={!sttReady && !busy}
            onClick={mode === 'vad' || busy ? orbPress : undefined}
            onPointerDown={
              mode === 'ptt' && !busy
                ? () => {
                    voice.enterVoiceMode()
                    void voice.pttDown()
                  }
                : undefined
            }
            onPointerUp={mode === 'ptt' ? () => void voice.pttUp() : undefined}
            onPointerLeave={mode === 'ptt' && state === 'hearing' ? () => void voice.pttUp() : undefined}
          >
            <Orb size={88} state={state} />
            <Icon className="orb-ico" size={22} />
          </button>
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder="Type a message…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            aria-label="Message"
          />
          <button className={`send ${busy && !text.trim() ? 'stop' : ''}`} onClick={send} disabled={!busy && !text.trim()} aria-label={busy && !text.trim() ? 'Stop' : 'Send'}>
            {busy && !text.trim() ? <Square size={16} fill="currentColor" /> : <ArrowUp size={19} />}
          </button>
        </div>
        <div className="hints">
          {mode === 'ptt' ? <span><kbd>Space</kbd> hold to talk</span> : <span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Space</kbd> toggle mic anywhere</span>}
          <span><kbd>Esc</kbd> stop</span>
          <span>Talk over me to interrupt</span>
        </div>
      </div>
    </div>
  )
}
