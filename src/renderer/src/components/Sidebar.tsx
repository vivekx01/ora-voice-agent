import { Plus, Settings, Trash2 } from 'lucide-react'
import type { ConversationSummary } from '@shared/types'
import { useStore } from '../store'
import { voice } from '../voice/controller'

function group(list: ConversationSummary[]): Array<{ label: string; items: ConversationSummary[] }> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  const day = 86_400_000
  const buckets: Record<string, ConversationSummary[]> = { Today: [], Yesterday: [], 'Previous 7 days': [], Older: [] }
  for (const c of list) {
    const age = today - c.updatedAt
    buckets[c.updatedAt >= today ? 'Today' : age <= day ? 'Yesterday' : age <= 7 * day ? 'Previous 7 days' : 'Older'].push(c)
  }
  return Object.entries(buckets).filter(([, items]) => items.length).map(([label, items]) => ({ label, items }))
}

export function Sidebar(): React.JSX.Element {
  const open = useStore((s) => s.sidebarOpen)
  const conversations = useStore((s) => s.conversations)
  const activeId = useStore((s) => s.active.id)
  const version = useStore((s) => s.version)
  const { newChat, openConversation, deleteConversation, openSettings } = useStore.getState()

  return (
    <aside className={`sidebar ${open ? '' : 'closed'}`} aria-hidden={!open}>
      <button className="new-chat" onClick={() => { voice.interrupt(); void newChat() }}>
        <Plus size={17} /> New chat <kbd>Ctrl N</kbd>
      </button>
      <nav className="history" aria-label="Conversations">
        {conversations.length === 0 && <div className="empty-history">Your conversations will show up here.</div>}
        {group(conversations).map((g) => (
          <div key={g.label}>
            <h6>{g.label}</h6>
            {g.items.map((c) => (
              <button key={c.id} className={`conv ${c.id === activeId ? 'active' : ''}`} onClick={() => { voice.interrupt(); void openConversation(c.id) }}>
                <span className="t">{c.title}</span>
                <span className="p">{c.preview}</span>
                <span className="del" role="button" aria-label="Delete conversation" onClick={(e) => { e.stopPropagation(); void deleteConversation(c.id) }}>
                  <Trash2 size={14} />
                </span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="side-foot">
        <button className="settings-link" onClick={() => openSettings()}>
          <Settings size={16} /> Settings
        </button>
        <span className="grow" style={{ flex: 'none' }}>v{version}</span>
      </div>
    </aside>
  )
}
