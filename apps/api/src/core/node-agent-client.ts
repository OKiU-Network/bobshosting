import { store } from '../data/store.js'

interface AgentProvisionInput {
  nodeId: string
  serverId: string
  templateId: string
  image: string
  startupCommand: string
  ports: number[]
  env: Record<string, string>
  cpuLimit: number
  memoryMb: number
  diskMb: number
  installPipelineId?: string
}

interface AgentPowerInput {
  nodeId: string
  serverId: string
  action: 'start' | 'stop' | 'restart'
  stopCommand?: string
}

function getNodeUrl(nodeId: string): string {
  const node = store.nodes.find(entry => entry.id === nodeId)
  if (!node) throw new Error(`Node not found: ${nodeId}`)
  return node.host
}

async function parseResponse(response: Response): Promise<any> {
  const payload = await response.json()
  if (!response.ok || payload?.isSuccess === false) throw new Error(payload?.message ?? 'Node agent request failed')
  return payload
}

export async function provisionContainer(input: AgentProvisionInput): Promise<void> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/provision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      serverId: input.serverId,
      templateId: input.templateId,
      installPipelineId: input.installPipelineId,
      image: input.image,
      startupCommand: input.startupCommand,
      ports: input.ports,
      env: input.env,
      cpuLimit: input.cpuLimit,
      memoryMb: input.memoryMb,
      diskMb: input.diskMb
    })
  })
  await parseResponse(response)
}

export async function setContainerPower(input: AgentPowerInput): Promise<void> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/power`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: input.action, stopCommand: input.stopCommand })
  })
  await parseResponse(response)
}

export async function getContainerFiles(input: { nodeId: string; serverId: string }): Promise<any[]> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/files`)
  const payload = await parseResponse(response)
  return payload.data?.entries ?? []
}

export async function getContainerLogs(input: { nodeId: string; serverId: string }): Promise<string[]> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/logs`)
  const payload = await parseResponse(response)
  return payload.data?.lines ?? []
}

export async function getContainerStatus(input: { nodeId: string; serverId: string }): Promise<string> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/status`)
  const payload = await response.json()
  return payload.data?.status ?? 'unknown'
}

export async function deleteContainer(input: { nodeId: string; serverId: string }): Promise<void> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}`, {
    method: 'DELETE'
  })
  await parseResponse(response)
}

export async function getContainerFilesAtPath(input: { nodeId: string; serverId: string; targetPath?: string }): Promise<any[]> {
  const searchParams = new URLSearchParams()
  if (input.targetPath) searchParams.set('path', input.targetPath)
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/files${suffix}`)
  const payload = await parseResponse(response)
  return payload.data?.entries ?? []
}

export async function getContainerFileContent(input: { nodeId: string; serverId: string; targetPath: string }): Promise<string> {
  const searchParams = new URLSearchParams({ path: input.targetPath })
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/files/content?${searchParams.toString()}`)
  const payload = await parseResponse(response)
  return payload.data?.content ?? ''
}

export async function getContainerStartupCommand(input: { nodeId: string; serverId: string }): Promise<string> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/startup-command`)
  const payload = await parseResponse(response)
  return payload.data?.content ?? ''
}

export async function saveContainerStartupCommand(input: {
  nodeId: string
  serverId: string
  content: string
}): Promise<void> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/startup-command`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: input.content })
  })
  await parseResponse(response)
}

export async function saveContainerFileContent(input: {
  nodeId: string
  serverId: string
  targetPath: string
  content: string
}): Promise<void> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/files/content`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: input.targetPath, content: input.content })
  })
  await parseResponse(response)
}

export async function createContainerFolder(input: { nodeId: string; serverId: string; targetPath: string }): Promise<void> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/files/folder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: input.targetPath })
  })
  await parseResponse(response)
}

export async function deleteContainerPath(input: { nodeId: string; serverId: string; targetPath: string }): Promise<void> {
  const searchParams = new URLSearchParams({ path: input.targetPath })
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/files?${searchParams.toString()}`, {
    method: 'DELETE'
  })
  await parseResponse(response)
}

export async function executeContainerCommand(input: { nodeId: string; serverId: string; command: string }): Promise<string[]> {
  const response = await fetch(`${getNodeUrl(input.nodeId)}/containers/${input.serverId}/console/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: input.command })
  })
  const payload = await parseResponse(response)
  return payload.data?.lines ?? []
}
