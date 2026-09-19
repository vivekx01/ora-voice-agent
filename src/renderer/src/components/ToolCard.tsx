import {
  Ban, BookOpen, Brain, Calculator, Check, ChevronDown, ChevronRight, Clock, ClipboardList, CloudSun, Cpu, ExternalLink,
  FileSearch, FileText, Folder, FilePen, Globe, Loader2, ShieldCheck, Terminal, Timer, Wrench, X
} from 'lucide-react'
import { useState, type ComponentType } from 'react'
import type { ToolCallRecord } from '@shared/types'
import { useStore } from '../store'
import { voice } from '../voice/controller'

type Args = Record<string, unknown>

const META: Record<string, { icon: ComponentType<{ size?: number }>; label: string; summary: (a: Args) => string }> = {
  get_current_time: { icon: Clock, label: 'Time', summary: (a) => String(a.timezone ?? 'your time zone') },
  get_weather: { icon: CloudSun, label: 'Weather', summary: (a) => String(a.location ?? '') },
  web_search: { icon: Globe, label: 'Web search', summary: (a) => String(a.query ?? a.input ?? '') },
  wikipedia: { icon: BookOpen, label: 'Wikipedia', summary: (a) => String(a.topic ?? a.input ?? '') },
  calculator: { icon: Calculator, label: 'Calculator', summary: (a) => String(a.expression ?? a.input ?? '') },
  fetch_webpage: { icon: FileSearch, label: 'Read page', summary: (a) => String(a.url ?? '').replace(/^https?:\/\//, '') },
  set_timer: { icon: Timer, label: 'Timer', summary: (a) => `${a.seconds}s${a.label ? ` · ${a.label}` : ''}` },
  memory: { icon: Brain, label: 'Memory', summary: (a) => `${a.action}: ${a.text}` },
  system_info: { icon: Cpu, label: 'System info', summary: () => 'this computer' },
  clipboard_read: { icon: ClipboardList, label: 'Read clipboard', summary: () => '' },
  clipboard_write: { icon: ClipboardList, label: 'Copy to clipboard', summary: (a) => String(a.text ?? '').slice(0, 60) },
  open_url: { icon: ExternalLink, label: 'Open link', summary: (a) => String(a.url ?? '') },
  list_files: { icon: Folder, label: 'List files', summary: (a) => String(a.path ?? 'Ora folder') },
  read_file: { icon: FileText, label: 'Read file', summary: (a) => String(a.path ?? '') },
  write_file: { icon: FilePen, label: 'Write file', summary: (a) => String(a.path ?? '') },
  run_shell: { icon: Terminal, label: 'Run command', summary: (a) => String(a.command ?? '') }
}

function State({ call }: { call: ToolCallRecord }): React.JSX.Element {
  switch (call.status) {
    case 'running':
      return <span className="state"><Loader2 size={14} className="spin" /> Working</span>
    case 'awaiting_approval':
      return <span className="state warn"><ShieldCheck size={14} /> Needs approval</span>
    case 'denied':
      return <span className="state bad"><Ban size={14} /> Declined</span>
    case 'error':
      return <span className="state bad"><X size={14} /> Failed</span>
    default:
      return <span className="state ok"><Check size={14} /> {call.ms ? `${(call.ms / 1000).toFixed(1)}s` : 'Done'}</span>
  }
}

export function ToolCard({ call }: { call: ToolCallRecord }): React.JSX.Element {
  const showDetails = useStore((s) => s.settings.ui.showToolDetails)
  const approval = useStore((s) => s.approvals.find((a) => a.name === call.name))
  const [open, setOpen] = useState(showDetails)
  const meta = META[call.name] ?? { icon: Wrench, label: call.name, summary: () => '' }
  const Icon = meta.icon
  const args = (call.args ?? {}) as Args
  const waiting = call.status === 'awaiting_approval' && approval

  return (
    <div className={`tool ${call.status === 'awaiting_approval' ? 'awaiting' : ''}`}>
      <button className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ico"><Icon size={15} /></span>
        <span className="name">{meta.label}</span>
        <span className="sum">{meta.summary(args)}</span>
        <State call={call} />
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && (
        <div className="tool-body selectable">
          <h6>Input</h6>
          <pre>{JSON.stringify(call.args, null, 2)}</pre>
          {call.result !== undefined && (
            <>
              <h6>Result</h6>
              <pre>{call.result || '(empty)'}</pre>
            </>
          )}
        </div>
      )}
      {waiting && (
        <div className="approve-bar" role="alert">
          <span>{approval.summary}</span>
          <button className="btn sm" onClick={() => voice.resolveApproval(approval.approvalId, false)}>Deny</button>
          <button className="btn sm primary" onClick={() => voice.resolveApproval(approval.approvalId, true)}>Allow</button>
        </div>
      )}
    </div>
  )
}
