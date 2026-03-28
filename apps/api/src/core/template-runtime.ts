import type { ServerRuntimeTemplate } from '@wave/shared'

export function resolveDockerImage(
  template: ServerRuntimeTemplate,
  dockerImageKey?: string
): string {
  const map = template.dockerImages
  if (map && Object.keys(map).length > 0) {
    const key =
      dockerImageKey && map[dockerImageKey]
        ? dockerImageKey
        : template.defaultDockerImageKey && map[template.defaultDockerImageKey]
          ? template.defaultDockerImageKey
          : Object.keys(map)[0]
    const resolved = map[key]
    if (resolved) return resolved
  }
  return template.image
}

export function resolveStartupCommand(input: {
  command: string
  memoryMb: number
  ports: number[]
  env: Record<string, string>
}): string {
  const p = input.ports
  const primaryPort = p[0] ?? 25565
  const jar = input.env.SERVER_JARFILE ?? 'server.jar'
  const queryPort = p[1] ?? input.env.QUERY_PORT ?? '10011'
  const fileTransfer = p[2] ?? input.env.FILE_TRANSFER ?? '30033'
  const queryHttp = p[3] ?? input.env.QUERY_HTTP ?? '10080'
  const querySsh = p[4] ?? input.env.QUERY_SSH ?? '10022'
  return input.command
    .replaceAll('{{memory}}', String(input.memoryMb))
    .replaceAll('{{port}}', String(primaryPort))
    .replaceAll('{{SERVER_PORT}}', String(primaryPort))
    .replaceAll('{{SERVER_JARFILE}}', jar)
    .replaceAll('{{QUERY_PORT}}', String(queryPort))
    .replaceAll('{{FILE_TRANSFER}}', String(fileTransfer))
    .replaceAll('{{QUERY_HTTP}}', String(queryHttp))
    .replaceAll('{{QUERY_SSH}}', String(querySsh))
}
