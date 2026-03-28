'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, HostCapacityData, ServerRecord, TemplateRecord, UserProfile } from '@/lib/api'
import {
  buildCpuPercentOptions,
  buildDiskMbOptions,
  buildMemoryMbOptions,
  diskOptionLabel,
  formatMebibytes,
  memoryOptionLabel,
  pickNearestCapped
} from '@/lib/resource-units'

const STATUS_COLOR: Record<string, string> = {
  running: 'text-emerald-400',
  stopped: 'text-slate-400',
  installing: 'text-amber-400',
  error: 'text-rose-400'
}

function firstDockerImageKey(t: TemplateRecord): string | undefined {
  if (!t.dockerImages || !Object.keys(t.dockerImages).length) return undefined
  if (t.defaultDockerImageKey && t.dockerImages[t.defaultDockerImageKey]) return t.defaultDockerImageKey
  return Object.keys(t.dockerImages)[0]
}

function templateSupportsMinecraftGameVersion(t: TemplateRecord | undefined): boolean {
  if (!t) return false
  const id = t.id
  return (
    id.includes('minecraft-paper') ||
    id.includes('vanilla-minecraft') ||
    id.includes('forge-minecraft') ||
    id.includes('bungeecord')
  )
}

export default function PanelPage() {
  const router = useRouter()
  const [me, setMe] = useState<UserProfile | null>(null)
  const [panelUsers, setPanelUsers] = useState<UserProfile[]>([])
  const [servers, setServers] = useState<ServerRecord[]>([])
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [form, setForm] = useState({
    serverName: '',
    templateId: '',
    dockerImageKey: '',
    minecraftGameVersion: '',
    cpuLimit: 100,
    memoryMb: 1024,
    diskMb: 10240,
    ownerId: '' as string | undefined
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hostCapacity, setHostCapacity] = useState<HostCapacityData | null>(null)

  const isAdmin = me?.role === 'admin'

  const effectiveMax = hostCapacity?.effectiveMax ?? {
    cpuPercent: 1000,
    memoryMb: 131072,
    diskMb: 1048576
  }

  const cpuOptions = useMemo(
    () => buildCpuPercentOptions(effectiveMax.cpuPercent),
    [effectiveMax.cpuPercent]
  )
  const memoryOptions = useMemo(
    () => buildMemoryMbOptions(effectiveMax.memoryMb),
    [effectiveMax.memoryMb]
  )
  const diskOptions = useMemo(
    () => buildDiskMbOptions(effectiveMax.diskMb),
    [effectiveMax.diskMb]
  )

  useEffect(() => {
    if (!hostCapacity) return
    const e = hostCapacity.effectiveMax
    const c = buildCpuPercentOptions(e.cpuPercent)
    const m = buildMemoryMbOptions(e.memoryMb)
    const d = buildDiskMbOptions(e.diskMb)
    setForm(f => ({
      ...f,
      cpuLimit: pickNearestCapped(f.cpuLimit, c),
      memoryMb: pickNearestCapped(f.memoryMb, m),
      diskMb: pickNearestCapped(f.diskMb, d)
    }))
  }, [hostCapacity])

  async function load() {
    const [cap, profile, s, t] = await Promise.all([
      api.settings.hostCapacity().catch(() => null),
      api.me(),
      api.servers.list(),
      api.templates.list()
    ])
    setHostCapacity(cap)
    setMe(profile)
    setServers(s)
    setTemplates(t)
    if (profile.role === 'admin') {
      try {
        setPanelUsers(await api.admin.users.list())
      } catch {
        setPanelUsers([])
      }
    }
    if (t.length) {
      setForm(f => {
        if (f.templateId) return f
        const first = t[0]
        return {
          ...f,
          templateId: first.id,
          dockerImageKey: firstDockerImageKey(first) ?? ''
        }
      })
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (me?.role !== 'admin' || panelUsers.length === 0) return
    setForm(f => (f.ownerId ? f : { ...f, ownerId: panelUsers[0].id }))
  }, [me?.role, panelUsers])

  async function onCreateServer(e: React.FormEvent) {
    e.preventDefault()
    if (!form.serverName) return
    setError(''); setLoading(true)
    try {
      const tmpl = templates.find(x => x.id === form.templateId)
      const hasVersions = tmpl?.dockerImages && Object.keys(tmpl.dockerImages).length > 0
      const gv = form.minecraftGameVersion.trim()
      await api.servers.create({
        serverName: form.serverName,
        templateId: form.templateId,
        cpuLimit: form.cpuLimit,
        memoryMb: form.memoryMb,
        diskMb: form.diskMb,
        ...(isAdmin && form.ownerId ? { ownerId: form.ownerId } : {}),
        ...(hasVersions && form.dockerImageKey ? { dockerImageKey: form.dockerImageKey } : {}),
        ...(templateSupportsMinecraftGameVersion(tmpl) && gv ? { gameVersion: gv } : {})
      })
      setForm(f => ({ ...f, serverName: '' }))
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const running = servers.filter(s => s.status === 'running').length
  const selectedTemplate = templates.find(t => t.id === form.templateId)
  const versionEntries = selectedTemplate?.dockerImages
    ? Object.entries(selectedTemplate.dockerImages)
    : []

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">Overview of your hosting platform</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Servers', value: servers.length },
          { label: 'Running', value: running },
          { label: 'Stopped', value: servers.length - running }
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{stat.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="font-semibold text-slate-100">Create New Server</h2>
        </div>
        <form onSubmit={onCreateServer} className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
          <div className="sm:col-span-3 rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-400 space-y-2">
            {hostCapacity?.host ? (
              <p>
                <span className="text-slate-300">This node</span>
                {' '}— ~{formatMebibytes(hostCapacity.host.totalMemoryMb)} RAM,{' '}
                {hostCapacity.host.cpuCount} CPU{hostCapacity.host.cpuCount === 1 ? '' : 's'}
                {hostCapacity.host.hostname ? ` (${hostCapacity.host.hostname})` : ''}.
                {' '}Choices below are capped by the host and your hosting limits.
              </p>
            ) : (
              <p>
                Could not read live host stats (is the node agent reachable?). Using hosting-limit defaults — max{' '}
                {effectiveMax.cpuPercent}% CPU, {formatMebibytes(effectiveMax.memoryMb)} RAM, {formatMebibytes(effectiveMax.diskMb)} disk per server.
              </p>
            )}
            {hostCapacity?.nodeRuntime?.windowsProcessLimitations && (
              <p className="text-amber-200/90 border border-amber-900/50 rounded-md px-3 py-2 bg-amber-950/30">
                <strong className="text-amber-100">Windows + process mode:</strong> Minecraft Paper/Vanilla/Python work locally; Source/Rust/voice eggs need{' '}
                <code className="text-amber-200">RUNTIME_DRIVER=docker</code> (Docker Desktop) or run the agent on{' '}
                <strong className="text-amber-100">Linux/Unraid</strong>. Templates with bash in the startup line (e.g. Forge) need Docker or Linux.
              </p>
            )}
            {hostCapacity?.nodeRuntime && hostCapacity.nodeRuntime.runtimeDriver === 'docker' && !hostCapacity.nodeRuntime.dockerAvailable && (
              <p className="text-rose-300/90 text-sm">
                Docker engine is not reachable — check Docker Desktop on Windows or the socket on Unraid (<code className="text-rose-200">/var/run/docker.sock</code>).
              </p>
            )}
          </div>          {isAdmin && panelUsers.length > 0 && (
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-400">Owner (panel user)</label>
              <select
                className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
                value={form.ownerId ?? ''}
                onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))}
              >
                {panelUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.email} ({u.role})</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Server Name</label>
            <input
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
              value={form.serverName}
              onChange={e => setForm(f => ({ ...f, serverName: e.target.value }))}
              placeholder="my-game-server"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Template</label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
              value={form.templateId}
              onChange={e => {
                const id = e.target.value
                const t = templates.find(x => x.id === id)
                const k = t ? firstDockerImageKey(t) : ''
                setForm(f => ({ ...f, templateId: id, dockerImageKey: k ?? '', minecraftGameVersion: '' }))
              }}
            >
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {versionEntries.length > 0 && (
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-400">Java runtime (Docker image)</label>
              <p className="mb-1.5 text-[11px] text-slate-500">JVM / base image for Minecraft and other Java eggs — not the Minecraft world/game release.</p>
              <select
                className="w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
                value={form.dockerImageKey}
                onChange={e => setForm(f => ({ ...f, dockerImageKey: e.target.value }))}
              >
                {versionEntries.map(([label, ref]) => (
                  <option key={label} value={label}>{label} — {ref}</option>
                ))}
              </select>
            </div>
          )}
          {templateSupportsMinecraftGameVersion(selectedTemplate) && (
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-400">Minecraft game version</label>
              <p className="mb-1.5 text-[11px] text-slate-500">
                Release track for the server jar (e.g. <code className="text-slate-400">1.21.4</code>,{' '}
                <code className="text-slate-400">latest</code>, Paper build uses template{' '}
                <code className="text-slate-400">BUILD_NUMBER</code> on the server page env). Leave empty to use the template default.
              </p>
              <input
                className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
                value={form.minecraftGameVersion}
                onChange={e => setForm(f => ({ ...f, minecraftGameVersion: e.target.value }))}
                placeholder="e.g. 1.21.4 or latest"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">CPU</label>
            <p className="mb-1.5 text-[11px] text-slate-500">100% ≈ one full CPU core (Docker NanoCpus)</p>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
              value={form.cpuLimit}
              onChange={e => setForm(f => ({ ...f, cpuLimit: Number(e.target.value) }))}
            >
              {cpuOptions.map(pct => (
                <option key={pct} value={pct}>{pct}%</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Memory</label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
              value={form.memoryMb}
              onChange={e => setForm(f => ({ ...f, memoryMb: Number(e.target.value) }))}
            >
              {memoryOptions.map(mb => (
                <option key={mb} value={mb}>{memoryOptionLabel(mb)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Disk</label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
              value={form.diskMb}
              onChange={e => setForm(f => ({ ...f, diskMb: Number(e.target.value) }))}
            >
              {diskOptions.map(mb => (
                <option key={mb} value={mb}>{diskOptionLabel(mb)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create Server'}
            </button>
          </div>
          {error && <p className="col-span-3 text-sm text-rose-400">{error}</p>}
        </form>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="font-semibold text-slate-100">{isAdmin ? 'All Servers' : 'Your Servers'}</h2>
        </div>
        {servers.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No servers yet. Create one above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left">
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Name</th>
                {isAdmin && <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Owner</th>}
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Resources</th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Ports</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {servers.map(server => (
                <tr key={server.id} className="hover:bg-slate-800/50">
                  <td className="px-5 py-3 font-medium text-slate-100">{server.name}</td>
                  {isAdmin && (
                    <td className="px-5 py-3 text-xs font-mono text-slate-500">{server.ownerId}</td>
                  )}
                  <td className={`px-5 py-3 font-semibold capitalize ${STATUS_COLOR[server.status] ?? 'text-slate-400'}`}>{server.status}</td>
                  <td className="px-5 py-3 text-slate-400">
                    {server.cpuLimit}% CPU / {formatMebibytes(server.memoryMb)} RAM / {formatMebibytes(server.diskMb)} disk
                  </td>
                  <td className="px-5 py-3 text-slate-400">{server.allocatedPorts.join(', ') || '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      className="rounded-lg bg-indigo-600/20 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-600 hover:text-white transition-colors"
                      onClick={() => router.push(`/panel/servers/${server.id}`)}
                    >
                      Manage →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
