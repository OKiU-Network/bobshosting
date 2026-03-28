import { store } from '../data/store.js'

export interface AllocatePortsInput {
  nodeId: string
  amount: number
  preferredPorts?: number[]
}

export function allocatePorts(input: AllocatePortsInput): number[] {
  if (input.amount < 0) return []

  const node = store.nodes.find(entry => entry.id === input.nodeId)
  if (!node) throw new Error(`Node not found: ${input.nodeId}`)

  const allocatedPorts: number[] = []
  const preferredPorts = input.preferredPorts ?? []

  const usedPortSet = new Set(node.usedPorts)

  for (const preferredPort of preferredPorts) {
    if (allocatedPorts.length >= input.amount) break
    if (preferredPort < node.minPort || preferredPort > node.maxPort) continue
    if (usedPortSet.has(preferredPort)) continue
    usedPortSet.add(preferredPort)
    allocatedPorts.push(preferredPort)
  }

  for (let currentPort = node.minPort; currentPort <= node.maxPort; currentPort += 1) {
    if (allocatedPorts.length >= input.amount) break
    if (usedPortSet.has(currentPort)) continue
    usedPortSet.add(currentPort)
    allocatedPorts.push(currentPort)
  }

  if (allocatedPorts.length < input.amount) {
    throw new Error(`No free ports available for node ${node.id}`)
  }

  node.usedPorts = [...usedPortSet].sort((left, right) => left - right)
  store.save()
  return allocatedPorts
}

export function releasePorts(nodeId: string, ports: number[]): void {
  const node = store.nodes.find(entry => entry.id === nodeId)
  if (!node) throw new Error(`Node not found: ${nodeId}`)
  const releaseSet = new Set(ports)
  node.usedPorts = node.usedPorts.filter(port => !releaseSet.has(port))
  store.save()
}
