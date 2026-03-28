/**
 * Downloads official Pterodactyl panel stock eggs (database/Seeders/eggs) and writes
 * apps/api/src/data/pterodactyl-eggs.json for Wave template import.
 *
 * Run: node scripts/fetch-pterodactyl-eggs.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'apps/api/src/data/pterodactyl-eggs.json')

const TREE_URL =
  'https://api.github.com/repos/pterodactyl/panel/git/trees/1.0-develop?recursive=1'
const RAW =
  'https://raw.githubusercontent.com/pterodactyl/panel/1.0-develop'

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'wave-hosting-egg-import/1.0' } }, res => {
        let data = ''
        res.on('data', c => (data += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} ${url}`))
            return
          }
          resolve(JSON.parse(data))
        })
      })
      .on('error', reject)
  })
}

function parseStop(config) {
  if (!config?.stop) return ''
  const raw = String(config.stop).trim()
  if (raw.startsWith('{')) {
    try {
      const j = JSON.parse(raw.replace(/\r\n/g, '\n'))
      return typeof j.stop === 'string' ? j.stop : ''
    } catch {
      return ''
    }
  }
  return raw
}

/** Default game port guesses when egg does not expose SERVER_PORT in startup */
function guessPorts(relPath, name) {
  const p = relPath.toLowerCase()
  if (p.includes('/minecraft/')) return [25565]
  if (p.includes('/rust/')) return [28015]
  if (name.toLowerCase().includes('mumble')) return [64738]
  if (name.toLowerCase().includes('teamspeak')) return [9987, 10011, 30033, 10080, 10022]
  if (p.includes('/source-engine/')) return [27015]
  return [27015]
}

function dockerImagesFromEgg(egg) {
  if (egg.docker_images && typeof egg.docker_images === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(egg.docker_images)) {
      out[k] = String(v).replace(/\\\//g, '/')
    }
    return out
  }
  if (Array.isArray(egg.images)) {
    const out = {}
    egg.images.forEach((img, i) => {
      out[egg.images.length === 1 ? 'default' : `Image ${i + 1}`] = String(img).replace(/\\\//g, '/')
    })
    return out
  }
  return null
}

function defaultImageKey(dockerImages) {
  const keys = Object.keys(dockerImages)
  const prefer = ['Java 21', 'Java 17', 'Java 11', 'Java 8', 'default', 'Image 1']
  for (const p of prefer) {
    if (dockerImages[p]) return p
  }
  return keys[0] ?? ''
}

function envFromVariables(variables) {
  const env = {}
  if (!Array.isArray(variables)) return env
  for (const v of variables) {
    if (v.env_variable && v.default_value !== undefined && v.default_value !== null) {
      env[v.env_variable] = String(v.default_value)
    }
  }
  return env
}

function installPipelineId(relPath, eggName) {
  const f = path.basename(relPath).toLowerCase()
  if (f.includes('egg-paper')) return 'minecraft-paper'
  if (f.includes('egg-vanilla')) return 'minecraft-vanilla'
  if (f.includes('egg-forge')) return 'minecraft-forge'
  if (f.includes('egg-bungee')) return 'minecraft-bungeecord'
  if (f.includes('sponge')) return 'minecraft-sponge'
  if (f.includes('teamspeak')) return 'teamspeak3'
  return ''
}

function slugId(relPath) {
  const base = path.basename(relPath, '.json')
  const slug = base.replace(/^egg-/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  const folder = path.basename(path.dirname(relPath))
  return `ptero-${folder}-${slug}`
}

async function main() {
  const tree = await getJson(TREE_URL)
  const eggPaths = tree.tree
    .filter(
      x =>
        x.type === 'blob' &&
        x.path.startsWith('database/Seeders/eggs/') &&
        x.path.endsWith('.json')
    )
    .map(x => x.path)

  const templates = []

  for (const eggPath of eggPaths) {
    const rawUrl = `${RAW}/${eggPath}`
    const egg = await getJson(rawUrl)
    const dockerImages = dockerImagesFromEgg(egg)
    if (!dockerImages || Object.keys(dockerImages).length === 0) {
      console.warn('skip (no images):', eggPath)
      continue
    }

    const defaultKey = defaultImageKey(dockerImages)
    const image = dockerImages[defaultKey]
    const startupCommand = String(egg.startup ?? '')
      .replace(/\r\n/g, '\n')
      .trim()
    const stopCommand = parseStop(egg.config ?? {})
    const env = envFromVariables(egg.variables)
    const id = slugId(eggPath)
    const category = eggPath.includes('minecraft') ? 'game' : 'game'
    const defaultPorts = guessPorts(eggPath, egg.name ?? '')

    const pipeline = installPipelineId(eggPath, egg.name ?? '')

    templates.push({
      id,
      name: egg.name ?? id,
      category,
      image,
      dockerImages,
      defaultDockerImageKey: defaultKey,
      startupCommand,
      stopCommand,
      defaultPorts,
      env,
      eggAuthor: egg.author,
      eggDescription: egg.description,
      pteroFeatures: Array.isArray(egg.features) ? egg.features : [],
      sourcePath: eggPath,
      installPipelineId: pipeline || undefined
    })
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), templates }, null, 2), 'utf-8')
  console.log(`Wrote ${templates.length} templates to ${path.relative(ROOT, OUT)}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
