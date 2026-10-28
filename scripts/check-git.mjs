import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

export const workspace = fileURLToPath(new URL('../', import.meta.url))
export const manifestPath = path.join(workspace, 'vendor', 'git-manifest.json')
const exec = promisify(execFile)
export const sha256 = data => createHash('sha256').update(data).digest('hex')

export async function readManifest() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.platform !== 'win32' || manifest.architecture !== 'x64'
    || !/^MinGit-[\d.]+-64-bit\.zip$/.test(manifest.archive)
    || !/^https:\/\/github\.com\/git-for-windows\/git\/releases\/download\/v[\d.]+windows\.\d+\/MinGit-[\d.]+-64-bit\.zip$/.test(manifest.downloadUrl)
    || !/^[a-f\d]{64}$/.test(manifest.archiveSha256) || !/^[a-f\d]{64}$/.test(manifest.treeSha256)) {
    throw new Error('Invalid pinned Git runtime manifest; inspect vendor/git-manifest.json.')
  }
  return manifest
}

export function sourceNotice(manifest) {
  return [
    `MarkFlow bundles the unmodified ${manifest.archive} runtime.`,
    `Release: ${manifest.releaseUrl}`,
    `Archive SHA-256: ${manifest.archiveSha256}`,
    '',
    'Git is distributed under GPL version 2. All original license files are retained.',
    'Git Credential Manager is MIT licensed; OpenSSH and runtime libraries have their own license notices.',
    `GPL text: ${manifest.gplUrl}`,
    `Corresponding Git source and build recipe archive: ${manifest.sourceArchiveUrl}`,
    `Git source tree: ${manifest.sourceTreeUrl}`,
    `Git for Windows SDK/component source and package metadata: ${manifest.componentSourcesUrl}`,
    '',
    'This file provides upstream source locations. It is not a publisher-specific written source offer.',
    'Public redistributors must make the corresponding source available as required by the bundled licenses.',
    '',
  ].join('\n')
}

export async function runtimeInventory(root) {
  const files = []
  async function walk(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const item = path.posix.join(relative, entry.name)
      // Legacy provenance files are accepted only while prepare:git refreshes metadata.
      if (['MARKFLOW-GIT-SOURCE.txt', '.markflow-runtime.json', 'OOPSMD-GIT-SOURCE.txt', '.oopsmd-runtime.json'].includes(item)) continue
      if (entry.isSymbolicLink()) throw new Error(`Git runtime must not contain symlinks: ${item}`)
      if (entry.isDirectory()) await walk(item)
      else if (entry.isFile()) files.push(item)
      else throw new Error(`Unexpected Git runtime entry: ${item}`)
    }
  }
  await walk('')
  files.sort()
  const hash = createHash('sha256')
  let bytes = 0
  for (const item of files) {
    const content = await fs.readFile(path.join(root, item))
    bytes += content.length
    hash.update(`${item}\0${sha256(content)}\n`)
  }
  return { sha256: hash.digest('hex'), files: files.length, bytes }
}

export async function verifyRuntime(root = path.join(workspace, 'vendor', 'git'), manifest, { metadata = true } = {}) {
  manifest ??= await readManifest()
  const inventory = await runtimeInventory(root)
  if (inventory.sha256 !== manifest.treeSha256 || inventory.files !== manifest.fileCount || inventory.bytes !== manifest.expandedBytes) {
    throw new Error('Bundled Git files do not match the pinned archive. No files were overwritten; inspect vendor/git or restore it with npm run prepare:git in a clean directory.')
  }
  for (const license of manifest.requiredLicenses) if (!(await fs.readFile(path.join(root, license))).length) throw new Error(`Missing license: ${license}`)
  if (metadata) {
    if (await fs.readFile(path.join(root, 'MARKFLOW-GIT-SOURCE.txt'), 'utf8') !== sourceNotice(manifest)) throw new Error('Git source/license notice is missing or altered. Run npm run prepare:git to refresh the runtime metadata.')
    if (await fs.readFile(path.join(root, '.markflow-runtime.json'), 'utf8') !== `${JSON.stringify(manifest, null, 2)}\n`) throw new Error('Bundled Git provenance manifest differs from the pinned manifest.')
  }
  if (process.platform !== 'win32') throw new Error('Execute the Windows Git runtime check on Windows.')
  // Exclude installed Git from PATH; the bundled executables must work on their own.
  const env = { ...process.env, PATH: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_TERMINAL_PROMPT: '0' }
  for (const key of ['Path', 'GIT_EXEC_PATH', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG', 'GIT_CONFIG_COUNT']) delete env[key]
  const run = async (file, args) => {
    const result = await exec(path.join(root, file), args, { env, cwd: root, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 })
    return `${result.stdout}${result.stderr}`.trim()
  }
  const git = await run(manifest.gitPath, ['--version'])
  const credentialManager = await run(manifest.gitPath, ['credential-manager', '--version'])
  const ssh = await run(manifest.sshPath, ['-V'])
  const sshViaGit = await run(manifest.gitPath, ['-c', 'alias.oopsmd-check-ssh=!ssh -V', 'oopsmd-check-ssh'])
  if (git !== manifest.version || credentialManager !== manifest.credentialManagerVersion || ssh !== manifest.sshVersion || sshViaGit !== manifest.sshVersion) throw new Error('Bundled executable versions differ from the pinned manifest.')
  return { git, credentialManager, ssh, files: inventory.files, bytes: inventory.bytes, licenses: 'retained and verified', authentication: 'binaries verified; no account authentication attempted' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = process.argv[2] ? path.resolve(process.argv[2]) : undefined
    console.log(JSON.stringify(await verifyRuntime(root), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
