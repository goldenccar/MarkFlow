import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { workspace, readManifest, sha256, sourceNotice, verifyRuntime } from './check-git.mjs'

const exec = promisify(execFile)
const vendor = path.join(workspace, 'vendor')
const destination = path.join(vendor, 'git')
const exists = async target => { try { await fs.access(target); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
const quote = value => `'${value.replaceAll("'", "''")}'`

async function addNotices(root, manifest) {
  await fs.writeFile(path.join(root, 'OOPSMD-GIT-SOURCE.txt'), sourceNotice(manifest))
  await fs.writeFile(path.join(root, '.oopsmd-runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function prepare() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This runtime is for Windows x64; run preparation on Windows x64.')
  const manifest = await readManifest()
  await fs.mkdir(vendor, { recursive: true })
  if (await exists(destination)) {
    await verifyRuntime(destination, manifest, { metadata: false })
    await addNotices(destination, manifest)
    console.log(JSON.stringify(await verifyRuntime(destination, manifest), null, 2))
    return
  }
  const archive = path.join(vendor, manifest.archive)
  if (!await exists(archive)) {
    console.log(`Downloading pinned official Git runtime: ${manifest.archive}`)
    const response = await fetch(manifest.downloadUrl, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok) throw new Error(`Git download failed: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length !== manifest.archiveBytes || sha256(bytes) !== manifest.archiveSha256) throw new Error('Git archive checksum mismatch; download discarded.')
    await fs.writeFile(archive, bytes, { flag: 'wx' })
  }
  const bytes = await fs.readFile(archive)
  if (bytes.length !== manifest.archiveBytes || sha256(bytes) !== manifest.archiveSha256) throw new Error(`Cached archive checksum mismatch; inspect ${archive}.`)
  const staging = await fs.mkdtemp(path.join(vendor, '.git-staging-'))
  try {
    const command = `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(staging)}`
    // Windows PowerShell must discover its own modules instead of inheriting PowerShell 7 paths.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'))
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { env, windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024 })
    await verifyRuntime(staging, manifest, { metadata: false })
    await addNotices(staging, manifest)
    await verifyRuntime(staging, manifest)
    if (await exists(destination)) throw new Error('vendor/git appeared during preparation; refusing to replace it.')
    await fs.rename(staging, destination)
    console.log(JSON.stringify(await verifyRuntime(destination, manifest), null, 2))
  } finally {
    // Delete only this script's freshly created staging directory, within vendor.
    const resolved = path.resolve(staging)
    if (path.dirname(resolved) !== path.resolve(vendor) || !path.basename(resolved).startsWith('.git-staging-')) throw new Error('Invalid runtime staging directory.')
    await fs.rm(resolved, { recursive: true, force: true })
  }
}

try { await prepare() } catch (error) { console.error(error.message); process.exitCode = 1 }
