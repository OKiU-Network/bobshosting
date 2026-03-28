'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api, FileEntry, ServerRecord, TemplateRecord, UserProfile } from '@/lib/api'

type Tab = 'console' | 'files' | 'network' | 'startup' | 'settings'

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-emerald-500',
  stopped: 'bg-slate-500',
  installing: 'bg-amber-500',
  error: 'bg-rose-500'
}

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [server, setServer] = useState<ServerRecord | null>(null)
  const [tab, setTab] = useState<Tab>('console')
  const [error, setError] = useState('')

  async function loadServer() {
    try {
      const s = await api.servers.get(id)
      setServer(s)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => { loadServer() }, [id])

  // Poll status + sync with agent every 4s while installing
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const updated = await api.servers.syncStatus(id)
        setServer(updated)
        if (updated.status !== 'installing') clearInterval(interval)
      } catch {}
    }, 4000)
    return () => clearInterval(interval)
  }, [id])

  async function onPower(action: 'start' | 'stop' | 'restart') {
    try {
      const updated = await api.servers.power(id, action)
      setServer(updated)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (error) return (
    <div className="p-6">
      <p className="text-rose-400">{error}</p>
      <button className="mt-2 text-sm text-slate-400 hover:text-slate-200" onClick={() => router.back()}>← Back</button>
    </div>
  )

  if (!server) return <div className="p-6 text-sm text-slate-500">Loading…</div>

  const TABS: { id: Tab; label: string }[] = [
    { id: 'console', label: 'Console' },
    { id: 'files', label: 'File Manager' },
    { id: 'network', label: 'Network' },
    { id: 'startup', label: 'Startup' },
    { id: 'settings', label: 'Settings' }
  ]

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[server.status] ?? 'bg-slate-500'}`} />
            <h1 className="text-lg font-semibold text-slate-100">{server.name}</h1>
            <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-400 capitalize">{server.status}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onPower('start')} className="rounded-lg border border-emerald-700 bg-emerald-900/30 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-700 hover:text-white transition-colors">Start</button>
            <button onClick={() => onPower('restart')} className="rounded-lg border border-amber-700 bg-amber-900/30 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-700 hover:text-white transition-colors">Restart</button>
            <button onClick={() => onPower('stop')} className="rounded-lg border border-rose-700 bg-rose-900/30 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-700 hover:text-white transition-colors">Stop</button>
          </div>
        </div>
        <div className="mt-3 flex gap-6 text-xs text-slate-400">
          <span>CPU: <strong className="text-slate-200">{server.cpuLimit}%</strong></span>
          <span>RAM: <strong className="text-slate-200">{server.memoryMb} MB</strong></span>
          <span>Disk: <strong className="text-slate-200">{server.diskMb} MB</strong></span>
          <span>Ports: <strong className="text-slate-200">{server.allocatedPorts.join(', ') || '—'}</strong></span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'console' && <ConsoleTab serverId={id} server={server} />}
        {tab === 'files' && <FilesTab serverId={id} />}
        {tab === 'network' && <NetworkTab serverId={id} server={server} onRefresh={loadServer} />}
        {tab === 'startup' && <StartupTab serverId={id} server={server} />}
        {tab === 'settings' && <SettingsTab serverId={id} server={server} onRefresh={loadServer} onDeleted={() => router.replace('/panel')} />}
      </div>
    </div>
  )
}

/* ── Console Tab ─────────────────────────────────────────── */

function ConsoleTab({ serverId, server }: { serverId: string; server: ServerRecord }) {
  const [lines, setLines] = useState<string[]>([])
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      const newLines = await api.servers.logs(serverId)
      setLines(newLines)
    } catch {}
  }, [serverId])

  useEffect(() => {
    fetchLogs()
    intervalRef.current = setInterval(fetchLogs, 3000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchLogs])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  async function onSendCommand(e: React.FormEvent) {
    e.preventDefault()
    if (!command.trim()) return
    setRunning(true)
    const sent = command
    setCommand('')
    try {
      await api.servers.command(serverId, sent)
      // Refresh logs after a short delay so server output shows up
      setTimeout(fetchLogs, 600)
      setTimeout(fetchLogs, 2000)
    } catch (err) {
      setLines(prev => [...prev, `[Error] ${(err as Error).message}`])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 text-xs text-slate-500">
        <span>Console — {server.name} ({server.status})</span>
        <button onClick={fetchLogs} className="text-slate-400 hover:text-slate-200">↻ Refresh</button>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs leading-5">
        {lines.length === 0 ? (
          <span className="text-slate-600">No output yet. Server may still be starting.</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${line.startsWith('$') ? 'text-indigo-300' : line.startsWith('[Error]') ? 'text-rose-400' : 'text-slate-300'}`}>
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Command input */}
      <form onSubmit={onSendCommand} className="border-t border-slate-800 bg-slate-900 px-4 py-3 space-y-1">
        <p className="text-[10px] text-slate-500">
          Commands are sent directly to the server's stdin (e.g. <span className="font-mono text-slate-400">/stop</span>, <span className="font-mono text-slate-400">save-all</span>, <span className="font-mono text-slate-400">list</span>)
        </p>
        <div className="flex gap-2">
          <span className="mt-2 text-xs text-emerald-400 font-mono">›</span>
          <input
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
            value={command}
            onChange={e => setCommand(e.target.value)}
            placeholder={server.status === 'running' ? 'Type server command and press Enter…' : 'Server is not running'}
            disabled={running}
          />
          <button
            type="submit"
            disabled={running || !command.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {running ? '…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ── Files Tab ───────────────────────────────────────────── */

function FilesTab({ serverId }: { serverId: string }) {
  const [cwd, setCwd] = useState('.')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [editPath, setEditPath] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const protectedFilenames = new Set(['.resource-profile.json', '.startup-command', '.status'])

  async function loadDir(dir: string) {
    setError('')
    try {
      const list = await api.servers.files.list(serverId, dir === '.' ? undefined : dir)
      setEntries(list.filter(e => !protectedFilenames.has(e.name)))
      setCwd(dir)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => { loadDir('.') }, [serverId])

  async function openFile(name: string) {
    if (protectedFilenames.has(name)) return setError('This file is protected')
    const filePath = cwd === '.' ? name : `${cwd}/${name}`
    setEditLoading(true)
    try {
      const content = await api.servers.files.read(serverId, filePath)
      setEditPath(filePath)
      setEditContent(content)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEditLoading(false)
    }
  }

  async function saveFile() {
    if (!editPath) return
    setSaving(true)
    try {
      await api.servers.files.write(serverId, editPath, editContent)
      await loadDir(cwd)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function deletePath(name: string) {
    if (protectedFilenames.has(name)) return setError('This file is protected')
    const target = cwd === '.' ? name : `${cwd}/${name}`
    if (!confirm(`Delete ${name}?`)) return
    try {
      await api.servers.files.delete(serverId, target)
      await loadDir(cwd)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function createFolder() {
    if (!newName.trim()) return
    const target = cwd === '.' ? newName : `${cwd}/${newName}`
    try {
      await api.servers.files.mkdir(serverId, target)
      setNewName('')
      await loadDir(cwd)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function navigateUp() {
    if (cwd === '.') return
    const parts = cwd.split('/')
    parts.pop()
    loadDir(parts.length === 0 ? '.' : parts.join('/'))
  }

  return (
    <div className="flex h-full">
      {/* File browser */}
      <div className="w-72 shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="border-b border-slate-800 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="truncate text-xs font-mono text-slate-400">/{cwd === '.' ? '' : cwd}</span>
            <button onClick={() => loadDir(cwd)} className="text-xs text-slate-500 hover:text-slate-200">↻</button>
          </div>
          {cwd !== '.' && (
            <button onClick={navigateUp} className="mt-1 text-xs text-indigo-400 hover:text-indigo-200">← Parent</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 && (
            <p className="px-3 py-4 text-xs text-slate-600">Empty directory</p>
          )}
          {entries.map(entry => (
            <div key={entry.name} className="group flex items-center justify-between px-3 py-1.5 hover:bg-slate-800">
              <button
                className="flex items-center gap-2 text-left text-sm truncate"
                onClick={() => entry.kind === 'directory' ? loadDir(cwd === '.' ? entry.name : `${cwd}/${entry.name}`) : openFile(entry.name)}
              >
                <span className="text-base">{entry.kind === 'directory' ? '📁' : '📄'}</span>
                <span className={`truncate ${entry.kind === 'directory' ? 'text-indigo-300' : 'text-slate-300'}`}>{entry.name}</span>
              </button>
              <button
                className="ml-2 shrink-0 text-rose-500 opacity-0 group-hover:opacity-100 text-xs hover:text-rose-300"
                onClick={() => deletePath(entry.name)}
              >✕</button>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-800 px-3 py-2 flex gap-2">
          <input
            className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
            placeholder="folder-name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createFolder()}
          />
          <button onClick={createFolder} className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-400 hover:bg-slate-700">+ Folder</button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col bg-slate-950">
        {error && <div className="border-b border-rose-800 bg-rose-950 px-4 py-2 text-xs text-rose-300">{error}</div>}
        {editPath ? (
          <>
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2">
              <span className="text-xs font-mono text-slate-400">{editPath}</span>
              <button
                onClick={saveFile}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {editLoading ? (
              <p className="p-4 text-xs text-slate-500">Loading…</p>
            ) : (
              <textarea
                className="flex-1 bg-slate-950 px-4 py-3 font-mono text-xs text-slate-200 focus:outline-none resize-none"
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                spellCheck={false}
              />
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-slate-600">Select a file to edit</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Network Tab ─────────────────────────────────────────── */

function NetworkTab({ serverId, server, onRefresh }: { serverId: string; server: ServerRecord; onRefresh: () => void }) {
  const [ports, setPorts] = useState<number[]>(server.allocatedPorts)
  const [amount, setAmount] = useState(1)
  const [error, setError] = useState('')

  async function allocate() {
    try {
      const result = await api.servers.network.allocate(serverId, amount)
      setPorts(result.ports)
      onRefresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function release(port: number) {
    try {
      const result = await api.servers.network.release(serverId, [port])
      setPorts(result.ports)
      onRefresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Network Allocations</h2>
        <p className="text-sm text-slate-400">Ports bound to this server.</p>
      </div>

      {error && <div className="rounded-lg border border-rose-800 bg-rose-950 px-3 py-2 text-sm text-rose-300">{error}</div>}

      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        {ports.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No ports allocated</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-800">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Port</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Protocol</th>
              <th className="px-4 py-3" />
            </tr></thead>
            <tbody className="divide-y divide-slate-800">
              {ports.map(port => (
                <tr key={port}>
                  <td className="px-4 py-3 font-mono text-slate-200">{port}</td>
                  <td className="px-4 py-3 text-slate-400">TCP/UDP</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => release(port)} className="text-xs text-rose-400 hover:text-rose-200">Release</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Allocate Ports</label>
          <input
            type="number" min={1} max={10}
            className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            value={amount}
            onChange={e => setAmount(Number(e.target.value))}
          />
        </div>
        <button onClick={allocate} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          Allocate
        </button>
      </div>
    </div>
  )
}

/* ── Startup Tab ─────────────────────────────────────────── */

function StartupTab({ serverId, server }: { serverId: string; server: ServerRecord }) {
  const [template, setTemplate] = useState<TemplateRecord | null>(null)
  const [startupCmd, setStartupCmd] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    api.templates.list().then(templates => {
      const t = templates.find(t => t.id === server.templateId)
      if (t) {
        setTemplate(t)
        setStartupCmd(t.startupCommand)
      }
    })
    api.servers.startup.get(serverId).then(setStartupCmd).catch(() => {})
  }, [serverId, server.templateId])

  async function saveStartup() {
    await api.servers.startup.set(serverId, startupCmd)
    setSaved('Saved')
    setTimeout(() => setSaved(''), 2000)
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Startup Configuration</h2>
        <p className="text-sm text-slate-400">Startup command and environment variables for this server.</p>
      </div>

      {template && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
          <p className="text-xs font-medium text-slate-400">Template</p>
          <p className="text-sm text-slate-100">{template.name}</p>
          {template.eggDescription && (
            <p className="text-xs text-slate-500 leading-relaxed">{template.eggDescription}</p>
          )}
          {server.dockerImageKey && template.dockerImages?.[server.dockerImageKey] ? (
            <div className="pt-1 space-y-1">
              <p className="text-xs text-slate-500">Selected version: <span className="text-slate-300">{server.dockerImageKey}</span></p>
              <p className="text-xs font-mono text-slate-400 break-all">{template.dockerImages[server.dockerImageKey]}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Default image: <span className="font-mono text-slate-400">{template.image}</span></p>
          )}
          {template.sourcePath && (
            <p className="text-xs text-slate-600">Pterodactyl egg: {template.sourcePath}</p>
          )}
        </div>
      )}

      <div>
        <label className="mb-2 block text-xs font-medium text-slate-400">Startup Command</label>
        <textarea
          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          rows={4}
          value={startupCmd}
          onChange={e => setStartupCmd(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={saveStartup} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Save
          </button>
          {saved && <span className="text-xs text-emerald-400">{saved}</span>}
        </div>
      </div>

      {template && Object.keys(template.env).length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-400">Template Environment Variables</p>
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-800">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase text-slate-500">Variable</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase text-slate-500">Default</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800">
                {Object.entries(template.env).map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-4 py-2.5 font-mono text-slate-300">{k}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-400">{v || '(empty)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Settings Tab ────────────────────────────────────────── */

function SettingsTab({
  serverId,
  server,
  onRefresh,
  onDeleted
}: {
  serverId: string
  server: ServerRecord
  onRefresh: () => void
  onDeleted: () => void
}) {
  const [me, setMe] = useState<UserProfile | null>(null)
  const [panelUsers, setPanelUsers] = useState<UserProfile[]>([])
  const [ownerId, setOwnerId] = useState(server.ownerId)
  const [cpuLimit, setCpuLimit] = useState(server.cpuLimit)
  const [memoryMb, setMemoryMb] = useState(server.memoryMb)
  const [diskMb, setDiskMb] = useState(server.diskMb)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [deleting, setDeleting] = useState(false)

  const isAdmin = me?.role === 'admin'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const profile = await api.me()
        if (cancelled) return
        setMe(profile)
        if (profile.role === 'admin') {
          const users = await api.admin.users.list()
          if (!cancelled) setPanelUsers(users)
        }
      } catch {
        if (!cancelled) setMe(null)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setOwnerId(server.ownerId)
    setCpuLimit(server.cpuLimit)
    setMemoryMb(server.memoryMb)
    setDiskMb(server.diskMb)
  }, [server.ownerId, server.cpuLimit, server.memoryMb, server.diskMb])

  async function onChangePlan(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess('')
    try {
      await api.servers.updateResources(serverId, { cpuLimit, memoryMb, diskMb })
      setSuccess('Resources updated')
      onRefresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function onAssignOwner(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess('')
    try {
      await api.servers.assignOwner(serverId, ownerId)
      setSuccess('Owner updated')
      onRefresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function onDelete() {
    if (!confirm(`Permanently delete "${server.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await api.servers.delete(serverId)
      onDeleted()
    } catch (err) {
      setError((err as Error).message)
      setDeleting(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Server Settings</h2>
        <p className="text-sm text-slate-400">Adjust resources and manage this server.</p>
      </div>

      {error && <div className="rounded-lg border border-rose-800 bg-rose-950 px-3 py-2 text-sm text-rose-300">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-800 bg-emerald-950 px-3 py-2 text-sm text-emerald-300">{success}</div>}

      {isAdmin && panelUsers.length > 0 && (
        <form onSubmit={onAssignOwner} className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <h3 className="font-semibold text-slate-100">Assign owner</h3>
          <p className="text-sm text-slate-400">Panel user who can see and manage this server.</p>
          <div className="flex flex-wrap gap-3 items-end">
            <select
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 min-w-[240px]"
              value={ownerId}
              onChange={e => setOwnerId(e.target.value)}
            >
              {panelUsers.map(u => (
                <option key={u.id} value={u.id}>{u.email} ({u.role})</option>
              ))}
            </select>
            <button type="submit" className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600">Save owner</button>
          </div>
        </form>
      )}

      <form onSubmit={onChangePlan} className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
        <h3 className="font-semibold text-slate-100">Resource Limits</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">CPU Limit (%)</label>
            <input type="number" min={10} max={1000} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={cpuLimit} onChange={e => setCpuLimit(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Memory (MB)</label>
            <input type="number" min={128} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={memoryMb} onChange={e => setMemoryMb(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Disk (MB)</label>
            <input type="number" min={1024} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={diskMb} onChange={e => setDiskMb(Number(e.target.value))} />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save Changes</button>
      </form>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-2">
        <h3 className="font-semibold text-slate-100">Server Info</h3>
        <p className="text-sm text-slate-400">ID: <span className="font-mono text-slate-300">{serverId}</span></p>
        <p className="text-sm text-slate-400">Owner ID: <span className="font-mono text-slate-300">{server.ownerId}</span></p>
        <p className="text-sm text-slate-400">Template: <span className="text-slate-300">{server.templateId}</span></p>
        <p className="text-sm text-slate-400">Node: <span className="text-slate-300">{server.nodeId}</span></p>
      </div>

      <div className="rounded-xl border border-rose-900 bg-rose-950/30 p-5">
        <h3 className="font-semibold text-rose-300">Danger Zone</h3>
        <p className="mt-1 text-sm text-slate-400">Permanently delete this server and all associated data. This cannot be undone.</p>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete Server'}
        </button>
      </div>
    </div>
  )
}
