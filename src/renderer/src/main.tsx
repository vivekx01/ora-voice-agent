import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import './styles/app.css'
import { useStore } from './store'
import { SttClient, TtsClient } from './voice/clients'
import { voice } from './voice/controller'

// Avoid a flash of the wrong theme before settings load.
document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
document.documentElement.dataset.accent = 'violet'

// Test hook: open the app with ?debug to drive it from automated tests.
if (location.search.includes('debug')) {
  ;(window as unknown as Record<string, unknown>).__ora = { TtsClient, SttClient, store: useStore, voice }
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
