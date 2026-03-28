'use client'

/**
 * NEXT_PUBLIC_* is baked at `next build`. If the image was built with localhost/127.0.0.1,
 * browsers on other machines would call themselves — not the server. In the browser we
 * rewrite loopback hosts to the current page hostname (typical Docker: panel :3000, API :4000).
 * Set NEXT_PUBLIC_API_BASE_URL="" for same-origin `/v1` (reverse proxy / all-in-one).
 */
function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

/** Brackets required when embedding IPv6 literals in URL hosts. */
function formatHostnameForUrl(hostname: string): string {
  return hostname.includes(':') ? `[${hostname}]` : hostname
}

/**
 * Resolves API origin in the browser so login always hits the same machine as the panel
 * (port from build, usually 4000). Replaces loopback and mismatched build-time hostnames
 * (e.g. baked LAN IP while you open the panel via public IP or another interface).
 */
export function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL
  if (raw === '') return ''

  const trimmed =
    raw != null && String(raw).trim() !== '' ? String(raw).replace(/\/$/, '') : ''

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    const hostInBrowser = formatHostnameForUrl(hostname)

    if (trimmed !== '') {
      try {
        const u = new URL(trimmed)
        const apiPort = u.port || '4000'
        const buildHost = u.hostname.toLowerCase()
        const pageHost = hostname.toLowerCase()
        if (isLoopbackHostname(buildHost) || buildHost !== pageHost) {
          return `${protocol}//${hostInBrowser}:${apiPort}`
        }
      } catch {
        /* invalid URL — fall through */
      }
      return trimmed
    }
    return `${protocol}//${hostInBrowser}:4000`
  }

  if (trimmed !== '') return trimmed
  return 'http://localhost:4000'
}

function getToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('wave_token') ?? ''
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' }
}

/** Bearer only — no Content-Type (Fastify rejects DELETE with application/json and empty body) */
function authHeadersBearerOnly(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}` }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, { headers: authHeadersBearerOnly() })
  const json = await res.json()
  if (!json.isSuccess) throw new Error(json.message ?? 'Request failed')
  return json.data as T
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST', headers: authHeaders(), body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json()
  if (!json.isSuccess) throw new Error(json.message ?? 'Request failed')
  return json.data as T
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'PUT', headers: authHeaders(), body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json()
  if (!json.isSuccess) throw new Error(json.message ?? 'Request failed')
  return json.data as T
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, { method: 'DELETE', headers: authHeadersBearerOnly() })
  const json = await res.json()
  if (!json.isSuccess) throw new Error(json.message ?? 'Request failed')
  return json.data as T
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'PATCH', headers: authHeaders(), body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json()
  if (!json.isSuccess) throw new Error(json.message ?? 'Request failed')
  return json.data as T
}

export interface ServerRecord {
  id: string
  name: string
  status: 'stopped' | 'running' | 'installing' | 'error'
  allocatedPorts: number[]
  cpuLimit: number
  memoryMb: number
  diskMb: number
  templateId: string
  nodeId: string
  ownerId: string
  /** Selected Pterodactyl docker_images key (e.g. Java 17) */
  dockerImageKey?: string
}

export interface TemplateRecord {
  id: string
  name: string
  category: 'game' | 'python'
  image: string
  dockerImages?: Record<string, string>
  defaultDockerImageKey?: string
  startupCommand: string
  defaultPorts: number[]
  env: Record<string, string>
  eggDescription?: string
  sourcePath?: string
}

export interface FileEntry {
  name: string
  kind: 'file' | 'directory'
  size: number
}

export interface NodeInfo {
  id: string
  name: string
  host: string
  minPort: number
  maxPort: number
  portPool: string
  usedPortCount: number
}

export interface HostingLimits {
  maxServersTotal: number
  maxServersPerUser: number
  maxCpuPerServer: number
  maxMemoryMbPerServer: number
  maxDiskMbPerServer: number
}

export interface GeneralSettings {
  nodes: NodeInfo[]
  templates: number
  servers: number
  hostingLimits: HostingLimits
}

export interface HostCapacityData {
  host: null | {
    totalMemoryMb: number
    cpuCount: number
    platform: string
    hostname: string
  }
  nodeRuntime: null | {
    platform: string
    runtimeDriver: string
    dockerAvailable: boolean
    windowsProcessLimitations: boolean
  }
  hostingLimits: HostingLimits
  effectiveMax: {
    cpuPercent: number
    memoryMb: number
    diskMb: number
  }
}

export interface ApiKeyRecord {
  id: string
  name: string
  scope: string
  secret: string
  createdAt: string
}

export interface UserProfile {
  id: string
  email: string
  role: 'admin' | 'user'
}

export const api = {
  login: async (email: string, password: string) => {
    const base = getApiBase()
    const url = `${base}/v1/auth/login`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
    } catch {
      throw new Error(
        `Cannot reach the API (${url}). Use the same host for the panel (this page) and API port 4000, or set PUBLIC_API_URL correctly and rebuild the web image.`
      )
    }
    const text = await res.text()
    let json: { isSuccess?: boolean; message?: string; data?: { accessToken: string; user: UserProfile } }
    try {
      json = JSON.parse(text) as typeof json
    } catch {
      throw new Error(
        res.ok
          ? 'API returned non-JSON (check reverse proxy / web container).'
          : `API HTTP ${res.status}: ${text.slice(0, 180)}`
      )
    }
    if (!json.isSuccess) throw new Error(json.message ?? 'Login failed')
    return json.data as { accessToken: string; user: UserProfile }
  },

  me: () => get<UserProfile>('/v1/users/me'),

  servers: {
    list: () => get<ServerRecord[]>('/v1/servers'),
    get: (id: string) => get<ServerRecord[]>('/v1/servers').then(list => {
      const found = list.find(s => s.id === id)
      if (!found) throw new Error('Server not found')
      return found
    }),
    create: (data: {
      serverName: string
      templateId: string
      cpuLimit: number
      memoryMb: number
      diskMb: number
      ownerId?: string
      dockerImageKey?: string
      /** Minecraft game release (Paper/Vanilla/Forge/Bungee), not Java */
      gameVersion?: string
    }) => post<ServerRecord>('/v1/servers', data),
    updateResources: (id: string, data: { cpuLimit: number; memoryMb: number; diskMb: number }) =>
      patch<ServerRecord>(`/v1/servers/${id}`, data),
    assignOwner: (id: string, ownerId: string) =>
      patch<ServerRecord>(`/v1/servers/${id}/owner`, { ownerId }),
    power: (id: string, action: 'start' | 'stop' | 'restart') =>
      post<ServerRecord>(`/v1/servers/${id}/power`, { action }),
    delete: (id: string) => del<void>(`/v1/servers/${id}`),
    logs: (id: string) => get<{ lines: string[] }>(`/v1/servers/${id}/logs`).then(d => d.lines),
    syncStatus: (id: string) => get<ServerRecord>(`/v1/servers/${id}/status/sync`),
    command: (id: string, command: string) =>
      post<{ lines: string[] }>(`/v1/servers/${id}/console/command`, { command }).then(d => d.lines),
    network: {
      get: (id: string) => get<{ ports: number[] }>(`/v1/servers/${id}/network`),
      allocate: (id: string, amount: number) =>
        post<{ ports: number[] }>(`/v1/servers/${id}/network/allocate`, { amount }),
      release: (id: string, ports: number[]) =>
        post<{ ports: number[] }>(`/v1/servers/${id}/network/release`, { ports })
    },
    startup: {
      get: (id: string) =>
        get<{ content: string }>(`/v1/servers/${id}/startup-command`).then(d => d.content),
      set: (id: string, content: string) =>
        put<void>(`/v1/servers/${id}/startup-command`, { content })
    },
    files: {
      list: (id: string, path?: string) => {
        const qs = path ? `?path=${encodeURIComponent(path)}` : ''
        return get<{ entries: FileEntry[] }>(`/v1/servers/${id}/files${qs}`).then(d => d.entries)
      },
      read: (id: string, filePath: string) => {
        const qs = `?path=${encodeURIComponent(filePath)}`
        return get<{ content: string }>(`/v1/servers/${id}/files/content${qs}`).then(d => d.content)
      },
      write: (id: string, filePath: string, content: string) =>
        put<void>(`/v1/servers/${id}/files/content`, { path: filePath, content }),
      mkdir: (id: string, folderPath: string) =>
        post<void>(`/v1/servers/${id}/files/folder`, { path: folderPath }),
      delete: (id: string, filePath: string) => {
        const qs = `?path=${encodeURIComponent(filePath)}`
        return del<void>(`/v1/servers/${id}/files${qs}`)
      }
    }
  },

  templates: {
    list: () => get<TemplateRecord[]>('/v1/templates')
  },

  settings: {
    general: () => get<GeneralSettings>('/v1/settings/general'),
    hostCapacity: () => get<HostCapacityData>('/v1/settings/host-capacity'),
    updatePortPool: (nodeId: string, minPort: number, maxPort: number) =>
      patch<void>('/v1/settings/port-pool', { nodeId, minPort, maxPort }),
    updateHostingLimits: (limits: HostingLimits) =>
      patch<HostingLimits>('/v1/settings/hosting-limits', limits),
    apiKeys: () => get<ApiKeyRecord[]>('/v1/settings/api-keys'),
    createApiKey: (name: string, scope: 'orders' | 'admin') =>
      post<ApiKeyRecord>('/v1/settings/api-keys', { name, scope })
  },

  admin: {
    users: {
      list: () => get<UserProfile[]>('/v1/admin/users'),
      create: (email: string, password: string, role: 'admin' | 'user' = 'user') =>
        post<UserProfile>('/v1/admin/users', { email, password, role }),
      update: (
        userId: string,
        body: { email?: string; password?: string; role?: 'admin' | 'user' }
      ) => patch<UserProfile>(`/v1/admin/users/${userId}`, body)
    }
  },

  users: {
    me: () => get<UserProfile>('/v1/users/me'),
    updatePassword: (currentPassword: string, nextPassword: string) =>
      patch<void>('/v1/users/me/password', { currentPassword, nextPassword })
  }
}
