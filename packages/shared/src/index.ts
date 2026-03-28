export interface ApiResponse<TData> {
  isSuccess: boolean
  message: string
  data?: TData
}

export interface ServerRuntimeTemplate {
  id: string
  name: string
  category: 'game' | 'python'
  /** Fallback when dockerImages is absent */
  image: string
  /** Pterodactyl-style: human-readable key → image ref (e.g. Java version) */
  dockerImages?: Record<string, string>
  /** Default key in dockerImages (e.g. Java 21) */
  defaultDockerImageKey?: string
  startupCommand: string
  stopCommand: string
  defaultPorts: number[]
  env: Record<string, string>
  eggAuthor?: string
  eggDescription?: string
  pteroFeatures?: string[]
  /** Original panel path, e.g. database/Seeders/eggs/minecraft/egg-paper.json */
  sourcePath?: string
  /** Node-agent install handler id (e.g. minecraft-paper) */
  installPipelineId?: string
}

export interface ServerRecord {
  id: string
  name: string
  ownerId: string
  templateId: string
  nodeId: string
  status: 'stopped' | 'running' | 'installing' | 'error'
  allocatedPorts: number[]
  cpuLimit: number
  memoryMb: number
  diskMb: number
  /** Selected dockerImages key at create time (e.g. Java 17) */
  dockerImageKey?: string
}

export interface ProvisionOrderInput {
  externalOrderId: string
  userId: string
  templateId: string
  serverName: string
  cpuLimit: number
  memoryMb: number
  diskMb: number
  dockerImageKey?: string
  /** Minecraft/Paper-style game version (e.g. 1.21.4, latest) — not the Java Docker image */
  gameVersion?: string
}
