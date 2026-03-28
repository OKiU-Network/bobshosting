import { randomUUID } from 'node:crypto'
import type { ProvisionOrderInput, ServerRecord } from '@wave/shared'
import { getTemplateById, store } from '../data/store'
import { allocatePorts, releasePorts } from './network'
import { resolveDockerImage, resolveStartupCommand } from './template-runtime'

/** Maps panel "game version" to the correct Pterodactyl egg env key (Java image stays separate). */
export function applyGameVersionToTemplateEnv(
  templateId: string,
  env: Record<string, string>,
  gameVersion?: string
): Record<string, string> {
  const v = gameVersion?.trim()
  if (!v) return { ...env }
  const id = templateId.toLowerCase()
  const next = { ...env }
  if (id.includes('minecraft-paper')) {
    next.MINECRAFT_VERSION = v
    return next
  }
  if (id.includes('vanilla-minecraft')) {
    next.VANILLA_VERSION = v
    return next
  }
  if (id.includes('forge-minecraft')) {
    next.MC_VERSION = v
    return next
  }
  if (id.includes('bungeecord')) {
    next.BUNGEE_VERSION = v
    return next
  }
  return { ...env }
}
import { deleteContainer, provisionContainer, setContainerPower } from './node-agent-client'

interface CreateServerInput {
  userId: string
  serverName: string
  templateId: string
  cpuLimit: number
  memoryMb: number
  diskMb: number
  dockerImageKey?: string
  /** Minecraft game / jar track version (e.g. 1.21.4), not Java */
  gameVersion?: string
}

function validateDockerImageKey(
  template: { dockerImages?: Record<string, string> },
  key?: string
): void {
  if (!key) return
  const map = template.dockerImages
  if (!map || !Object.keys(map).length) {
    throw new Error('This template does not support versioned images')
  }
  if (!map[key]) throw new Error(`Unknown image version: ${key}`)
}

export async function createServer(input: CreateServerInput): Promise<ServerRecord> {
  const template = getTemplateById(input.templateId)
  if (!template) throw new Error('Template not found')

  validateDockerImageKey(template, input.dockerImageKey)

  const node = store.nodes[0]
  if (!node) throw new Error('No nodes configured')

  const image = resolveDockerImage(template, input.dockerImageKey)
  const mergedEnv = applyGameVersionToTemplateEnv(template.id, { ...template.env }, input.gameVersion)
  const allocatedPorts = allocatePorts({
    nodeId: node.id,
    amount: Math.max(1, template.defaultPorts.length),
    preferredPorts: template.defaultPorts
  })

  const startupCommand = resolveStartupCommand({
    command: template.startupCommand,
    memoryMb: input.memoryMb,
    ports: allocatedPorts,
    env: mergedEnv
  })

  const server: ServerRecord = {
    id: randomUUID(),
    ownerId: input.userId,
    templateId: template.id,
    nodeId: node.id,
    name: input.serverName,
    status: 'installing',
    allocatedPorts,
    cpuLimit: input.cpuLimit,
    memoryMb: input.memoryMb,
    diskMb: input.diskMb,
    dockerImageKey: input.dockerImageKey ?? template.defaultDockerImageKey
  }

  store.servers.push(server)
  store.save()

  try {
    await provisionContainer({
      nodeId: node.id,
      serverId: server.id,
      templateId: template.id,
      installPipelineId: template.installPipelineId,
      image,
      startupCommand,
      ports: allocatedPorts,
      env: mergedEnv,
      cpuLimit: input.cpuLimit,
      memoryMb: input.memoryMb,
      diskMb: input.diskMb
    })
    store.save()
    return server
  } catch (error) {
    releasePorts(node.id, allocatedPorts)
    const filteredServers = store.servers.filter(entry => entry.id !== server.id)
    store.servers.splice(0, store.servers.length, ...filteredServers)
    store.save()
    throw error
  }
}

export async function provisionFromOrder(input: ProvisionOrderInput): Promise<ServerRecord> {
  return createServer({
    userId: input.userId,
    serverName: input.serverName,
    templateId: input.templateId,
    cpuLimit: input.cpuLimit,
    memoryMb: input.memoryMb,
    diskMb: input.diskMb,
    dockerImageKey: input.dockerImageKey,
    gameVersion: input.gameVersion
  })
}

export async function setServerPower(serverId: string, action: 'start' | 'stop' | 'restart'): Promise<ServerRecord> {
  const server = store.servers.find(entry => entry.id === serverId)
  if (!server) throw new Error('Server not found')

  const template = getTemplateById(server.templateId)
  const stopCommand = template?.stopCommand ?? ''

  await setContainerPower({ nodeId: server.nodeId, serverId: server.id, action, stopCommand })
  if (action === 'stop') server.status = 'stopped'
  if (action === 'start' || action === 'restart') server.status = 'running'
  store.save()

  return server
}

export async function deleteServer(serverId: string): Promise<void> {
  const server = store.servers.find(entry => entry.id === serverId)
  if (!server) throw new Error('Server not found')

  await deleteContainer({ nodeId: server.nodeId, serverId: server.id })
  releasePorts(server.nodeId, server.allocatedPorts)
  const nextServers = store.servers.filter(entry => entry.id !== server.id)
  store.servers.splice(0, store.servers.length, ...nextServers)
  store.save()
}
