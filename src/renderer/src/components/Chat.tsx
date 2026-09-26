import { CloudSun, Lightbulb, Timer, Wand2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useProviderReady, useStore } from '../store'
import { voice } from '../voice/controller'
import { Message } from './Message'
import { Orb } from './Orb'
import { Setup } from './Setup'

const SUGGESTIONS = [
  { icon: CloudSun, text: "What's the weather like in Mumbai today?" },
  { icon: Timer, text: 'Set a timer for five minutes for the tea.' },
  { icon: Lightbulb, text: 'Explain how noise cancelling headphones work.' },
  { icon: Wand2, text: 'What is 18 percent of 2,450 rupees?' }
]

function Hero(): React.JSX.Element {
  const state = useStore((s) => s.voice)
  const userName = useStore((s) => s.settings.agent.userName)
  const enginesReady = useStore((s) => s.tts.state === 'ready' && s.stt.state === 'ready')
  const providerReady = useProviderReady()
  const ready = enginesReady && providerReady

  return (
    <div className="hero">
      <button className="orb-hero" onClick={() => (ready ? voice.enterVoiceMode() : undefined)} aria-label="Start voice mode" style={{ borderRadius: '50%', lineHeight: 0 }}>
        <Orb size={230} state={state} />
      </button>
      <h1>{userName ? `Hi ${userName}. What's up?` : "Hi, what's up?"}</h1>
      <p>{ready ? 'Tap the orb and just talk, or type below. I can check the weather, search the web, set timers, do math and more.' : 'Let’s get everything set up. It only takes a minute.'}</p>
      {ready ? (
        <div className="suggest">
          {SUGGESTIONS.map(({ icon: Icon, text }) => (
            <button key={text} onClick={() => void voice.submitText(text)}>
              <Icon size={16} />
              <span>{text}</span>
            </button>
          ))}
        </div>
      ) : null}
      <Setup />
    </div>
  )
}

export function Chat(): React.JSX.Element {
  const messages = useStore((s) => s.active.messages)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div
      className="chat-scroll"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      }}
    >
      <div className="chat-col">
        {messages.length === 0 ? (
          <Hero />
        ) : (
          messages.map((m, i) => <Message key={m.id} message={m} isLast={i === messages.length - 1} />)
        )}
      </div>
    </div>
  )
}
