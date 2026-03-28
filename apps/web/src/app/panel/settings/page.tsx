'use client'

import { useEffect, useState } from 'react'
import {
  api,
  ApiKeyRecord,
  HostingLimits,
  NodeInfo,
  UserProfile
} from '@/lib/api'

export default function SettingsPage() {
  const [me, setMe] = useState<UserProfile | null>(null)
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([])
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [totals, setTotals] = useState({ templates: 0, servers: 0 })
  const [hostingLimits, setHostingLimits] = useState<HostingLimits | null>(null)
  const [adminUsers, setAdminUsers] = useState<UserProfile[]>([])
  const [newKeyName, setNewKeyName] = useState('Webshop Key')
  const [newKeyScope, setNewKeyScope] = useState<'orders' | 'admin'>('orders')
  const [newKeySecret, setNewKeySecret] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [msg, setMsg] = useState('')

  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user')

  async function load() {
    const [profile, keys, general] = await Promise.all([
      api.me(),
      api.settings.apiKeys(),
      api.settings.general()
    ])
    setMe(profile)
    setApiKeys(keys)
    setNodes(general.nodes)
    setTotals({ templates: general.templates, servers: general.servers })
    setHostingLimits(general.hostingLimits)
    if (profile.role === 'admin') {
      try {
        const users = await api.admin.users.list()
        setAdminUsers(users)
      } catch {
        setAdminUsers([])
      }
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (me && me.role !== 'admin' && newKeyScope === 'admin') setNewKeyScope('orders')
  }, [me, newKeyScope])

  const isAdmin = me?.role === 'admin'

  async function createKey(e: React.FormEvent) {
    e.preventDefault()
    try {
      const key = await api.settings.createApiKey(newKeyName, newKeyScope)
      setNewKeySecret(key.secret)
      setMsg(`Key created — copy the secret now, it won't be shown again`)
      await load()
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.users.updatePassword(currentPassword, nextPassword)
      setCurrentPassword('')
      setNextPassword('')
      setMsg('Password updated')
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  async function saveHostingLimits(e: React.FormEvent) {
    e.preventDefault()
    if (!hostingLimits) return
    try {
      const updated = await api.settings.updateHostingLimits(hostingLimits)
      setHostingLimits(updated)
      setMsg('Hosting limits saved')
      await load()
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  async function savePortPool(e: React.FormEvent, node: NodeInfo) {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const minPort = Number((form.elements.namedItem('minPort') as HTMLInputElement).value)
    const maxPort = Number((form.elements.namedItem('maxPort') as HTMLInputElement).value)
    try {
      await api.settings.updatePortPool(node.id, minPort, maxPort)
      setMsg('Port pool updated')
      await load()
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.admin.users.create(newUserEmail, newUserPassword, newUserRole)
      setNewUserEmail('')
      setNewUserPassword('')
      setMsg('User created')
      await load()
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Panel configuration, API keys, and account settings.
          {me && (
            <span className="ml-2 rounded-full border border-slate-600 px-2 py-0.5 text-xs text-slate-300">
              {me.email} · {me.role}
            </span>
          )}
        </p>
      </div>

      {msg && (
        <div className="rounded-lg border border-indigo-800 bg-indigo-950/50 px-4 py-2 text-sm text-indigo-300">
          {msg}
          <button type="button" className="ml-3 text-xs text-slate-400 hover:text-slate-200" onClick={() => setMsg('')}>✕</button>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-200">Platform Overview</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Servers', value: totals.servers },
            { label: 'Templates', value: totals.templates },
            { label: 'Nodes', value: nodes.length },
            { label: 'Used Ports', value: nodes.reduce((acc, n) => acc + n.usedPortCount, 0) }
          ].map(stat => (
            <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-xs text-slate-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-100">{stat.value}</p>
            </div>
          ))}
        </div>
      </section>

      {isAdmin && hostingLimits && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-slate-200">Hosting limits</h2>
          <p className="mb-3 text-sm text-slate-400">
            Use 0 for unlimited. New servers and resource edits are validated against these caps.
          </p>
          <form onSubmit={saveHostingLimits} className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Max servers (platform total)</label>
                <input type="number" min={0} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={hostingLimits.maxServersTotal} onChange={e => setHostingLimits({ ...hostingLimits, maxServersTotal: Number(e.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Max servers per user</label>
                <input type="number" min={0} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={hostingLimits.maxServersPerUser} onChange={e => setHostingLimits({ ...hostingLimits, maxServersPerUser: Number(e.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Max CPU per server (%)</label>
                <input type="number" min={0} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={hostingLimits.maxCpuPerServer} onChange={e => setHostingLimits({ ...hostingLimits, maxCpuPerServer: Number(e.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Max memory per server (MB)</label>
                <input type="number" min={0} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={hostingLimits.maxMemoryMbPerServer} onChange={e => setHostingLimits({ ...hostingLimits, maxMemoryMbPerServer: Number(e.target.value) })} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-400">Max disk per server (MB)</label>
                <input type="number" min={0} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={hostingLimits.maxDiskMbPerServer} onChange={e => setHostingLimits({ ...hostingLimits, maxDiskMbPerServer: Number(e.target.value) })} />
              </div>
            </div>
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save hosting limits</button>
          </form>
        </section>
      )}

      {isAdmin && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-slate-200">Port pool</h2>
          <p className="mb-3 text-sm text-slate-400">
            Default range is 20000–40000. You cannot narrow the pool below ports that are already allocated.
          </p>
          <div className="space-y-4">
            {nodes.map(node => (
              <form
                key={node.id}
                onSubmit={e => savePortPool(e, node)}
                className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-wrap items-end gap-4"
              >
                <div className="min-w-[140px]">
                  <p className="text-xs text-slate-500">Node</p>
                  <p className="text-sm font-medium text-slate-200">{node.name}</p>
                  <p className="text-xs font-mono text-slate-500">{node.id}</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Min port</label>
                  <input name="minPort" type="number" min={1} max={65534} defaultValue={node.minPort} className="w-28 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Max port</label>
                  <input name="maxPort" type="number" min={2} max={65535} defaultValue={node.maxPort} className="w-28 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
                </div>
                <button type="submit" className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600">Apply</button>
                <span className="text-xs text-slate-500">{node.usedPortCount} ports in use</span>
              </form>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-200">Node Configuration</h2>
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-800">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Host</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Port Pool</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Ports Used</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800">
              {nodes.map(node => (
                <tr key={node.id}>
                  <td className="px-4 py-3 text-slate-200">{node.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-400">{node.host}</td>
                  <td className="px-4 py-3 font-mono text-slate-400">{node.portPool}</td>
                  <td className="px-4 py-3 text-slate-400">{node.usedPortCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-slate-200">Panel users</h2>
          <p className="mb-3 text-sm text-slate-400">
            Create accounts for customers. Assign servers to them from the server Settings tab or when creating a server.
          </p>
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden mb-4">
            {adminUsers.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No users loaded</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-800">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">ID</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {adminUsers.map(u => (
                    <tr key={u.id}>
                      <td className="px-4 py-3 text-slate-200">{u.email}</td>
                      <td className="px-4 py-3"><span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">{u.role}</span></td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{u.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <form onSubmit={createUser} className="rounded-xl border border-slate-800 bg-slate-900 p-5 flex flex-wrap gap-3 items-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Email</label>
              <input required type="email" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Password</label>
              <input required type="password" minLength={4} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Role</label>
              <select className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={newUserRole} onChange={e => setNewUserRole(e.target.value as 'admin' | 'user')}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Add user</button>
          </form>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-200">API Keys</h2>
        <p className="mb-3 text-sm text-slate-400">Use API keys to let your webshop provision and manage servers.</p>

        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden mb-4">
          {apiKeys.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No API keys yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Scope</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Secret</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Created</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800">
                {apiKeys.map(key => (
                  <tr key={key.id}>
                    <td className="px-4 py-3 text-slate-200">{key.name}</td>
                    <td className="px-4 py-3"><span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">{key.scope}</span></td>
                    <td className="px-4 py-3 font-mono text-slate-400">{key.secret}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(key.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <form onSubmit={createKey} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Key Name</label>
            <input className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Scope</label>
            <select className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={newKeyScope} onChange={e => setNewKeyScope(e.target.value as 'orders' | 'admin')}>
              <option value="orders">orders</option>
              {isAdmin ? <option value="admin">admin</option> : null}
            </select>
          </div>
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Create Key</button>
        </form>

        {newKeySecret && (
          <div className="mt-3 rounded-lg border border-emerald-800 bg-emerald-950 p-3">
            <p className="text-xs text-emerald-400 font-semibold">New key created — copy this now:</p>
            <p className="mt-1 font-mono text-sm text-emerald-300 break-all">{newKeySecret}</p>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-200">Account Password</h2>
        <form onSubmit={updatePassword} className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4 max-w-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Current Password</label>
            <input type="password" required className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">New Password</label>
            <input type="password" required minLength={6} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" value={nextPassword} onChange={e => setNextPassword(e.target.value)} />
          </div>
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Update Password</button>
        </form>
      </section>
    </div>
  )
}
