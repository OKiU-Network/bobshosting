import { store } from '../data/store'

export function assertCanCreateServer(input: {
  ownerId: string
  cpuLimit: number
  memoryMb: number
  diskMb: number
}): void {
  const limits = store.hostingLimits
  if (limits.maxCpuPerServer > 0 && input.cpuLimit > limits.maxCpuPerServer) {
    throw new Error(`CPU limit cannot exceed ${limits.maxCpuPerServer}% (platform cap)`)
  }
  if (limits.maxMemoryMbPerServer > 0 && input.memoryMb > limits.maxMemoryMbPerServer) {
    throw new Error(`Memory cannot exceed ${limits.maxMemoryMbPerServer} MB (platform cap)`)
  }
  if (limits.maxDiskMbPerServer > 0 && input.diskMb > limits.maxDiskMbPerServer) {
    throw new Error(`Disk cannot exceed ${limits.maxDiskMbPerServer} MB (platform cap)`)
  }
  if (limits.maxServersTotal > 0 && store.servers.length >= limits.maxServersTotal) {
    throw new Error(`Maximum server count reached (${limits.maxServersTotal})`)
  }
  const owned = store.servers.filter(s => s.ownerId === input.ownerId).length
  if (limits.maxServersPerUser > 0 && owned >= limits.maxServersPerUser) {
    throw new Error(`This user already has the maximum number of servers (${limits.maxServersPerUser})`)
  }
}

export function assertResourcesWithinCaps(input: { cpuLimit: number; memoryMb: number; diskMb: number }): void {
  const limits = store.hostingLimits
  if (limits.maxCpuPerServer > 0 && input.cpuLimit > limits.maxCpuPerServer) {
    throw new Error(`CPU limit cannot exceed ${limits.maxCpuPerServer}%`)
  }
  if (limits.maxMemoryMbPerServer > 0 && input.memoryMb > limits.maxMemoryMbPerServer) {
    throw new Error(`Memory cannot exceed ${limits.maxMemoryMbPerServer} MB`)
  }
  if (limits.maxDiskMbPerServer > 0 && input.diskMb > limits.maxDiskMbPerServer) {
    throw new Error(`Disk cannot exceed ${limits.maxDiskMbPerServer} MB`)
  }
}
