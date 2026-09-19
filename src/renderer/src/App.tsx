import { useEffect } from 'react'
import { Chat } from './components/Chat'
import { Dock } from './components/Dock'
import { SettingsModal } from './components/settings/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { Titlebar } from './components/Titlebar'
import { Toasts } from './components/Toasts'
import { useStore } from './store'
import { voice } from './voice/controller'

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return Boolean(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
}

export function App(): React.JSX.Element {
  const loaded = useStore((s) => s.loaded)
  const theme = useStore((s) => s.settings.ui.theme)
  const accent = useStore((s) => s.settings.ui.accent)

  useEffect(() => {
    void useStore.getState().init().then(() => {
      if (useStore.getState().models?.ready) void voice.boot()
    })
    return useStore.subscribe((state, prev) => {
      if (state.settings !== prev.settings) void voice.applySettings(prev.settings, state.settings)
    })
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.documentElement.dataset.accent = accent
      void window.ora.system.setWindowTheme(dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, accent])

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      if (e.code === 'Space' && !mod && !e.altKey && !e.repeat && s.settings.stt.mode === 'ptt' && !s.settingsOpen && !isTyping(e.target)) {
        e.preventDefault()
        void voice.pttDown()
      } else if (e.key === 'Escape' && !s.settingsOpen) {
        if (s.voice === 'thinking' || s.voice === 'speaking' || s.voice === 'hearing') voice.interrupt()
      } else if (mod && e.key === ',') {
        e.preventDefault()
        s.openSettings()
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        voice.interrupt()
        void s.newChat()
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        s.set({ sidebarOpen: !s.sidebarOpen })
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && useStore.getState().settings.stt.mode === 'ptt' && !isTyping(e.target)) void voice.pttUp()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  if (!loaded) return <div className="app" />

  return (
    <div className="app">
      <Titlebar />
      <Sidebar />
      <main className="main">
        <Chat />
        <Dock />
      </main>
      <SettingsModal />
      <Toasts />
    </div>
  )
}
