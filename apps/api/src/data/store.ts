import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerRecord, ServerRuntimeTemplate } from '@wave/shared'

export interface UserRecord {
  id: string
  email: string
  role: 'admin' | 'user'
  password: string
}

export interface NodeRecord {
  id: string
  name: string
  host: string
  minPort: number
  maxPort: number
  usedPorts: number[]
}

export interface ApiKeyRecord {
  id: string
  userId: string
  name: string
  secret: string
  scope: 'orders' | 'admin'
  createdAt: string
}

/** 0 = unlimited for numeric caps */
export interface HostingLimitsRecord {
  maxServersTotal: number
  maxServersPerUser: number
  maxCpuPerServer: number
  maxMemoryMbPerServer: number
  maxDiskMbPerServer: number
}

export const DEFAULT_HOSTING_LIMITS: HostingLimitsRecord = {
  maxServersTotal: 0,
  maxServersPerUser: 50,
  maxCpuPerServer: 1000,
  maxMemoryMbPerServer: 131072,
  maxDiskMbPerServer: 1048576
}

interface PersistedStore {
  users: UserRecord[]
  nodes: NodeRecord[]
  servers: ServerRecord[]
  apiKeys: ApiKeyRecord[]
  hostingLimits?: HostingLimitsRecord
}

function loadPterodactylTemplates(): ServerRuntimeTemplate[] {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const bundlePath = path.join(here, 'pterodactyl-eggs.json')
  try {
    const raw = fs.readFileSync(bundlePath, 'utf-8')
    const parsed = JSON.parse(raw) as { templates?: ServerRuntimeTemplate[] }
    if (!parsed || !Array.isArray(parsed.templates)) {
      throw new Error('pterodactyl-eggs.json: missing templates array')
    }
    return parsed.templates
  } catch (err) {
    console.error(`[wave-api] Cannot load template bundle at ${bundlePath}`, err)
    throw err
  }
}

/** Games not in stock Pterodactyl seeds — single-image templates */
const extraGameTemplates: ServerRuntimeTemplate[] = [
  {
    id: 'cs2',
    name: 'Counter-Strike 2',
    category: 'game',
    image: 'cm2network/cs2',
    startupCommand: './srcds_run -game csgo',
    stopCommand: 'quit',
    defaultPorts: [27015],
    env: { SRCDS_TOKEN: '' }
  },
  {
    id: 'valheim',
    name: 'Valheim',
    category: 'game',
    image: 'lloesche/valheim-server',
    startupCommand: './valheim_server.x86_64 -name "Wave Server" -port {{port}} -nographics -batchmode',
    stopCommand: '',
    defaultPorts: [2456],
    env: { SERVER_NAME: 'Wave Valheim', SERVER_PASS: 'changeme' }
  },
  {
    id: 'terraria',
    name: 'Terraria',
    category: 'game',
    image: 'ryshe/terraria',
    startupCommand: 'mono TerrariaServer.exe -port {{port}} -autocreate 1 -worldname wave',
    stopCommand: 'exit',
    defaultPorts: [7777],
    env: {}
  }
]

const pythonTemplates: ServerRuntimeTemplate[] = [
  {
    id: 'python-fastapi',
    name: 'Python FastAPI',
    category: 'python',
    image: 'python:3.12-slim',
    startupCommand: 'uvicorn app:app --host 0.0.0.0 --port {{port}}',
    stopCommand: '',
    defaultPorts: [8000],
    env: { APP_ENV: 'production' },
    installPipelineId: 'python-fastapi'
  },
  {
    id: 'python-worker',
    name: 'Python Worker',
    category: 'python',
    image: 'python:3.12-slim',
    startupCommand: 'python worker.py',
    stopCommand: '',
    defaultPorts: [],
    env: { APP_ENV: 'production' },
    installPipelineId: 'python-worker'
  }
]

/** Persisted panel IDs → current bundled id */
const TEMPLATE_ID_ALIASES: Record<string, string> = {
  'minecraft-paper': 'ptero-minecraft-paper'
}

export function resolveTemplateId(templateId: string): string {
  return TEMPLATE_ID_ALIASES[templateId] ?? templateId
}

const templates: ServerRuntimeTemplate[] = [
  ...loadPterodactylTemplates(),
  ...extraGameTemplates,
  ...pythonTemplates
]

const users: UserRecord[] = [
  { id: 'u-admin', email: 'admin@local.dev', role: 'admin', password: 'admin123' }
]

const nodes: NodeRecord[] = [
  {
    id: 'node-1',
    name: 'Primary Node',
    host: process.env.REMOTE_AGENT_URL ?? 'http://127.0.0.1:7001',
    minPort: 20000,
    maxPort: 40000,
    usedPorts: []
  }
]

const servers: ServerRecord[] = []
const hostingLimits: HostingLimitsRecord = { ...DEFAULT_HOSTING_LIMITS }
const apiKeys: ApiKeyRecord[] = [
  {
    id: 'key-1',
    userId: 'u-admin',
    name: 'Default Internal Webshop Key',
    secret: 'dev-webshop-key',
    scope: 'orders',
    createdAt: new Date().toISOString()
  }
]

function getDataDirectoryPath() {
  return path.resolve(process.cwd(), '.data')
}

function getStorePath() {
  return path.join(getDataDirectoryPath(), 'store.json')
}

function normalizePersistedStore(raw: unknown): PersistedStore | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.users) || !Array.isArray(o.nodes) || !Array.isArray(o.servers)) return null
  if (o.apiKeys !== undefined && !Array.isArray(o.apiKeys)) return null
  if (o.hostingLimits !== undefined && (typeof o.hostingLimits !== 'object' || o.hostingLimits === null)) return null
  return {
    users: o.users as UserRecord[],
    nodes: o.nodes as NodeRecord[],
    servers: o.servers as ServerRecord[],
    apiKeys: (o.apiKeys as ApiKeyRecord[] | undefined) ?? [],
    hostingLimits: o.hostingLimits as HostingLimitsRecord | undefined
  }
}

function loadPersistedStore(): PersistedStore | null {
  const storePath = getStorePath()
  if (!fs.existsSync(storePath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as unknown
    const normalized = normalizePersistedStore(raw)
    if (!normalized) {
      console.error(
        `[wave-api] Ignoring invalid store.json (${storePath}) — expected users, nodes, servers arrays. Remove the file to start fresh.`
      )
      return null
    }
    return normalized
  } catch (err) {
    console.error('[wave-api] Failed to read store.json; using seed defaults.', err)
    return null
  }
}

function savePersistedStore(input: PersistedStore): void {
  const dataDirectoryPath = getDataDirectoryPath()
  if (!fs.existsSync(dataDirectoryPath)) fs.mkdirSync(dataDirectoryPath, { recursive: true })
  fs.writeFileSync(getStorePath(), JSON.stringify(input, null, 2), 'utf-8')
}

const persistedStore = loadPersistedStore()
if (persistedStore) {
  users.splice(0, users.length, ...persistedStore.users)
  nodes.splice(0, nodes.length, ...persistedStore.nodes)
  const hydratedServers = persistedStore.servers.map(server => ({
    ...server,
    cpuLimit: server.cpuLimit ?? 100,
    memoryMb: server.memoryMb ?? 1024,
    diskMb: server.diskMb ?? 10240,
    dockerImageKey: server.dockerImageKey
  }))
  servers.splice(0, servers.length, ...hydratedServers)
  apiKeys.splice(0, apiKeys.length, ...(persistedStore.apiKeys ?? []))
  if (persistedStore.hostingLimits) {
    Object.assign(hostingLimits, { ...DEFAULT_HOSTING_LIMITS, ...persistedStore.hostingLimits })
  }
}

export function getTemplateById(templateId: string): ServerRuntimeTemplate | undefined {
  const resolved = resolveTemplateId(templateId)
  return templates.find(entry => entry.id === resolved)
}

export const store = {
  templates,
  users,
  nodes,
  servers,
  apiKeys,
  hostingLimits,
  save() {
    savePersistedStore({
      users,
      nodes,
      servers,
      apiKeys,
      hostingLimits: { ...hostingLimits }
    })
  }
}
