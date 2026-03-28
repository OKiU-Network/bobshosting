'use client'

import { useMemo, useState } from 'react'
import { getApiBase } from '@/lib/api'

interface TemplateRecord {
  id: string
  name: string
  category: string
}

interface ServerRecord {
  id: string
  name: string
  status: string
  allocatedPorts: number[]
  cpuLimit: number
  memoryMb: number
  diskMb: number
}

interface FileEntry {
  name: string
  kind: 'file' | 'directory'
  size: number
}

interface ApiKeyRecord {
  id: string
  name: string
  scope: 'orders' | 'admin'
  secret: string
  createdAt: string
}

interface GeneralSettings {
  nodes: Array<{ id: string; name: string; host: string; portPool: string; usedPortCount: number }>
  templates: number
  servers: number
}

interface LoginResponse {
  isSuccess: boolean
  message?: string
  data?: {
    accessToken: string
    user: {
      email: string
      role: 'admin' | 'user'
    }
  }
}

async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${getApiBase()}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  return response.json()
}

export function PanelDashboard() {
  const [accessToken, setAccessToken] = useState('')
  const [userEmail, setUserEmail] = useState('admin@local.dev')
  const [password, setPassword] = useState('admin123')
  const [viewerEmail, setViewerEmail] = useState('')
  const [activeView, setActiveView] = useState<'overview' | 'servers' | 'network' | 'settings'>('overview')
  const [message, setMessage] = useState('')
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [servers, setServers] = useState<ServerRecord[]>([])
  const [templateId, setTemplateId] = useState('minecraft-paper')
  const [serverName, setServerName] = useState('my-server')
  const [cpuLimit, setCpuLimit] = useState(100)
  const [memoryMb, setMemoryMb] = useState(1024)
  const [diskMb, setDiskMb] = useState(10240)
  const [selectedFiles, setSelectedFiles] = useState<FileEntry[]>([])
  const [selectedLogs, setSelectedLogs] = useState<string[]>([])
  const [selectedServerId, setSelectedServerId] = useState('')
  const [currentDirectory, setCurrentDirectory] = useState('.')
  const [currentFilePath, setCurrentFilePath] = useState('')
  const [currentFileContent, setCurrentFileContent] = useState('')
  const [newFolderPath, setNewFolderPath] = useState('new-folder')
  const [consoleCommand, setConsoleCommand] = useState('echo panel command')
  const [commandOutput, setCommandOutput] = useState<string[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([])
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings | null>(null)
  const [newApiKeyName, setNewApiKeyName] = useState('Webshop Key')
  const [currentPassword, setCurrentPassword] = useState('admin123')
  const [nextPassword, setNextPassword] = useState('')
  const isLoggedIn = useMemo(() => accessToken.length > 0, [accessToken])

  async function fetchTemplates(nextToken: string) {
    const response = await fetch(`${getApiBase()}/v1/templates`, {
      headers: { Authorization: `Bearer ${nextToken}` }
    })
    const payload = await response.json()
    setTemplates(payload.data ?? [])
  }

  async function fetchServers(nextToken: string) {
    const response = await fetch(`${getApiBase()}/v1/servers`, {
      headers: { Authorization: `Bearer ${nextToken}` }
    })
    const payload = await response.json()
    setServers(payload.data ?? [])
  }

  async function fetchSettings(nextToken: string) {
    const [keysResponse, generalResponse] = await Promise.all([
      fetch(`${getApiBase()}/v1/settings/api-keys`, { headers: { Authorization: `Bearer ${nextToken}` } }),
      fetch(`${getApiBase()}/v1/settings/general`, { headers: { Authorization: `Bearer ${nextToken}` } })
    ])
    const keysPayload = await keysResponse.json()
    const generalPayload = await generalResponse.json()
    setApiKeys(keysPayload.data ?? [])
    setGeneralSettings(generalPayload.data ?? null)
  }

  async function onLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    const payload = await loginRequest(userEmail, password)
    if (!payload.isSuccess || !payload.data?.accessToken) {
      setMessage(payload.message ?? 'Login failed')
      return
    }
    setAccessToken(payload.data.accessToken)
    setViewerEmail(payload.data.user.email)
    await fetchTemplates(payload.data.accessToken)
    await fetchServers(payload.data.accessToken)
    await fetchSettings(payload.data.accessToken)
    setMessage('Logged in')
  }

  async function onCreateServer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!accessToken) return
    const response = await fetch(`${getApiBase()}/v1/servers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ serverName, templateId, cpuLimit, memoryMb, diskMb })
    })
    const payload = await response.json()
    setMessage(payload?.message ?? 'Server provisioned')
    await fetchServers(accessToken)
  }

  async function onPower(serverId: string, action: 'start' | 'stop' | 'restart') {
    if (!accessToken) return
    await fetch(`${getApiBase()}/v1/servers/${serverId}/power`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ action })
    })
    setMessage(`Power action executed: ${action}`)
    await fetchServers(accessToken)
  }

  async function onLoadFiles(serverId: string) {
    if (!accessToken) return
    setSelectedServerId(serverId)
    const params = new URLSearchParams()
    if (currentDirectory && currentDirectory !== '.') params.set('path', currentDirectory)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const response = await fetch(`${getApiBase()}/v1/servers/${serverId}/files${suffix}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const payload = await response.json()
    setSelectedFiles(payload.data?.entries ?? [])
    setMessage(`Loaded files for ${serverId}`)
  }

  async function onLoadLogs(serverId: string) {
    if (!accessToken) return
    setSelectedServerId(serverId)
    const response = await fetch(`${getApiBase()}/v1/servers/${serverId}/logs`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const payload = await response.json()
    setSelectedLogs(payload.data?.lines ?? [])
    setMessage(`Loaded logs for ${serverId}`)
  }

  async function onAllocatePort(serverId: string) {
    if (!accessToken) return
    const response = await fetch(`${getApiBase()}/v1/servers/${serverId}/network/allocate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ amount: 1 })
    })
    const payload = await response.json()
    setMessage(payload?.message ?? 'Port allocated')
    await fetchServers(accessToken)
  }

  async function onOpenFile(fileName: string) {
    if (!accessToken || !selectedServerId) return
    const targetPath = currentDirectory === '.' ? fileName : `${currentDirectory}/${fileName}`
    const params = new URLSearchParams({ path: targetPath })
    const response = await fetch(`${getApiBase()}/v1/servers/${selectedServerId}/files/content?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const payload = await response.json()
    if (!payload.isSuccess) return setMessage(payload.message ?? 'Unable to open file')
    setCurrentFilePath(targetPath)
    setCurrentFileContent(payload.data?.content ?? '')
    setMessage(`Opened ${targetPath}`)
  }

  async function onSaveFile() {
    if (!accessToken || !selectedServerId || !currentFilePath) return
    const response = await fetch(`${getApiBase()}/v1/servers/${selectedServerId}/files/content`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ path: currentFilePath, content: currentFileContent })
    })
    const payload = await response.json()
    setMessage(payload.message ?? 'File saved')
    await onLoadFiles(selectedServerId)
  }

  async function onDeletePath(targetPath: string) {
    if (!accessToken || !selectedServerId) return
    const params = new URLSearchParams({ path: targetPath })
    const response = await fetch(`${getApiBase()}/v1/servers/${selectedServerId}/files?${params.toString()}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const payload = await response.json()
    setMessage(payload.message ?? 'Path deleted')
    await onLoadFiles(selectedServerId)
  }

  async function onCreateFolder() {
    if (!accessToken || !selectedServerId || !newFolderPath) return
    const response = await fetch(`${getApiBase()}/v1/servers/${selectedServerId}/files/folder`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ path: currentDirectory === '.' ? newFolderPath : `${currentDirectory}/${newFolderPath}` })
    })
    const payload = await response.json()
    setMessage(payload.message ?? 'Folder created')
    await onLoadFiles(selectedServerId)
  }

  async function onRunConsoleCommand() {
    if (!accessToken || !selectedServerId || !consoleCommand) return
    const response = await fetch(`${getApiBase()}/v1/servers/${selectedServerId}/console/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ command: consoleCommand })
    })
    const payload = await response.json()
    if (!payload.isSuccess) return setMessage(payload.message ?? 'Command failed')
    setCommandOutput(payload.data?.lines ?? [])
    setMessage('Console command executed')
    await onLoadLogs(selectedServerId)
  }

  async function onDeleteServer(serverId: string) {
    if (!accessToken) return
    const response = await fetch(`${getApiBase()}/v1/servers/${serverId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const payload = await response.json()
    setMessage(payload?.message ?? 'Server deleted')
    await fetchServers(accessToken)
    await fetchSettings(accessToken)
  }

  async function onCreateApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!accessToken) return
    const response = await fetch(`${getApiBase()}/v1/settings/api-keys`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ name: newApiKeyName, scope: 'orders' })
    })
    const payload = await response.json()
    setMessage(payload?.message ?? 'Api key created')
    await fetchSettings(accessToken)
  }

  async function onUpdatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!accessToken) return
    const response = await fetch(`${getApiBase()}/v1/users/me/password`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ currentPassword, nextPassword })
    })
    const payload = await response.json()
    setMessage(payload?.message ?? 'Password updated')
    if (payload?.isSuccess) {
      setCurrentPassword(nextPassword)
      setNextPassword('')
    }
  }

  return (
    <main className="panel-shell flex min-h-screen">
      {!isLoggedIn && (
        <section className="mx-auto flex w-full max-w-md items-center px-6">
          <form onSubmit={onLogin} className="panel-card w-full space-y-5 rounded-lg p-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-100">Sign in to Wave Panel</h1>
              <p className="mt-1 text-sm text-slate-400">Use your panel credentials to continue.</p>
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-slate-300">Email</span>
              <input className="panel-input w-full rounded-md px-3 py-2" value={userEmail} onChange={event => setUserEmail(event.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-slate-300">Password</span>
              <input
                type="password"
                className="panel-input w-full rounded-md px-3 py-2"
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </label>
            {message && <p className="text-sm text-rose-300">{message}</p>}
            <button className="panel-button w-full rounded-md px-3 py-2 text-sm font-semibold" type="submit">
              Sign in
            </button>
          </form>
        </section>
      )}

      {isLoggedIn && (
        <>
          <aside className="hidden w-64 border-r border-slate-700 bg-slate-950 p-4 md:block">
            <h2 className="text-lg font-semibold text-slate-100">Wave Panel</h2>
            <p className="mb-5 mt-1 text-xs text-slate-400">{viewerEmail}</p>
            <nav className="space-y-2">
              <button className="panel-input w-full rounded-md px-3 py-2 text-left" onClick={() => setActiveView('overview')}>
                Overview
              </button>
              <button className="panel-input w-full rounded-md px-3 py-2 text-left" onClick={() => setActiveView('servers')}>
                Servers
              </button>
              <button className="panel-input w-full rounded-md px-3 py-2 text-left" onClick={() => setActiveView('network')}>
                Network
              </button>
              <button className="panel-input w-full rounded-md px-3 py-2 text-left" onClick={() => setActiveView('settings')}>
                Settings
              </button>
            </nav>
          </aside>

          <section className="w-full p-4 md:p-6">
            <header className="panel-card mb-4 rounded-lg p-4">
              <h1 className="text-xl font-semibold text-slate-100">Hosting Dashboard</h1>
              <p className="text-sm text-slate-400">Manage servers, files, ports, and runtime templates.</p>
              {message && <p className="mt-2 text-xs text-emerald-300">{message}</p>}
            </header>

            {activeView === 'overview' && (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="panel-card rounded-lg p-4">
                  <p className="text-xs uppercase text-slate-400">Total Servers</p>
                  <p className="mt-2 text-2xl font-semibold">{servers.length}</p>
                </div>
                <div className="panel-card rounded-lg p-4">
                  <p className="text-xs uppercase text-slate-400">Running</p>
                  <p className="mt-2 text-2xl font-semibold">{servers.filter(server => server.status === 'running').length}</p>
                </div>
                <div className="panel-card rounded-lg p-4">
                  <p className="text-xs uppercase text-slate-400">Templates</p>
                  <p className="mt-2 text-2xl font-semibold">{templates.length}</p>
                </div>
              </div>
            )}

            {activeView === 'servers' && (
              <div className="space-y-4">
                <form onSubmit={onCreateServer} className="panel-card grid gap-3 rounded-lg p-4 md:grid-cols-3">
                  <input
                    className="panel-input rounded-md px-3 py-2"
                    value={serverName}
                    placeholder="server name"
                    onChange={event => setServerName(event.target.value)}
                  />
                  <select className="panel-input rounded-md px-3 py-2" value={templateId} onChange={event => setTemplateId(event.target.value)}>
                    {templates.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <button className="panel-button rounded-md px-3 py-2 font-semibold" type="submit">
                    Create Server
                  </button>
                  <input
                    type="number"
                    className="panel-input rounded-md px-3 py-2"
                    value={cpuLimit}
                    onChange={event => setCpuLimit(Number(event.target.value))}
                    placeholder="CPU %"
                  />
                  <input
                    type="number"
                    className="panel-input rounded-md px-3 py-2"
                    value={memoryMb}
                    onChange={event => setMemoryMb(Number(event.target.value))}
                    placeholder="RAM MB"
                  />
                  <input
                    type="number"
                    className="panel-input rounded-md px-3 py-2"
                    value={diskMb}
                    onChange={event => setDiskMb(Number(event.target.value))}
                    placeholder="Disk MB"
                  />
                </form>

                <ul className="space-y-3">
                  {servers.map(server => (
                    <li key={server.id} className="panel-card rounded-lg p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-100">{server.name}</p>
                          <p className="text-xs uppercase tracking-wide text-slate-400">{server.status}</p>
                        <p className="text-xs text-slate-400">
                          CPU {server.cpuLimit}% | RAM {server.memoryMb}MB | Disk {server.diskMb}MB
                        </p>
                        </div>
                        <p className="text-sm text-slate-300">Ports: {server.allocatedPorts.join(', ') || '-'}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className="panel-input rounded-md px-3 py-1.5 text-sm" onClick={() => onPower(server.id, 'start')}>
                          Start
                        </button>
                        <button className="panel-input rounded-md px-3 py-1.5 text-sm" onClick={() => onPower(server.id, 'stop')}>
                          Stop
                        </button>
                        <button className="panel-input rounded-md px-3 py-1.5 text-sm" onClick={() => onPower(server.id, 'restart')}>
                          Restart
                        </button>
                        <button className="panel-input rounded-md px-3 py-1.5 text-sm" onClick={() => onLoadFiles(server.id)}>
                          Files
                        </button>
                        <button className="panel-input rounded-md px-3 py-1.5 text-sm" onClick={() => onLoadLogs(server.id)}>
                          Console
                        </button>
                        <button className="panel-input rounded-md px-3 py-1.5 text-sm text-rose-300" onClick={() => onDeleteServer(server.id)}>
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activeView === 'network' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="panel-card rounded-lg p-4">
                  <h3 className="mb-3 text-lg font-semibold text-slate-100">Port Allocations</h3>
                  <ul className="space-y-2 text-sm">
                    {servers.map(server => (
                      <li key={server.id} className="rounded border border-slate-700 p-2">
                        <p className="font-medium">{server.name}</p>
                        <p className="text-slate-400">{server.allocatedPorts.join(', ') || 'No ports allocated'}</p>
                        <button className="panel-input mt-2 rounded-md px-3 py-1.5" onClick={() => onAllocatePort(server.id)}>
                          Allocate +1 Port
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="panel-card rounded-lg p-4">
                  <h3 className="mb-3 text-lg font-semibold text-slate-100">Files and Console</h3>
                  <div className="mb-3 grid gap-2 md:grid-cols-2">
                    <input
                      className="panel-input rounded-md px-2 py-1.5 text-sm"
                      value={currentDirectory}
                      onChange={event => setCurrentDirectory(event.target.value)}
                      placeholder="directory path"
                    />
                    <button
                      className="panel-input rounded-md px-2 py-1.5 text-sm"
                      onClick={() => selectedServerId && onLoadFiles(selectedServerId)}
                    >
                      Refresh Files
                    </button>
                    <input
                      className="panel-input rounded-md px-2 py-1.5 text-sm"
                      value={newFolderPath}
                      onChange={event => setNewFolderPath(event.target.value)}
                      placeholder="new folder path"
                    />
                    <button className="panel-input rounded-md px-2 py-1.5 text-sm" onClick={onCreateFolder}>
                      Create Folder
                    </button>
                  </div>
                  <p className="mb-2 text-xs uppercase text-slate-400">Files</p>
                  <ul className="mb-3 max-h-40 space-y-1 overflow-auto text-sm">
                    {selectedFiles.map(entry => (
                      <li key={entry.name} className="rounded border border-slate-700 px-2 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {entry.kind} / {entry.name} ({entry.size})
                          </span>
                          <div className="flex gap-2">
                            {entry.kind === 'file' && (
                              <button className="panel-input rounded-md px-2 py-1 text-xs" onClick={() => onOpenFile(entry.name)}>
                                Open
                              </button>
                            )}
                            <button
                              className="panel-input rounded-md px-2 py-1 text-xs text-rose-300"
                              onClick={() =>
                                onDeletePath(currentDirectory === '.' ? entry.name : `${currentDirectory}/${entry.name}`)
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mb-3 grid gap-2">
                    <input
                      className="panel-input rounded-md px-2 py-1.5 text-sm"
                      value={currentFilePath}
                      onChange={event => setCurrentFilePath(event.target.value)}
                      placeholder="file path"
                    />
                    <textarea
                      className="panel-input min-h-28 rounded-md px-2 py-1.5 text-sm"
                      value={currentFileContent}
                      onChange={event => setCurrentFileContent(event.target.value)}
                    />
                    <button className="panel-button rounded-md px-3 py-1.5 text-sm" onClick={onSaveFile}>
                      Save File
                    </button>
                  </div>
                  <p className="mb-2 text-xs uppercase text-slate-400">Logs</p>
                  <ul className="max-h-40 space-y-1 overflow-auto text-sm">
                    {selectedLogs.map(line => (
                      <li key={line} className="rounded border border-slate-700 px-2 py-1">
                        {line}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 grid gap-2">
                    <input
                      className="panel-input rounded-md px-2 py-1.5 text-sm"
                      value={consoleCommand}
                      onChange={event => setConsoleCommand(event.target.value)}
                      placeholder="server console command"
                    />
                    <button className="panel-button rounded-md px-3 py-1.5 text-sm" onClick={onRunConsoleCommand}>
                      Run Command
                    </button>
                    <ul className="max-h-28 space-y-1 overflow-auto text-xs">
                      {commandOutput.map(line => (
                        <li key={line} className="rounded border border-slate-700 px-2 py-1">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {activeView === 'settings' && (
              <div className="panel-card max-w-2xl rounded-lg p-4">
                <h3 className="text-lg font-semibold text-slate-100">Settings</h3>
                <p className="mt-1 text-sm text-slate-400">Panel and integration controls for internal operation.</p>
                <div className="mt-4 grid gap-3">
                  <form onSubmit={onCreateApiKey} className="rounded border border-slate-700 p-3">
                    <p className="text-sm font-medium">Create API Key</p>
                    <div className="mt-2 flex gap-2">
                      <input
                        className="panel-input flex-1 rounded-md px-2 py-1.5 text-sm"
                        value={newApiKeyName}
                        onChange={event => setNewApiKeyName(event.target.value)}
                      />
                      <button className="panel-button rounded-md px-3 py-1.5 text-sm" type="submit">
                        Create
                      </button>
                    </div>
                    <ul className="mt-3 space-y-1 text-xs text-slate-400">
                      {apiKeys.map(entry => (
                        <li key={entry.id}>
                          {entry.name} ({entry.scope}) - {entry.secret}
                        </li>
                      ))}
                    </ul>
                  </form>
                  <form onSubmit={onUpdatePassword} className="rounded border border-slate-700 p-3">
                    <p className="text-sm font-medium">User Password</p>
                    <div className="mt-2 grid gap-2">
                      <input
                        type="password"
                        className="panel-input rounded-md px-2 py-1.5 text-sm"
                        placeholder="Current password"
                        value={currentPassword}
                        onChange={event => setCurrentPassword(event.target.value)}
                      />
                      <input
                        type="password"
                        className="panel-input rounded-md px-2 py-1.5 text-sm"
                        placeholder="New password"
                        value={nextPassword}
                        onChange={event => setNextPassword(event.target.value)}
                      />
                      <button className="panel-button rounded-md px-3 py-1.5 text-sm" type="submit">
                        Update Password
                      </button>
                    </div>
                  </form>
                  <div className="rounded border border-slate-700 p-3">
                    <p className="text-sm font-medium">Nodes</p>
                    <ul className="mt-1 text-xs text-slate-400">
                      {generalSettings?.nodes.map(entry => (
                        <li key={entry.id}>
                          {entry.name} - {entry.host} - pool {entry.portPool} - used {entry.usedPortCount}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded border border-slate-700 p-3">
                    <p className="text-sm font-medium">Platform Totals</p>
                    <p className="mt-1 text-xs text-slate-400">
                      templates {generalSettings?.templates ?? 0} - servers {generalSettings?.servers ?? 0}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
