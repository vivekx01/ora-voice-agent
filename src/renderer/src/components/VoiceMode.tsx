import { Keyboard, Mic, Square, X } from 'lucide-react'
import { useStore, type VoiceState } from '../store'
import { voice } from '../voice/controller'
import { Orb } from './Orb'

const LABEL: Record<VoiceState, string> = {
  booting: 'Getting ready…',
  idle: 'Tap the orb to talk',
  listening: 'Listening… go ahead',
  hearing: 'Listening…',
  transcribing: 'Transcribing…',
  thinking: 'Thinking…',
  speaking: 'Speaking…'
}

export function VoiceMode(): React.JSX.Element {
  const state = useStore((s) => s.voice)
  const micOn = useStore((s) => s.micOn)
  const mode = useStore((s) => s.settings.stt.mode)
  const busy = state === 'thinking' || state === 'speaking' || state === 'transcribing'

  const orbPress = (): void => {
    if (busy) return voice.interrupt()
    if (mode === 'vad') void voice.setMic(!micOn)
  }

  const Icon = busy ? Square : Mic

  return (
    <div className="voice-mode">
      <button className="icon-btn voice-exit" onClick={() => voice.exitVoiceMode()} aria-label="Exit voice mode" title="Exit voice mode (Esc)">
        <X size={18} />
      </button>

      <div className="voice-stage">
        <button
          className="voice-orb-btn"
          aria-label={mode === 'ptt' ? 'Hold to talk' : micOn ? 'Stop listening' : 'Start listening'}
          onClick={mode === 'vad' || busy ? orbPress : undefined}
          onPointerDown={mode === 'ptt' && !busy ? () => void voice.pttDown() : undefined}
          onPointerUp={mode === 'ptt' ? () => void voice.pttUp() : undefined}
          onPointerLeave={mode === 'ptt' && state === 'hearing' ? () => void voice.pttUp() : undefined}
        >
          <Orb size={280} state={state} />
          <Icon className="voice-orb-ico" size={30} />
        </button>

        <p className="voice-status" aria-live="polite">
          {LABEL[state]}
        </p>
      </div>

      <div className="voice-actions">
        {mode === 'vad' && state === 'hearing' && (
          <button className="voice-type-btn" onClick={() => void voice.stopListening()}>
            <Square size={13} />
            <span>Stop listening</span>
          </button>
        )}
        <button className="voice-type-btn" onClick={() => voice.exitVoiceMode()}>
          <Keyboard size={14} />
          <span>Type instead</span>
        </button>
      </div>
    </div>
  )
}
