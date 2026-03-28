import path from 'node:path'
import os from 'node:os'
import Docker from 'dockerode'

const runtimeDriver = process.env.RUNTIME_DRIVER ?? 'process'

/** Docker Engine connection: Windows named pipe vs Unix socket vs TCP. */
export function createDockerClient(): Docker {
  if (process.env.DOCKER_SOCKET_PATH) {
    return new Docker({ socketPath: process.env.DOCKER_SOCKET_PATH })
  }
  if (process.env.DOCKER_HOST) {
    return new Docker({
      host: process.env.DOCKER_HOST,
      port: Number(process.env.DOCKER_PORT ?? 2375)
    })
  }
  if (process.platform === 'win32') {
    return new Docker({ socketPath: '//./pipe/docker_engine' })
  }
  return new Docker({ socketPath: '/var/run/docker.sock' })
}

export function getRuntimeDriver(): string {
  return runtimeDriver
}

export function isWindowsProcessMode(): boolean {
  return process.platform === 'win32' && runtimeDriver === 'process'
}

/** Host path for Docker bind mounts (Docker Desktop on Windows wants forward slashes). */
export function toDockerHostBindPath(hostPath: string): string {
  const resolved = path.resolve(hostPath)
  if (process.platform === 'win32') {
    return resolved.replace(/\\/g, '/')
  }
  return resolved
}

/** Safer than string.startsWith for Windows drive letters / casing. */
export function isPathInsideBase(base: string, resolved: string): boolean {
  const b = path.resolve(base)
  const r = path.resolve(resolved)
  if (process.platform === 'win32') {
    return r.toLowerCase().startsWith(b.toLowerCase() + path.sep) || r.toLowerCase() === b.toLowerCase()
  }
  return r.startsWith(b + path.sep) || r === b
}

/**
 * Pterodactyl egg startups often use `/bin/sh -lc` inside Docker.
 * On Windows process mode we run cmd.exe — bash constructs break.
 */
export function startupUsesBashSyntax(startupCommand: string): boolean {
  const c = startupCommand
  if (c.includes('$(')) return true
  if (c.includes('[[')) return true
  if (c.includes('`') && c.includes('eval')) return true
  return false
}

/**
 * Templates that cannot run under Windows **process** mode (no Linux binaries / Steam in host).
 * CS2/Valheim use a stub on Windows; use Docker on Windows for real binaries.
 */
export function isWindowsProcessUnsupportedTemplate(templateId: string): boolean {
  const id = templateId.toLowerCase()
  if (id.includes('source-engine')) return true
  if (id.includes('ptero-rust') || id === 'rust') return true
  if (id.includes('mumble') || id.includes('teamspeak') || id.includes('voice-servers')) return true
  return false
}

export async function tryDockerPing(client: Docker): Promise<boolean> {
  try {
    await client.ping()
    return true
  } catch {
    return false
  }
}

export async function readRuntimeInfo(client: Docker): Promise<{
  platform: string
  runtimeDriver: string
  dockerAvailable: boolean
  windowsProcessLimitations: boolean
}> {
  const dockerAvailable = await tryDockerPing(client)
  return {
    platform: os.platform(),
    runtimeDriver,
    dockerAvailable,
    windowsProcessLimitations: isWindowsProcessMode()
  }
}
