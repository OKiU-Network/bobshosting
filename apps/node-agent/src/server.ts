import Fastify from 'fastify'
import cors from '@fastify/cors'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import { spawn, execSync } from 'node:child_process'
import { z } from 'zod'
import {
  createDockerClient,
  getRuntimeDriver,
  isWindowsProcessUnsupportedTemplate,
  isPathInsideBase,
  isWindowsProcessMode,
  readRuntimeInfo,
  startupUsesBashSyntax,
  toDockerHostBindPath
} from './platform.js'

// ── Docker client (Windows: named pipe //./pipe/docker_engine; Linux: /var/run/docker.sock)
const dockerClient = createDockerClient()
const runtimeDriver = getRuntimeDriver()

const protectedEditorFilenames = new Set(['.resource-profile.json', '.startup-command', '.status'])

// ── Path helpers ───────────────────────────────────────────────────────────────
function getServerDataRoot(): string {
  return process.env.SERVER_DATA_ROOT ?? path.join(process.cwd(), 'server-data')
}

function getServerDataPath(serverId: string): string {
  return path.join(getServerDataRoot(), serverId)
}

function ensureServerDataPath(serverId: string): string {
  const p = getServerDataPath(serverId)
  fs.mkdirSync(p, { recursive: true })
  return p
}

function resolveSafePath(input: { serverId: string; relativePath?: string }): string {
  const base = ensureServerDataPath(input.serverId)
  const rel = input.relativePath ?? '.'
  const resolved = path.resolve(base, rel)
  if (!isPathInsideBase(base, resolved)) throw new Error('Invalid file path')
  return resolved
}

function getLogPath(serverId: string): string {
  return path.join(getServerDataPath(serverId), 'runtime.log')
}

function getStatusFilePath(serverId: string): string {
  return path.join(getServerDataPath(serverId), '.status')
}

function ensureLogPath(serverId: string): string {
  const p = getLogPath(serverId)
  if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf-8')
  return p
}

function appendLog(serverId: string, message: string): void {
  const logPath = ensureLogPath(serverId)
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8)
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`, 'utf-8')
}

function setStatus(serverId: string, status: 'installing' | 'running' | 'stopped' | 'error'): void {
  ensureServerDataPath(serverId)
  fs.writeFileSync(getStatusFilePath(serverId), status, 'utf-8')
}

function getStatus(serverId: string): string {
  const p = getStatusFilePath(serverId)
  if (!fs.existsSync(p)) return 'unknown'
  return fs.readFileSync(p, 'utf-8').trim()
}

function getContainerName(serverId: string): string {
  return `wave-${serverId}`
}

// ── Process state ──────────────────────────────────────────────────────────────
import type { ChildProcess } from 'node:child_process'

interface ProcessEntry {
  process: ChildProcess
  status: 'running' | 'stopped'
}

const processState = new Map<string, ProcessEntry>()

// ── Command runners ────────────────────────────────────────────────────────────
function runCommandStreaming(input: {
  command: string
  cwd: string
  serverId: string
  env?: Record<string, string>
}): Promise<void> {
  return new Promise((resolve, reject) => {
    appendLog(input.serverId, `> ${input.command}`)
    const proc = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      env: { ...process.env, ...(input.env ?? {}) }
    })
    proc.stdout.on('data', chunk => {
      for (const line of chunk.toString('utf-8').split('\n')) {
        const trimmed = line.trim()
        if (trimmed) appendLog(input.serverId, trimmed)
      }
    })
    proc.stderr.on('data', chunk => {
      for (const line of chunk.toString('utf-8').split('\n')) {
        const trimmed = line.trim()
        if (trimmed) appendLog(input.serverId, `[stderr] ${trimmed}`)
      }
    })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`Command failed with exit code ${code}: ${input.command}`))
      else resolve()
    })
  })
}

function downloadFile(input: { url: string; dest: string; serverId: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    appendLog(input.serverId, `[Download] ${input.url}`)
    const file = fs.createWriteStream(input.dest)
    const client = input.url.startsWith('https') ? https : http
    const get = (url: string) => {
      client.get(url, resp => {
        if (resp.statusCode === 301 || resp.statusCode === 302) {
          file.close()
          get(resp.headers.location!)
          return
        }
        resp.pipe(file)
        file.on('finish', () => {
          file.close()
          appendLog(input.serverId, `[Download] Complete: ${path.basename(input.dest)}`)
          resolve()
        })
      }).on('error', reject)
    }
    get(input.url)
  })
}

function fetchHttpsJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'wave-hosting/1.0' } }, res => {
        let data = ''
        res.on('data', c => (data += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} ${url}`))
            return
          }
          try {
            resolve(JSON.parse(data) as T)
          } catch (e) {
            reject(e)
          }
        })
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

async function resolveTeamspeakServerVersion(serverId: string, want: string): Promise<string> {
  const w = want.trim().toLowerCase()
  if (w && w !== 'latest') return want.trim()
  try {
    const j = await fetchHttpsJson<{ linux?: { x86_64?: { version: string } } }>(
      'https://teamspeak.com/versions/server.json'
    )
    const v = j.linux?.x86_64?.version
    if (v) {
      appendLog(serverId, `[Install] TeamSpeak latest from teamspeak.com: ${v}`)
      return v
    }
  } catch (err) {
    appendLog(serverId, `[Install] TeamSpeak version lookup failed: ${(err as Error).message}`)
  }
  appendLog(serverId, '[Install] Falling back to TeamSpeak server 3.13.7')
  return '3.13.7'
}

async function resolvePaperMinecraftVersion(serverId: string, wantRaw: string): Promise<string> {
  const want = wantRaw.trim().toLowerCase()
  const proj = await fetchHttpsJson<{ versions: string[] }>('https://api.papermc.io/v2/projects/paper')
  const versions = proj.versions ?? []
  if (!versions.length) throw new Error('Paper API returned no versions')
  if (want === 'snapshot' || want === 'latest' || want === '') {
    if (want === 'snapshot') {
      const v = versions[versions.length - 1]
      appendLog(serverId, `[Install] Paper: newest version entry (snapshot track): ${v}`)
      return v
    }
    for (let i = versions.length - 1; i >= 0; i--) {
      const v = versions[i]
      if (/-pre|-rc\d*$/i.test(v)) continue
      appendLog(serverId, `[Install] Paper: latest stable Minecraft version: ${v}`)
      return v
    }
    const v = versions[versions.length - 1]
    appendLog(serverId, `[Install] Paper: fallback Minecraft version: ${v}`)
    return v
  }
  const exact = wantRaw.trim()
  if (!versions.includes(exact))
    throw new Error(`Paper has no builds for Minecraft version "${exact}" (check api.papermc.io versions list)`)
  return exact
}

async function resolvePaperDownloadUrl(
  serverId: string,
  gameVersion: string,
  buildWantRaw: string
): Promise<{ url: string }> {
  const apiUrl = `https://api.papermc.io/v2/projects/paper/versions/${encodeURIComponent(gameVersion)}/builds`
  const buildInfo = await fetchHttpsJson<{
    builds: { build: number; downloads?: { application?: { name?: string } } }[]
  }>(apiUrl)
  const builds = buildInfo.builds ?? []
  if (!builds.length) throw new Error(`No Paper builds for Minecraft ${gameVersion}`)
  const buildWant = buildWantRaw.trim().toLowerCase()
  let chosen
  if (buildWant === 'latest' || buildWant === '') {
    chosen = builds[builds.length - 1]
  } else {
    const n = Number(buildWant)
    if (!Number.isFinite(n)) throw new Error(`Invalid Paper BUILD_NUMBER: ${buildWantRaw}`)
    chosen = builds.find(b => b.build === n)
    if (!chosen) throw new Error(`Paper build ${n} not found for Minecraft ${gameVersion}`)
  }
  const jarName =
    chosen.downloads?.application?.name ?? `paper-${gameVersion}-${chosen.build}.jar`
  const downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${encodeURIComponent(gameVersion)}/builds/${chosen.build}/downloads/${encodeURIComponent(jarName)}`
  appendLog(serverId, `[Install] Paper MC ${gameVersion} build ${chosen.build} — ${jarName}`)
  return { url: downloadUrl }
}

// ── Template install handlers ──────────────────────────────────────────────────
type InstallContext = {
  serverId: string
  dataPath: string
  memoryMb: number
  ports: number[]
  env: Record<string, string>
}

const installHandlers: Record<string, (ctx: InstallContext) => Promise<void>> = {
  'minecraft-vanilla': async ctx => {
    appendLog(ctx.serverId, '[Install] Preparing Vanilla Minecraft server...')
    const serverJar = path.join(ctx.dataPath, ctx.env.SERVER_JARFILE ?? 'server.jar')
    if (!fs.existsSync(serverJar)) {
      appendLog(ctx.serverId, '[Install] Resolving Mojang version manifest...')
      const manifest = await new Promise<any>((resolve, reject) => {
        https.get(
          'https://launchermeta.mojang.com/mc/game/version_manifest.json',
          { headers: { 'User-Agent': 'wave-hosting/1.0' } },
          res => {
            let data = ''
            res.on('data', c => (data += c))
            res.on('end', () => resolve(JSON.parse(data)))
            res.on('error', reject)
          }
        ).on('error', reject)
      })
      const want = (ctx.env.VANILLA_VERSION ?? 'latest').trim()
      const versionId =
        want === 'latest' ? manifest.latest.release
        : want === 'snapshot' ? manifest.latest.snapshot
        : want
      const verEntry = (manifest.versions as { id: string; url: string }[]).find((v: { id: string }) => v.id === versionId)
      if (!verEntry) throw new Error(`Unknown Minecraft version: ${versionId}`)
      const verJson = await new Promise<any>((resolve, reject) => {
        https.get(verEntry.url, { headers: { 'User-Agent': 'wave-hosting/1.0' } }, res => {
          let data = ''
          res.on('data', c => (data += c))
          res.on('end', () => resolve(JSON.parse(data)))
          res.on('error', reject)
        }).on('error', reject)
      })
      const dlUrl = verJson.downloads?.server?.url
      if (!dlUrl) throw new Error('No server jar URL in Mojang metadata')
      await downloadFile({ url: dlUrl, dest: serverJar, serverId: ctx.serverId })
    }
    fs.writeFileSync(path.join(ctx.dataPath, 'eula.txt'), 'eula=true\n', 'utf-8')
    if (!fs.existsSync(path.join(ctx.dataPath, 'server.properties'))) {
      fs.writeFileSync(
        path.join(ctx.dataPath, 'server.properties'),
        `server-port=${ctx.ports[0] ?? 25565}\nmax-players=20\nonline-mode=true\n`,
        'utf-8'
      )
    }
    appendLog(ctx.serverId, '[Install] Vanilla Minecraft ready.')
  },

  'minecraft-paper': async ctx => {
    appendLog(ctx.serverId, '[Install] Preparing Minecraft Paper server...')

    const serverJar = path.join(ctx.dataPath, 'server.jar')
    const mcVersion = await resolvePaperMinecraftVersion(ctx.serverId, ctx.env.MINECRAFT_VERSION ?? 'latest')
    const buildNumber = ctx.env.BUILD_NUMBER ?? 'latest'
    if (!fs.existsSync(serverJar)) {
      const { url } = await resolvePaperDownloadUrl(ctx.serverId, mcVersion, buildNumber)
      await downloadFile({ url, dest: serverJar, serverId: ctx.serverId })
    } else {
      appendLog(ctx.serverId, '[Install] server.jar already exists — delete it to download another MC/Paper build')
    }

    fs.writeFileSync(path.join(ctx.dataPath, 'eula.txt'), 'eula=true\n', 'utf-8')
    appendLog(ctx.serverId, '[Install] Wrote eula.txt')

    if (!fs.existsSync(path.join(ctx.dataPath, 'server.properties'))) {
      fs.writeFileSync(path.join(ctx.dataPath, 'server.properties'),
        `server-port=${ctx.ports[0] ?? 25565}\nmax-players=20\nonline-mode=false\n`, 'utf-8')
      appendLog(ctx.serverId, '[Install] Wrote server.properties')
    }

    appendLog(ctx.serverId, '[Install] Minecraft Paper ready. Starting server...')
  },

  'minecraft-forge': async ctx => {
    appendLog(ctx.serverId, '[Install] Forge: ensure Forge installer has been run or place files in server directory.')
    fs.writeFileSync(path.join(ctx.dataPath, 'eula.txt'), 'eula=true\n', 'utf-8')
    appendLog(ctx.serverId, '[Install] Wrote eula.txt — full Forge setup may require Pterodactyl-style install container.')
  },

  'minecraft-bungeecord': async ctx => {
    appendLog(ctx.serverId, '[Install] BungeeCord: place bungeecord.jar or run installer — wrote eula placeholder.')
    const jar = path.join(ctx.dataPath, ctx.env.SERVER_JARFILE ?? 'bungeecord.jar')
    if (!fs.existsSync(jar)) {
      appendLog(ctx.serverId, '[Install] Missing ' + path.basename(jar) + ' — download from Spigot/Bungee releases.')
    }
  },

  'minecraft-sponge': async ctx => {
    appendLog(ctx.serverId, '[Install] Sponge: place sponge jar and dependencies per Sponge docs.')
    fs.writeFileSync(path.join(ctx.dataPath, 'eula.txt'), 'eula=true\n', 'utf-8')
  },

  'cs2': async ctx => {
    if (runtimeDriver === 'process') {
      appendLog(ctx.serverId, '[Install] CS2 requires Docker mode (SteamCMD + Linux).')
      appendLog(ctx.serverId, '[Install] Set RUNTIME_DRIVER=docker and run on Linux.')
      appendLog(ctx.serverId, '[Install] Placeholder created for process mode.')
      fs.writeFileSync(path.join(ctx.dataPath, 'README.txt'),
        'CS2 requires Docker deployment.\nSet RUNTIME_DRIVER=docker on Linux and use the cm2network/cs2 image.\n')
      return
    }
    appendLog(ctx.serverId, '[Install] CS2 Docker image will be pulled automatically.')
  },

  'valheim': async ctx => {
    if (runtimeDriver === 'process') {
      appendLog(ctx.serverId, '[Install] Valheim requires Docker + SteamCMD on Linux.')
      fs.writeFileSync(path.join(ctx.dataPath, 'README.txt'), 'Use RUNTIME_DRIVER=docker on Linux.\n')
      return
    }
    appendLog(ctx.serverId, '[Install] Valheim Docker image will be pulled.')
  },

  'python-fastapi': async ctx => {
    appendLog(ctx.serverId, '[Install] Setting up Python FastAPI application...')

    const appPy = path.join(ctx.dataPath, 'app.py')
    if (!fs.existsSync(appPy)) {
      fs.writeFileSync(appPy, `from fastapi import FastAPI
import os

app = FastAPI(title="Wave Hosting App")

@app.get("/")
def root():
    return {"status": "running", "server": os.getenv("SERVER_ID", "unknown")}

@app.get("/health")
def health():
    return {"healthy": True}
`)
      appendLog(ctx.serverId, '[Install] Created app.py')
    }

    const reqsTxt = path.join(ctx.dataPath, 'requirements.txt')
    if (!fs.existsSync(reqsTxt)) {
      fs.writeFileSync(reqsTxt, 'fastapi\nuvicorn[standard]\n')
      appendLog(ctx.serverId, '[Install] Created requirements.txt')
    }

    appendLog(ctx.serverId, '[Install] Installing Python packages...')
    try {
      await runCommandStreaming({
        command: 'python -m pip install -r requirements.txt',
        cwd: ctx.dataPath,
        serverId: ctx.serverId
      })
      appendLog(ctx.serverId, '[Install] Python packages installed.')
    } catch {
      appendLog(ctx.serverId, '[Install] pip install failed — ensure Python 3 is installed.')
    }

    appendLog(ctx.serverId, '[Install] Python FastAPI ready. Starting server...')
  },

  'python-worker': async ctx => {
    appendLog(ctx.serverId, '[Install] Setting up Python Worker...')

    const workerPy = path.join(ctx.dataPath, 'worker.py')
    if (!fs.existsSync(workerPy)) {
      fs.writeFileSync(workerPy, `import time, logging, os
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

def main():
    log.info(f"Wave Worker started — server {os.getenv('SERVER_ID','?')}")
    count = 0
    while True:
        count += 1
        log.info(f"Heartbeat #{count}")
        time.sleep(10)

if __name__ == "__main__":
    main()
`)
      appendLog(ctx.serverId, '[Install] Created worker.py')
    }

    appendLog(ctx.serverId, '[Install] Python Worker ready. Starting...')
  },

  teamspeak3: async ctx => {
    appendLog(ctx.serverId, '[Install] TeamSpeak 3 server (Linux amd64 tarball, same as Pterodactyl egg)...')
    const ts3serverBin = path.join(ctx.dataPath, 'ts3server')
    if (fs.existsSync(ts3serverBin)) {
      appendLog(ctx.serverId, '[Install] ts3server already present')
    } else {
      const ver = await resolveTeamspeakServerVersion(ctx.serverId, ctx.env.TS_VERSION ?? 'latest')
      const archive = `teamspeak3-server_linux_amd64-${ver}.tar.bz2`
      const archivePath = path.join(ctx.dataPath, archive)
      const dl = `https://files.teamspeak-services.com/releases/server/${ver}/${archive}`
      await downloadFile({ url: dl, dest: archivePath, serverId: ctx.serverId })
      await runCommandStreaming({
        command: `tar -xjf "${archive}"`,
        cwd: ctx.dataPath,
        serverId: ctx.serverId
      })
      const nestedDir = fs
        .readdirSync(ctx.dataPath)
        .find(
          name =>
            name.startsWith('teamspeak3-server_linux') &&
            fs.statSync(path.join(ctx.dataPath, name)).isDirectory()
        )
      if (nestedDir) {
        const nd = path.join(ctx.dataPath, nestedDir)
        for (const name of fs.readdirSync(nd)) {
          fs.renameSync(path.join(nd, name), path.join(ctx.dataPath, name))
        }
        fs.rmSync(nd, { recursive: true })
      }
      try {
        fs.unlinkSync(archivePath)
      } catch {
        /* archive may already be removed */
      }
      const redistLib = path.join(ctx.dataPath, 'redist', 'libmariadb.so.2')
      if (fs.existsSync(redistLib)) {
        fs.copyFileSync(redistLib, path.join(ctx.dataPath, 'libmariadb.so.2'))
        appendLog(ctx.serverId, '[Install] Copied libmariadb.so.2 into server root')
      }
      if (process.platform !== 'win32' && fs.existsSync(ts3serverBin)) {
        try {
          fs.chmodSync(ts3serverBin, 0o755)
        } catch {
          /* best effort */
        }
      }
    }
    appendLog(ctx.serverId, '[Install] TeamSpeak 3 ready.')
  }
}

// ── Background provision pipeline ─────────────────────────────────────────────
async function runTemplateInstall(input: {
  serverId: string
  templateId: string
  installPipelineId?: string
  ports: number[]
  env: Record<string, string>
  memoryMb: number
}): Promise<void> {
  const dataPath = ensureServerDataPath(input.serverId)
  setStatus(input.serverId, 'installing')
  appendLog(input.serverId, `[Provision] Server ${input.serverId} initialising...`)
  appendLog(input.serverId, `[Provision] Template: ${input.templateId}`)
  const pipelineKey = input.installPipelineId ?? input.templateId
  appendLog(input.serverId, `[Provision] Install pipeline: ${pipelineKey}`)
  appendLog(input.serverId, `[Provision] Runtime driver: ${runtimeDriver}`)

  const ctx: InstallContext = {
    serverId: input.serverId,
    dataPath,
    memoryMb: input.memoryMb,
    ports: input.ports,
    env: input.env
  }

  const handler = installHandlers[pipelineKey]
  if (handler) {
    try {
      await handler(ctx)
    } catch (err) {
      appendLog(input.serverId, `[Error] Install failed: ${(err as Error).message}`)
      setStatus(input.serverId, 'error')
      throw err
    }
  } else {
    appendLog(input.serverId, `[Provision] No special install for ${pipelineKey}, skipping.`)
  }
}

async function runProvisionPipeline(input: {
  serverId: string
  templateId: string
  installPipelineId?: string
  startupCommand: string
  ports: number[]
  env: Record<string, string>
  memoryMb: number
}): Promise<void> {
  if (isWindowsProcessMode() && isWindowsProcessUnsupportedTemplate(input.templateId)) {
    appendLog(
      input.serverId,
      '[Error] This template needs Linux binaries or SteamCMD. On Windows use RUNTIME_DRIVER=docker with Docker Desktop, or run the node agent on Linux/Unraid (recommended for Source/Rust/voice servers).'
    )
    setStatus(input.serverId, 'error')
    return
  }

  await runTemplateInstall({
    serverId: input.serverId,
    templateId: input.templateId,
    installPipelineId: input.installPipelineId,
    ports: input.ports,
    env: input.env,
    memoryMb: input.memoryMb
  })

  if (isWindowsProcessMode() && startupUsesBashSyntax(input.startupCommand)) {
    appendLog(
      input.serverId,
      '[Error] Startup command uses bash/Linux shell syntax (e.g. $(...)). Windows cmd cannot run it. Use RUNTIME_DRIVER=docker so the container runs /bin/sh, choose Paper/Vanilla with a plain java -jar line, or deploy on Linux/Unraid.'
    )
    setStatus(input.serverId, 'error')
    return
  }

  const pipelineKey = input.installPipelineId ?? input.templateId
  const stubTemplates = new Set(['cs2', 'valheim'])
  if (runtimeDriver === 'process' && stubTemplates.has(pipelineKey)) {
    appendLog(input.serverId, '[Provision] Stub install complete. Use Docker on Linux to run this template.')
    setStatus(input.serverId, 'stopped')
    return
  }

  spawnProcessRuntime({ serverId: input.serverId, startupCommand: input.startupCommand, env: input.env })
}

// ── Process runtime ────────────────────────────────────────────────────────────
function spawnProcessRuntime(input: { serverId: string; startupCommand: string; env: Record<string, string> }) {
  const dataPath = ensureServerDataPath(input.serverId)
  ensureLogPath(input.serverId)
  appendLog(input.serverId, `[Runtime] Starting: ${input.startupCommand}`)

  const logPath = getLogPath(input.serverId)
  const outFd = fs.openSync(logPath, 'a')

  // stdin: 'pipe' so we can write server commands (e.g. /stop, save-all) to the running process
  const proc = spawn(input.startupCommand, {
    cwd: dataPath,
    env: { ...process.env, SERVER_ID: input.serverId, ...input.env },
    shell: true,
    stdio: ['pipe', outFd, outFd]
  })

  proc.on('error', err => {
    appendLog(input.serverId, `[Error] Failed to start process: ${err.message}`)
    setStatus(input.serverId, 'error')
    processState.delete(input.serverId)
  })

  proc.on('close', code => {
    appendLog(input.serverId, `[Runtime] Process exited with code ${code ?? 0}`)
    setStatus(input.serverId, 'stopped')
    processState.delete(input.serverId)
  })

  processState.set(input.serverId, { process: proc, status: 'running' })
  setStatus(input.serverId, 'running')
  appendLog(input.serverId, `[Runtime] Process started — PID ${proc.pid ?? '?'} — stdin connected`)
}

/**
 * Write a line to the running server process's stdin (e.g. /stop, save-all, list).
 * This is the real console — it talks directly to the server process.
 */
function sendToProcessStdin(serverId: string, command: string): void {
  const entry = processState.get(serverId)
  if (!entry || entry.status !== 'running') {
    appendLog(serverId, `[Console] Server not running — cannot send: ${command}`)
    return
  }
  const stdin = entry.process.stdin
  if (!stdin || stdin.destroyed) {
    appendLog(serverId, `[Console] stdin not available for this process`)
    return
  }
  stdin.write(command + '\n', 'utf-8')
  appendLog(serverId, `> ${command}`)
}

function stopProcessRuntime(serverId: string, stopCommand?: string): void {
  const entry = processState.get(serverId)
  if (!entry) {
    appendLog(serverId, '[Power] No running process found to stop')
    setStatus(serverId, 'stopped')
    return
  }

  // Try graceful shutdown via stdin stop command first
  if (stopCommand && entry.status === 'running') {
    appendLog(serverId, `[Power] Sending graceful stop command: ${stopCommand}`)
    sendToProcessStdin(serverId, stopCommand)
    // Give server 10 seconds to stop gracefully, then force kill
    setTimeout(() => {
      const current = processState.get(serverId)
      if (current && current.status === 'running') {
        appendLog(serverId, '[Power] Graceful stop timed out, force killing...')
        try { current.process.kill('SIGKILL') } catch {}
      }
    }, 10000)
  } else {
    // No stop command configured or not running: SIGTERM immediately
    try { entry.process.kill('SIGTERM') } catch {}
    appendLog(serverId, '[Power] SIGTERM sent')
  }

  processState.set(serverId, { ...entry, status: 'stopped' })
  setStatus(serverId, 'stopped')
}

function restartProcessRuntime(serverId: string, stopCommand?: string): void {
  appendLog(serverId, '[Power] Restarting server...')
  stopProcessRuntime(serverId, stopCommand)
  const cmdFile = path.join(getServerDataPath(serverId), '.startup-command')
  if (!fs.existsSync(cmdFile)) {
    appendLog(serverId, '[Error] .startup-command missing — cannot restart')
    return
  }
  const cmd = fs.readFileSync(cmdFile, 'utf-8').trim()
  setTimeout(() => spawnProcessRuntime({ serverId, startupCommand: cmd, env: {} }), 2000)
}

function deleteProcessRuntime(serverId: string): void {
  const entry = processState.get(serverId)
  if (entry) {
    try { entry.process.kill('SIGTERM') } catch {}
    processState.delete(serverId)
  }
}

// ── Docker helpers ─────────────────────────────────────────────────────────────
async function getContainerByName(serverId: string) {
  const name = getContainerName(serverId)
  const list = await dockerClient.listContainers({ all: true, filters: { name: [name] } })
  if (!list.length) return null
  return dockerClient.getContainer(list[0].Id)
}

async function pullImage(image: string, serverId: string): Promise<void> {
  appendLog(serverId, `[Docker] Pulling image ${image}...`)
  const stream = await dockerClient.pull(image)
  await new Promise<void>((resolve, reject) => {
    dockerClient.modem.followProgress(stream, (err, output) => {
      if (err) return reject(err)
      const last = (output as any[]).at(-1)
      appendLog(serverId, `[Docker] Image ready: ${last?.status ?? 'done'}`)
      resolve()
    }, (event: any) => {
      if (event?.status) appendLog(serverId, `[Docker] ${event.status}${event.progress ? ` ${event.progress}` : ''}`)
    })
  })
}

function parseDockerLogs(buffer: Buffer): string[] {
  return buffer.toString('utf-8').split('\n').map(l => l.trim()).filter(Boolean)
}

// ── Main server ────────────────────────────────────────────────────────────────
async function main() {
  const app = Fastify({ logger: true })
  await app.register(cors, { origin: true })

  app.get('/health', async () => {
    const rt = await readRuntimeInfo(dockerClient)
    if (runtimeDriver === 'docker' && !rt.dockerAvailable) {
      return {
        isSuccess: false,
        message: 'Docker engine unreachable — check Docker Desktop (Windows) or socket path on Linux/Unraid',
        data: rt
      }
    }
    return { isSuccess: true, message: 'Node agent healthy', data: rt }
  })

  app.get('/runtime', async () => ({
    isSuccess: true,
    message: 'Runtime info',
    data: await readRuntimeInfo(dockerClient)
  }))

  /** Rough host stats for the panel (create-server limits). Not a security boundary. */
  app.get('/host/capacity', async () => {
    const totalMemoryMb = Math.floor(os.totalmem() / (1024 * 1024))
    const cpuCount = os.cpus().length
    return {
      isSuccess: true,
      message: 'Host capacity',
      data: {
        totalMemoryMb,
        cpuCount,
        platform: os.platform(),
        hostname: os.hostname()
      }
    }
  })

  // ── Provision ────────────────────────────────────────────────────────────────
  app.post('/containers/provision', async request => {
    const payload = z.object({
      serverId: z.string(),
      templateId: z.string(),
      installPipelineId: z.string().optional(),
      image: z.string(),
      startupCommand: z.string(),
      ports: z.array(z.number().int()),
      env: z.record(z.string()).optional(),
      cpuLimit: z.number().int().min(10),
      memoryMb: z.number().int().min(128),
      diskMb: z.number().int().min(1024)
    }).parse(request.body)

    const dataPath = ensureServerDataPath(payload.serverId)
    fs.writeFileSync(path.join(dataPath, '.startup-command'), payload.startupCommand, 'utf-8')
    fs.writeFileSync(path.join(dataPath, '.resource-profile.json'),
      JSON.stringify({ cpuLimit: payload.cpuLimit, memoryMb: payload.memoryMb, diskMb: payload.diskMb }), 'utf-8')

    setStatus(payload.serverId, 'installing')
    appendLog(payload.serverId, `[Provision] Received provision request for ${payload.templateId}`)

    if (runtimeDriver === 'process') {
      // Run install + start in background, return immediately
      setImmediate(() => {
        runProvisionPipeline({
          serverId: payload.serverId,
          templateId: payload.templateId,
          installPipelineId: payload.installPipelineId,
          startupCommand: payload.startupCommand,
          ports: payload.ports,
          env: payload.env ?? {},
          memoryMb: payload.memoryMb
        }).catch(err => {
          appendLog(payload.serverId, `[Error] Provision pipeline failed: ${err.message}`)
          setStatus(payload.serverId, 'error')
        })
      })

      return { isSuccess: true, message: 'Provisioning started', data: { status: 'installing', serverId: payload.serverId } }
    }

    // Docker mode: install files on host volume, then pull + create + start
    setImmediate(async () => {
      try {
        await runTemplateInstall({
          serverId: payload.serverId,
          templateId: payload.templateId,
          installPipelineId: payload.installPipelineId,
          ports: payload.ports,
          env: payload.env ?? {},
          memoryMb: payload.memoryMb
        })
        const existing = await getContainerByName(payload.serverId)
        if (!existing) {
          await pullImage(payload.image, payload.serverId)
          const exposedPorts = Object.fromEntries(payload.ports.map(p => [`${p}/tcp`, {}]))
          const portBindings = Object.fromEntries(payload.ports.map(p => [`${p}/tcp`, [{ HostPort: String(p) }]]))
          const container = await dockerClient.createContainer({
            name: getContainerName(payload.serverId),
            Image: payload.image,
            Cmd: ['/bin/sh', '-lc', payload.startupCommand],
            Env: Object.entries(payload.env ?? {}).map(([k, v]) => `${k}=${v}`),
            ExposedPorts: exposedPorts,
            HostConfig: {
              PortBindings: portBindings,
              Binds: [`${toDockerHostBindPath(dataPath)}:/data`],
              RestartPolicy: { Name: 'unless-stopped' },
              NanoCpus: payload.cpuLimit * 1_000_000_000,
              Memory: payload.memoryMb * 1024 * 1024
            },
            WorkingDir: '/data'
          })
          await container.start()
        }
        setStatus(payload.serverId, 'running')
        appendLog(payload.serverId, '[Docker] Container running')
      } catch (err) {
        appendLog(payload.serverId, `[Error] Docker provision failed: ${(err as Error).message}`)
        setStatus(payload.serverId, 'error')
      }
    })

    return { isSuccess: true, message: 'Provisioning started', data: { status: 'installing', serverId: payload.serverId } }
  })

  // ── Status ───────────────────────────────────────────────────────────────────
  app.get('/containers/:serverId/status', async request => {
    const { serverId } = request.params as { serverId: string }
    const status = getStatus(serverId)
    return { isSuccess: true, message: 'Status fetched', data: { status } }
  })

  // ── Power ────────────────────────────────────────────────────────────────────
  app.post('/containers/:serverId/power', async request => {
    const { serverId } = request.params as { serverId: string }
    const { action, stopCommand } = z.object({
      action: z.enum(['start', 'stop', 'restart']),
      stopCommand: z.string().optional()
    }).parse(request.body)

    if (runtimeDriver === 'process') {
      if (action === 'stop') stopProcessRuntime(serverId, stopCommand)
      if (action === 'start') {
        const cmdFile = path.join(getServerDataPath(serverId), '.startup-command')
        if (!fs.existsSync(cmdFile)) return { isSuccess: false, message: 'Server not installed yet' }
        const cmd = fs.readFileSync(cmdFile, 'utf-8').trim()
        spawnProcessRuntime({ serverId, startupCommand: cmd, env: {} })
      }
      if (action === 'restart') restartProcessRuntime(serverId, stopCommand)
      return { isSuccess: true, message: `Power ${action} completed`, data: { status: getStatus(serverId) } }
    }

    const container = await getContainerByName(serverId)
    if (!container) return { isSuccess: false, message: 'Container not found' }
    if (action === 'start') await container.start().catch(() => {})
    if (action === 'stop') await container.stop({ t: 10 }).catch(() => {})
    if (action === 'restart') await container.restart({ t: 10 }).catch(() => {})
    const details = await container.inspect()
    return { isSuccess: true, message: 'Power action completed', data: { status: details.State?.Status ?? 'unknown' } }
  })

  // ── Delete ───────────────────────────────────────────────────────────────────
  app.delete('/containers/:serverId', async request => {
    const { serverId } = request.params as { serverId: string }
    if (runtimeDriver === 'process') {
      deleteProcessRuntime(serverId)
      return { isSuccess: true, message: 'Deleted' }
    }
    const container = await getContainerByName(serverId)
    if (!container) return { isSuccess: false, message: 'Container not found' }
    await container.remove({ force: true })
    return { isSuccess: true, message: 'Container deleted' }
  })

  // ── Files ────────────────────────────────────────────────────────────────────
  app.get('/containers/:serverId/startup-command', async request => {
    const { serverId } = request.params as { serverId: string }
    const targetPath = path.join(ensureServerDataPath(serverId), '.startup-command')
    if (!fs.existsSync(targetPath)) return { isSuccess: true, message: 'Startup command', data: { content: '' } }
    return {
      isSuccess: true,
      message: 'Startup command',
      data: { content: fs.readFileSync(targetPath, 'utf-8') }
    }
  })

  app.put('/containers/:serverId/startup-command', async request => {
    const { serverId } = request.params as { serverId: string }
    const { content } = z.object({ content: z.string() }).parse(request.body)
    const targetPath = path.join(ensureServerDataPath(serverId), '.startup-command')
    fs.writeFileSync(targetPath, content, 'utf-8')
    return { isSuccess: true, message: 'Startup command saved' }
  })

  app.get('/containers/:serverId/files', async request => {
    const { serverId } = request.params as { serverId: string }
    const { path: relPath } = request.query as { path?: string }
    const dirPath = resolveSafePath({ serverId, relativePath: relPath })
    const entries = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !protectedEditorFilenames.has(e.name))
      .map(e => ({
        name: e.name,
        kind: e.isDirectory() ? 'directory' : 'file',
        size: e.isDirectory() ? 0 : fs.statSync(path.join(dirPath, e.name)).size
      }))
    return { isSuccess: true, message: 'Files fetched', data: { entries } }
  })

  app.get('/containers/:serverId/files/content', async request => {
    const { serverId } = request.params as { serverId: string }
    const { path: relPath } = request.query as { path?: string }
    const targetPath = resolveSafePath({ serverId, relativePath: relPath })
    if (!fs.existsSync(targetPath)) return { isSuccess: false, message: 'File not found' }
    if (fs.statSync(targetPath).isDirectory()) return { isSuccess: false, message: 'Path is directory' }
    return { isSuccess: true, message: 'File loaded', data: { content: fs.readFileSync(targetPath, 'utf-8') } }
  })

  app.put('/containers/:serverId/files/content', async request => {
    const { serverId } = request.params as { serverId: string }
    const { path: relPath, content } = z.object({ path: z.string().min(1), content: z.string() }).parse(request.body)
    const targetPath = resolveSafePath({ serverId, relativePath: relPath })
    const base = path.basename(targetPath)
    if (protectedEditorFilenames.has(base)) {
      return { isSuccess: false, message: `Refusing to edit protected file: ${base}` }
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, content, 'utf-8')
    return { isSuccess: true, message: 'File saved' }
  })

  app.post('/containers/:serverId/files/folder', async request => {
    const { serverId } = request.params as { serverId: string }
    const { path: relPath } = z.object({ path: z.string().min(1) }).parse(request.body)
    const targetPath = resolveSafePath({ serverId, relativePath: relPath })
    fs.mkdirSync(targetPath, { recursive: true })
    return { isSuccess: true, message: 'Folder created' }
  })

  app.delete('/containers/:serverId/files', async request => {
    const { serverId } = request.params as { serverId: string }
    const { path: relPath } = request.query as { path?: string }
    if (!relPath || relPath === '.') return { isSuccess: false, message: 'Refusing to delete root' }
    const targetPath = resolveSafePath({ serverId, relativePath: relPath })
    const base = path.basename(targetPath)
    if (protectedEditorFilenames.has(base)) {
      return { isSuccess: false, message: `Refusing to delete protected file: ${base}` }
    }
    if (!fs.existsSync(targetPath)) return { isSuccess: false, message: 'Path not found' }
    const s = fs.statSync(targetPath)
    if (s.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true })
    else fs.unlinkSync(targetPath)
    return { isSuccess: true, message: 'Deleted' }
  })

  // ── Logs ─────────────────────────────────────────────────────────────────────
  app.get('/containers/:serverId/logs', async request => {
    const { serverId } = request.params as { serverId: string }

    if (runtimeDriver === 'process') {
      const logPath = ensureLogPath(serverId)
      const raw = fs.readFileSync(logPath, 'utf-8')
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean).slice(-500)
      return { isSuccess: true, message: 'Logs fetched', data: { lines } }
    }

    const container = await getContainerByName(serverId)
    if (!container) return { isSuccess: false, message: 'Container not found' }
    const logs = await container.logs({ stdout: true, stderr: true, tail: 500 })
    return { isSuccess: true, message: 'Logs fetched', data: { lines: parseDockerLogs(logs as Buffer) } }
  })

  // ── Console command ───────────────────────────────────────────────────────────
  // This writes directly to the running server process's stdin — same as typing in the terminal.
  app.post('/containers/:serverId/console/command', async request => {
    const { serverId } = request.params as { serverId: string }
    const { command } = z.object({ command: z.string().min(1) }).parse(request.body)

    if (runtimeDriver === 'process') {
      const entry = processState.get(serverId)
      if (!entry || entry.status !== 'running' || !entry.process.stdin || entry.process.stdin.destroyed) {
        // Server not running: fall back to running the command as a standalone shell command
        // (useful for things like 'ls', 'cat server.properties', etc.)
        const dataPath = ensureServerDataPath(serverId)
        const lines: string[] = []
        await new Promise<void>((resolve) => {
          const proc = spawn(command, { cwd: dataPath, shell: true, env: process.env })
          proc.stdout.on('data', c => lines.push(...c.toString('utf-8').split('\n').map((l: string) => l.trim()).filter(Boolean)))
          proc.stderr.on('data', c => lines.push(...c.toString('utf-8').split('\n').map((l: string) => `[err] ${l.trim()}`).filter((l: string) => l !== '[err] ')))
          proc.on('close', () => resolve())
          proc.on('error', err => { lines.push(`[Error] ${err.message}`); resolve() })
        })
        appendLog(serverId, `$ ${command}\n${lines.join('\n')}`)
        return { isSuccess: true, message: 'Shell command executed (server offline)', data: { lines } }
      }

      // Server IS running: write the command directly to its stdin
      sendToProcessStdin(serverId, command)
      return {
        isSuccess: true,
        message: 'Command sent to server stdin',
        data: { lines: [`> ${command}`, '(output appears in console logs above)'] }
      }
    }

    const container = await getContainerByName(serverId)
    if (!container) return { isSuccess: false, message: 'Container not found' }
    const exec = await container.exec({ Cmd: ['/bin/sh', '-lc', command], AttachStdout: true, AttachStderr: true })
    const stream = await exec.start({ hijack: true, stdin: false })
    const output = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      stream.on('data', c => chunks.push(Buffer.from(c)))
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      stream.on('error', reject)
    })
    return { isSuccess: true, message: 'Command executed', data: { lines: output.split('\n').map(l => l.trim()).filter(Boolean) } }
  })

  await app.listen({ host: '0.0.0.0', port: Number(process.env.AGENT_PORT ?? 7001) })
}

main().catch(err => { console.error(err); process.exit(1) })
