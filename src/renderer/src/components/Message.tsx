import { AlertTriangle, Copy, Keyboard, Mic, Volume2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { ChatMessage } from '@shared/types'
import { useStore } from '../store'
import { voice } from '../voice/controller'
import { ToolCard } from './ToolCard'

const seconds = (ms?: number): string => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`)

export function Message({ message, isLast }: { message: ChatMessage; isLast: boolean }): React.JSX.Element {
  const voiceState = useStore((s) => s.voice)
  const showLatency = useStore((s) => s.settings.ui.showLatency)
  const agentName = useStore((s) => s.settings.agent.name)
  const toast = useStore((s) => s.toast)

  if (message.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble selectable">{message.text}</div>
        <div className="via">{message.source === 'voice' ? <><Mic size={11} /> voice</> : <><Keyboard size={11} /> typed</>}</div>
      </div>
    )
  }

  const live = isLast && (voiceState === 'thinking' || voiceState === 'speaking')
  const empty = !message.text && !(message.toolCalls?.length) && !message.error
  const m = message.metrics

  return (
    <div className="msg assistant">
      <div className="assistant-row">
        <div className={`avatar ${live ? 'live' : ''}`} aria-hidden />
        <div className="a-body">
          <div className="a-name">{agentName || 'Ora'}</div>
          {message.toolCalls?.map((c) => <ToolCard key={c.callId + c.name} call={c} />)}
          {empty && live && <div className="typing" aria-label="Thinking"><i /><i /><i /></div>}
          {message.text && (
            <div className="prose selectable">
              <ReactMarkdown
                disallowedElements={['img']}
                components={{
                  a: ({ href, children }) => (
                    <a onClick={(e) => { e.preventDefault(); if (href) void window.ora.system.openExternal(href) }} href={href}>{children}</a>
                  )
                }}
              >
                {message.text}
              </ReactMarkdown>
              {live && voiceState === 'thinking' && <span className="cursor" />}
            </div>
          )}
          {message.error && (
            <div className="err-note"><AlertTriangle size={16} /><span className="selectable">{message.error}</span></div>
          )}
          {message.interrupted && <div className="interrupted">Interrupted</div>}
          {!live && message.text && (
            <div className="msg-actions">
              <button className="icon-btn" title="Read aloud" onClick={() => void voice.say(message.text.replace(/\s+/g, ' '), message.id)}><Volume2 size={15} /></button>
              <button className="icon-btn" title="Copy" onClick={() => { void navigator.clipboard.writeText(message.text); toast('success', 'Copied') }}><Copy size={15} /></button>
            </div>
          )}
          {showLatency && m && (m.firstAudioMs || m.totalMs) && (
            <div className="metrics">
              {m.sttMs !== undefined && <span className="chip">hear <b>{seconds(m.sttMs)}</b></span>}
              {m.firstTokenMs !== undefined && <span className="chip">think <b>{seconds(m.firstTokenMs)}</b></span>}
              {m.firstAudioMs !== undefined && <span className="chip">first word <b>{seconds(m.firstAudioMs)}</b></span>}
              {m.totalMs !== undefined && <span className="chip">total <b>{seconds(m.totalMs)}</b></span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
