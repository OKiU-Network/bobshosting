import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { store, type UserRecord } from '../data/store.js'
import { allocatePorts, releasePorts } from '../core/network.js'
import { assertCanCreateServer, assertResourcesWithinCaps } from '../core/hosting-limits.js'
import { createServer, deleteServer, provisionFromOrder, setServerPower } from '../core/provision.js'
import {
  createContainerFolder,
  deleteContainerPath,
  executeContainerCommand,
  getContainerFileContent,
  getContainerFilesAtPath,
  getContainerLogs,
  getContainerStatus,
  getContainerStartupCommand,
  saveContainerFileContent,
  saveContainerStartupCommand
} from '../core/node-agent-client.js'

const idempotencyLog = new Map<string, unknown>()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4)
})

const createServerSchema = z.object({
  serverName: z.string().min(2),
  templateId: z.string().min(2),
  cpuLimit: z.number().int().min(10).max(1000).default(100),
  memoryMb: z.number().int().min(128).max(131072).default(1024),
  diskMb: z.number().int().min(1024).max(1048576).default(10240),
  ownerId: z.string().min(1).optional(),
  /** Pterodactyl docker_images key, e.g. Java 17 */
  dockerImageKey: z.string().min(1).optional(),
  /** Minecraft game version for Paper/Vanilla/Forge/Bungee (not Java runtime) */
  gameVersion: z.string().min(1).max(48).optional()
})

const portPoolSchema = z.object({
  nodeId: z.string().min(1),
  minPort: z.number().int().min(1).max(65534),
  maxPort: z.number().int().min(2).max(65535)
})

const hostingLimitsSchema = z.object({
  maxServersTotal: z.number().int().min(0),
  maxServersPerUser: z.number().int().min(0),
  maxCpuPerServer: z.number().int().min(0),
  maxMemoryMbPerServer: z.number().int().min(0),
  maxDiskMbPerServer: z.number().int().min(0)
})

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
  role: z.enum(['admin', 'user']).default('user')
})

const patchUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['admin', 'user']).optional()
})

const serverResourcesSchema = z.object({
  cpuLimit: z.number().int().min(10).max(1000),
  memoryMb: z.number().int().min(128).max(131072),
  diskMb: z.number().int().min(1024).max(1048576)
})

const powerSchema = z.object({
  action: z.enum(['start', 'stop', 'restart'])
})
const updatePasswordSchema = z.object({
  currentPassword: z.string().min(4),
  nextPassword: z.string().min(6)
})

const networkAllocateSchema = z.object({
  amount: z.number().int().min(1).max(10),
  preferredPorts: z.array(z.number().int().min(1).max(65535)).optional()
})
const filePathSchema = z.object({ path: z.string().min(1) })
const saveFileSchema = z.object({ path: z.string().min(1), content: z.string() })
const consoleCommandSchema = z.object({ command: z.string().min(1) })

const orderProvisionSchema = z.object({
  externalOrderId: z.string().min(1),
  userId: z.string().min(1),
  templateId: z.string().min(1),
  serverName: z.string().min(2),
  cpuLimit: z.number().int().min(10),
  memoryMb: z.number().int().min(128),
  diskMb: z.number().int().min(1024).default(10240),
  dockerImageKey: z.string().min(1).optional(),
  gameVersion: z.string().min(1).max(48).optional()
})
const createApiKeySchema = z.object({
  name: z.string().min(3).max(64),
  scope: z.enum(['orders', 'admin']).default('orders')
})

interface AuthPayload {
  userId: string
  role: 'admin' | 'user'
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify<AuthPayload>()
  } catch {
    reply.code(401).send({ isSuccess: false, message: 'Unauthorized' })
  }
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply)
  if (reply.sent) return
  const auth = request.user as AuthPayload
  if (auth.role !== 'admin') reply.code(403).send({ isSuccess: false, message: 'Admin only' })
}

function getServerIfAllowed(serverId: string, auth: AuthPayload) {
  const server = store.servers.find(entry => entry.id === serverId)
  if (!server) return undefined
  if (auth.role === 'admin' || server.ownerId === auth.userId) return server
  return undefined
}

function toPublicUser(user: UserRecord) {
  return { id: user.id, email: user.email, role: user.role }
}

export async function v1Routes(app: FastifyInstance): Promise<void> {
  function verifyWebshopKey(request: FastifyRequest): boolean {
    const apiKey = String(request.headers['x-api-key'] ?? '')
    const record = store.apiKeys.find(entry => entry.secret === apiKey)
    return Boolean(record && (record.scope === 'orders' || record.scope === 'admin'))
  }

  function getIdempotencyKey(request: FastifyRequest): string {
    return String(request.headers['idempotency-key'] ?? '')
  }

  app.get('/v1/health', async () => ({ isSuccess: true, message: 'API is healthy' }))

  app.post('/v1/auth/login', async request => {
    const payload = loginSchema.parse(request.body)
    const user = store.users.find(entry => entry.email === payload.email && entry.password === payload.password)
    if (!user) return { isSuccess: false, message: 'Invalid credentials' }

    const accessToken = await app.jwt.sign({ userId: user.id, role: user.role }, { expiresIn: '1h' })
    return {
      isSuccess: true,
      message: 'Login successful',
      data: { accessToken, user: toPublicUser(user) }
    }
  })

  app.get('/v1/users/me', { preHandler: requireAuth }, async request => {
    const auth = await request.jwtVerify<{ userId: string }>()
    const user = store.users.find(entry => entry.id === auth.userId)
    if (!user) return { isSuccess: false, message: 'User not found' }
    return { isSuccess: true, message: 'User loaded', data: toPublicUser(user) }
  })

  app.patch('/v1/users/me/password', { preHandler: requireAuth }, async request => {
    const auth = await request.jwtVerify<{ userId: string }>()
    const payload = updatePasswordSchema.parse(request.body)
    const user = store.users.find(entry => entry.id === auth.userId)
    if (!user) return { isSuccess: false, message: 'User not found' }
    if (user.password !== payload.currentPassword) return { isSuccess: false, message: 'Current password is invalid' }
    user.password = payload.nextPassword
    store.save()
    return { isSuccess: true, message: 'Password updated' }
  })

  app.get('/v1/settings/api-keys', { preHandler: requireAuth }, async request => {
    const auth = await request.jwtVerify<{ userId: string; role: 'admin' | 'user' }>()
    const keys = auth.role === 'admin' ? store.apiKeys : store.apiKeys.filter(entry => entry.userId === auth.userId)
    return {
      isSuccess: true,
      message: 'Api keys loaded',
      data: keys.map(entry => ({ ...entry, secret: `${entry.secret.slice(0, 4)}...${entry.secret.slice(-4)}` }))
    }
  })

  app.post('/v1/settings/api-keys', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const payload = createApiKeySchema.parse(request.body)
    if (payload.scope === 'admin' && auth.role !== 'admin') {
      return { isSuccess: false, message: 'Only admins can create admin-scoped API keys' }
    }
    const secret = `wk_${randomUUID().replaceAll('-', '')}`
    const nextKey = {
      id: randomUUID(),
      userId: auth.userId,
      name: payload.name,
      secret,
      scope: payload.scope,
      createdAt: new Date().toISOString()
    }
    store.apiKeys.push(nextKey)
    store.save()
    return { isSuccess: true, message: 'Api key created', data: nextKey }
  })

  app.get('/v1/settings/general', { preHandler: requireAuth }, async () => ({
    isSuccess: true,
    message: 'Settings loaded',
    data: {
      nodes: store.nodes.map(entry => ({
        id: entry.id,
        name: entry.name,
        host: entry.host,
        minPort: entry.minPort,
        maxPort: entry.maxPort,
        portPool: `${entry.minPort}-${entry.maxPort}`,
        usedPortCount: entry.usedPorts.length
      })),
      templates: store.templates.length,
      servers: store.servers.length,
      hostingLimits: { ...store.hostingLimits }
    }
  }))

  app.get('/v1/settings/host-capacity', { preHandler: requireAuth }, async () => {
    const node = store.nodes[0]
    if (!node) return { isSuccess: false, message: 'No node configured' }

    const base = node.host.replace(/\/$/, '')
    let host: {
      totalMemoryMb: number
      cpuCount: number
      platform: string
      hostname: string
    } | null = null
    let nodeRuntime: {
      platform: string
      runtimeDriver: string
      dockerAvailable: boolean
      windowsProcessLimitations: boolean
    } | null = null
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const capRes = await fetch(`${base}/host/capacity`, { signal: ctrl.signal })
      clearTimeout(timer)
      const capJson = (await capRes.json()) as {
        isSuccess?: boolean
        data?: { totalMemoryMb: number; cpuCount: number; platform: string; hostname: string }
      }
      if (capJson?.isSuccess && capJson.data) host = capJson.data
    } catch {
      host = null
    }
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const rtRes = await fetch(`${base}/runtime`, { signal: ctrl.signal })
      clearTimeout(timer)
      const rtJson = (await rtRes.json()) as {
        isSuccess?: boolean
        data?: {
          platform: string
          runtimeDriver: string
          dockerAvailable: boolean
          windowsProcessLimitations: boolean
        }
      }
      if (rtJson?.isSuccess && rtJson.data) nodeRuntime = rtJson.data
    } catch {
      nodeRuntime = null
    }

    const L = store.hostingLimits
    const defaultMemCap = 131072
    const defaultCpuCap = 1000
    const defaultDiskCap = 1048576

    let effectiveMemoryMb: number
    let effectiveCpuPercent: number
    const effectiveDiskMb = L.maxDiskMbPerServer > 0 ? L.maxDiskMbPerServer : defaultDiskCap

    if (host) {
      const reservedMb = 512
      const hostMemCap = Math.max(128, host.totalMemoryMb - reservedMb)
      const limitMem = L.maxMemoryMbPerServer > 0 ? L.maxMemoryMbPerServer : hostMemCap
      effectiveMemoryMb = Math.min(limitMem, hostMemCap)

      const hostCpuCap = Math.min(defaultCpuCap, host.cpuCount * 100)
      const limitCpu = L.maxCpuPerServer > 0 ? L.maxCpuPerServer : hostCpuCap
      effectiveCpuPercent = Math.min(limitCpu, hostCpuCap)
    } else {
      effectiveMemoryMb = L.maxMemoryMbPerServer > 0 ? L.maxMemoryMbPerServer : defaultMemCap
      effectiveCpuPercent = L.maxCpuPerServer > 0 ? L.maxCpuPerServer : defaultCpuCap
    }

    effectiveMemoryMb = Math.max(128, effectiveMemoryMb)
    effectiveCpuPercent = Math.max(10, Math.min(1000, effectiveCpuPercent))

    return {
      isSuccess: true,
      message: 'Host capacity',
      data: {
        host,
        nodeRuntime,
        hostingLimits: { ...L },
        effectiveMax: {
          cpuPercent: effectiveCpuPercent,
          memoryMb: effectiveMemoryMb,
          diskMb: Math.max(1024, effectiveDiskMb)
        }
      }
    }
  })

  app.patch('/v1/settings/port-pool', { preHandler: requireAdmin }, async request => {
    const payload = portPoolSchema.parse(request.body)
    if (payload.minPort >= payload.maxPort) {
      return { isSuccess: false, message: 'minPort must be less than maxPort' }
    }
    const node = store.nodes.find(n => n.id === payload.nodeId)
    if (!node) return { isSuccess: false, message: 'Node not found' }
    const outOfRange = node.usedPorts.filter(p => p < payload.minPort || p > payload.maxPort)
    if (outOfRange.length > 0) {
      return {
        isSuccess: false,
        message: `Cannot shrink pool: allocated ports outside range: ${outOfRange.join(', ')}`
      }
    }
    node.minPort = payload.minPort
    node.maxPort = payload.maxPort
    store.save()
    return { isSuccess: true, message: 'Port pool updated' }
  })

  app.patch('/v1/settings/hosting-limits', { preHandler: requireAdmin }, async request => {
    const payload = hostingLimitsSchema.parse(request.body)
    Object.assign(store.hostingLimits, payload)
    store.save()
    return { isSuccess: true, message: 'Hosting limits updated', data: { ...store.hostingLimits } }
  })

  app.get('/v1/admin/users', { preHandler: requireAdmin }, async () => ({
    isSuccess: true,
    message: 'Users loaded',
    data: store.users.map(toPublicUser)
  }))

  app.post('/v1/admin/users', { preHandler: requireAdmin }, async request => {
    const payload = createUserSchema.parse(request.body)
    if (store.users.some(u => u.email === payload.email)) {
      return { isSuccess: false, message: 'A user with this email already exists' }
    }
    const user: UserRecord = {
      id: `u-${randomUUID().slice(0, 8)}`,
      email: payload.email,
      password: payload.password,
      role: payload.role
    }
    store.users.push(user)
    store.save()
    return { isSuccess: true, message: 'User created', data: toPublicUser(user) }
  })

  app.patch('/v1/admin/users/:userId', { preHandler: requireAdmin }, async request => {
    const params = request.params as { userId: string }
    const payload = patchUserSchema.parse(request.body)
    const user = store.users.find(u => u.id === params.userId)
    if (!user) return { isSuccess: false, message: 'User not found' }
    if (payload.email !== undefined) {
      const taken = store.users.some(u => u.id !== user.id && u.email === payload.email)
      if (taken) return { isSuccess: false, message: 'Email already in use' }
      user.email = payload.email
    }
    if (payload.password !== undefined) user.password = payload.password
    if (payload.role !== undefined) user.role = payload.role
    store.save()
    return { isSuccess: true, message: 'User updated', data: toPublicUser(user) }
  })

  app.get('/v1/templates', { preHandler: requireAuth }, async () => ({
    isSuccess: true,
    message: 'Templates fetched',
    data: store.templates
  }))

  app.get('/v1/servers', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const data =
      auth.role === 'admin' ? store.servers : store.servers.filter(s => s.ownerId === auth.userId)
    return { isSuccess: true, message: 'Servers fetched', data }
  })

  app.post('/v1/servers', { preHandler: requireAuth }, async request => {
    try {
      const payload = createServerSchema.parse(request.body)
      const auth = request.user as AuthPayload
      let ownerId = auth.userId
      if (auth.role === 'admin' && payload.ownerId) {
        const target = store.users.find(u => u.id === payload.ownerId)
        if (!target) return { isSuccess: false, message: 'Owner user not found' }
        ownerId = payload.ownerId
      }
      assertCanCreateServer({
        ownerId,
        cpuLimit: payload.cpuLimit,
        memoryMb: payload.memoryMb,
        diskMb: payload.diskMb
      })
      const server = await createServer({
        userId: ownerId,
        serverName: payload.serverName,
        templateId: payload.templateId,
        cpuLimit: payload.cpuLimit,
        memoryMb: payload.memoryMb,
        diskMb: payload.diskMb,
        dockerImageKey: payload.dockerImageKey,
        gameVersion: payload.gameVersion
      })
      return { isSuccess: true, message: 'Server created', data: server }
    } catch (error) {
      return { isSuccess: false, message: (error as Error).message }
    }
  })

  app.post('/v1/servers/:serverId/power', { preHandler: requireAuth }, async request => {
    try {
      const auth = request.user as AuthPayload
      const params = request.params as { serverId: string }
      if (!getServerIfAllowed(params.serverId, auth)) return { isSuccess: false, message: 'Server not found' }
      const payload = powerSchema.parse(request.body)
      const server = await setServerPower(params.serverId, payload.action)
      return { isSuccess: true, message: 'Power state updated', data: server }
    } catch (error) {
      return { isSuccess: false, message: (error as Error).message }
    }
  })

  app.get('/v1/servers/:serverId/status/sync', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    const agentStatus = await getContainerStatus({ nodeId: server.nodeId, serverId: server.id }).catch(() => null)
    if (agentStatus && agentStatus !== 'unknown') {
      const mapped = agentStatus === 'running' ? 'running'
        : agentStatus === 'error' ? 'error'
        : agentStatus === 'installing' ? 'installing'
        : 'stopped'
      server.status = mapped as typeof server.status
      store.save()
    }
    return { isSuccess: true, message: 'Status synced', data: server }
  })

  app.delete('/v1/servers/:serverId', { preHandler: requireAuth }, async request => {
    try {
      const auth = request.user as AuthPayload
      const params = request.params as { serverId: string }
      if (!getServerIfAllowed(params.serverId, auth)) return { isSuccess: false, message: 'Server not found' }
      await deleteServer(params.serverId)
      return { isSuccess: true, message: 'Server deleted' }
    } catch (error) {
      return { isSuccess: false, message: (error as Error).message }
    }
  })

  app.patch('/v1/servers/:serverId', { preHandler: requireAuth }, async request => {
    try {
      const auth = request.user as AuthPayload
      const params = request.params as { serverId: string }
      const server = getServerIfAllowed(params.serverId, auth)
      if (!server) return { isSuccess: false, message: 'Server not found' }
      const payload = serverResourcesSchema.parse(request.body)
      assertResourcesWithinCaps(payload)
      server.cpuLimit = payload.cpuLimit
      server.memoryMb = payload.memoryMb
      server.diskMb = payload.diskMb
      store.save()
      return { isSuccess: true, message: 'Server updated', data: server }
    } catch (error) {
      return { isSuccess: false, message: (error as Error).message }
    }
  })

  app.patch('/v1/servers/:serverId/owner', { preHandler: requireAdmin }, async request => {
    const params = request.params as { serverId: string }
    const body = z.object({ ownerId: z.string().min(1) }).parse(request.body)
    const server = store.servers.find(s => s.id === params.serverId)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    const nextOwner = store.users.find(u => u.id === body.ownerId)
    if (!nextOwner) return { isSuccess: false, message: 'User not found' }
    server.ownerId = body.ownerId
    store.save()
    return { isSuccess: true, message: 'Owner updated', data: server }
  })

  app.get('/v1/servers/:serverId/network', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    return { isSuccess: true, message: 'Network fetched', data: { ports: server.allocatedPorts } }
  })

  app.post('/v1/servers/:serverId/network/allocate', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const payload = networkAllocateSchema.parse(request.body)
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }

    const ports = allocatePorts({ nodeId: server.nodeId, amount: payload.amount, preferredPorts: payload.preferredPorts })
    server.allocatedPorts = [...new Set([...server.allocatedPorts, ...ports])]
    store.save()
    return { isSuccess: true, message: 'Ports allocated', data: { ports: server.allocatedPorts } }
  })

  app.post('/v1/servers/:serverId/network/release', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const payload = z.object({ ports: z.array(z.number().int()) }).parse(request.body)
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }

    releasePorts(server.nodeId, payload.ports)
    server.allocatedPorts = server.allocatedPorts.filter(port => !payload.ports.includes(port))
    store.save()
    return { isSuccess: true, message: 'Ports released', data: { ports: server.allocatedPorts } }
  })

  app.get('/v1/servers/:serverId/files', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const query = request.query as { path?: string }
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }

    const entries = await getContainerFilesAtPath({ nodeId: server.nodeId, serverId: server.id, targetPath: query.path })
    return {
      isSuccess: true,
      message: 'Files fetched',
      data: { serverId: params.serverId, entries }
    }
  })

  app.get('/v1/servers/:serverId/files/content', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const query = filePathSchema.parse(request.query)
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    const content = await getContainerFileContent({ nodeId: server.nodeId, serverId: server.id, targetPath: query.path })
    return { isSuccess: true, message: 'File loaded', data: { content } }
  })

  app.put('/v1/servers/:serverId/files/content', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const payload = saveFileSchema.parse(request.body)
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    await saveContainerFileContent({ nodeId: server.nodeId, serverId: server.id, targetPath: payload.path, content: payload.content })
    return { isSuccess: true, message: 'File saved' }
  })

  app.post('/v1/servers/:serverId/files/folder', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const payload = filePathSchema.parse(request.body)
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    await createContainerFolder({ nodeId: server.nodeId, serverId: server.id, targetPath: payload.path })
    return { isSuccess: true, message: 'Folder created' }
  })

  app.get('/v1/servers/:serverId/startup-command', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    const content = await getContainerStartupCommand({ nodeId: server.nodeId, serverId: server.id })
    return { isSuccess: true, message: 'Startup command fetched', data: { content } }
  })

  app.put('/v1/servers/:serverId/startup-command', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const payload = z.object({ content: z.string() }).parse(request.body)
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    await saveContainerStartupCommand({ nodeId: server.nodeId, serverId: server.id, content: payload.content })
    return { isSuccess: true, message: 'Startup command saved' }
  })

  app.delete('/v1/servers/:serverId/files', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const query = filePathSchema.parse(request.query)
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    await deleteContainerPath({ nodeId: server.nodeId, serverId: server.id, targetPath: query.path })
    return { isSuccess: true, message: 'Path deleted' }
  })

  app.get('/v1/servers/:serverId/logs', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }

    const lines = await getContainerLogs({ nodeId: server.nodeId, serverId: server.id })
    return {
      isSuccess: true,
      message: 'Logs fetched',
      data: { serverId: params.serverId, lines }
    }
  })

  app.post('/v1/servers/:serverId/console/command', { preHandler: requireAuth }, async request => {
    const auth = request.user as AuthPayload
    const params = request.params as { serverId: string }
    const payload = consoleCommandSchema.parse(request.body)
    const server = getServerIfAllowed(params.serverId, auth)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    const lines = await executeContainerCommand({ nodeId: server.nodeId, serverId: server.id, command: payload.command })
    return { isSuccess: true, message: 'Command executed', data: { lines } }
  })

  app.post('/v1/orders/provision', async request => {
    if (!verifyWebshopKey(request)) return { isSuccess: false, message: 'Invalid webshop api key' }
    const idempotencyKey = getIdempotencyKey(request)
    if (idempotencyKey && idempotencyLog.has(idempotencyKey)) return idempotencyLog.get(idempotencyKey)
    try {
      const payload = orderProvisionSchema.parse(request.body)
      if (!store.users.some(u => u.id === payload.userId)) {
        return { isSuccess: false, message: 'userId must match an existing panel user' }
      }
      assertCanCreateServer({
        ownerId: payload.userId,
        cpuLimit: payload.cpuLimit,
        memoryMb: payload.memoryMb,
        diskMb: payload.diskMb
      })
      const server = await provisionFromOrder(payload)
      const result = { isSuccess: true, message: 'Order provisioned', data: server }
      if (idempotencyKey) idempotencyLog.set(idempotencyKey, result)
      return result
    } catch (error) {
      return { isSuccess: false, message: (error as Error).message }
    }
  })

  app.post('/v1/orders/suspend', async request => {
    if (!verifyWebshopKey(request)) return { isSuccess: false, message: 'Invalid webshop api key' }
    try {
      const payload = z.object({ serverId: z.string() }).parse(request.body)
      const server = await setServerPower(payload.serverId, 'stop')
      return { isSuccess: true, message: 'Order suspended', data: server }
    } catch (error) {
      return { isSuccess: false, message: (error as Error).message }
    }
  })

  app.post('/v1/orders/unsuspend', async request => {
    if (!verifyWebshopKey(request)) return { isSuccess: false, message: 'Invalid webshop api key' }
    try {
      const payload = z.object({ serverId: z.string() }).parse(request.body)
      const server = await setServerPower(payload.serverId, 'start')
      return { isSuccess: true, message: 'Order unsuspended', data: server }
    } catch (error) {
      return { isSuccess: false, message: (error as Error).message }
    }
  })

  app.post('/v1/orders/cancel', async request => {
    if (!verifyWebshopKey(request)) return { isSuccess: false, message: 'Invalid webshop api key' }
    const payload = z.object({ serverId: z.string() }).parse(request.body)
    const server = store.servers.find(entry => entry.id === payload.serverId)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    server.status = 'stopped'
    store.save()
    return { isSuccess: true, message: 'Order cancelled', data: server }
  })

  app.post('/v1/orders/change-plan', async request => {
    if (!verifyWebshopKey(request)) return { isSuccess: false, message: 'Invalid webshop api key' }
    const payload = z.object({ serverId: z.string(), cpuLimit: z.number().int(), memoryMb: z.number().int(), diskMb: z.number().int() }).parse(request.body)
    const server = store.servers.find(entry => entry.id === payload.serverId)
    if (!server) return { isSuccess: false, message: 'Server not found' }
    server.cpuLimit = payload.cpuLimit
    server.memoryMb = payload.memoryMb
    server.diskMb = payload.diskMb
    store.save()
    return { isSuccess: true, message: 'Plan changed', data: payload }
  })
}
