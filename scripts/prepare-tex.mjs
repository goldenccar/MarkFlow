import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Portable distribution only: no user profile, global PATH or system installation changes.
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destination = path.join(workspace, 'vendor', 'tex')
const version = 'v2026.10'
const distributions = {
  win32: { archive: 'TinyTeX-windows-v2026.10.exe', sha256: 'e23dcc65026b96a2c34bbd793087f64e6b6e9173c20483fe875050251e3994e1', bin: 'windows', extension: '.exe' },
  darwin: { archive: 'TinyTeX-darwin-v2026.10.tar.xz', sha256: '9962e445b56f06feb2c28f73561e523e89d550e98abf910ba60b0ffb3856921f', bin: 'universal-darwin', extension: '' },
}
const distribution = distributions[process.platform]
if (!distribution) throw new Error('Pinned runtime preparation is available on Windows and macOS only.')
const { archive, sha256 } = distribution
const url = `https://github.com/rstudio/tinytex-releases/releases/download/${version}/${archive}`
await mkdir(destination, { recursive: true })
const bundle = path.join(destination, archive)
const root = path.join(destination, 'TinyTeX')
const bin = path.join(root, 'bin', distribution.bin)
const exists = async (file) => access(file).then(() => true, () => false)
const run = (program, args, cwd = destination) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { cwd, windowsHide: true, stdio: 'inherit', shell: false })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(program)} failed: ${code}`)))
})
async function hash(file) {
  const digest = createHash('sha256')
  for await (const bytes of createReadStream(file)) digest.update(bytes)
  return digest.digest('hex')
}
const started = Date.now()
if (!await exists(bundle)) {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`)
  const temporary = `${bundle}.partial`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
  if (await hash(temporary) !== sha256) throw new Error('TinyTeX checksum mismatch; bundle will not be executed.')
  await rename(temporary, bundle)
}
if (await hash(bundle) !== sha256) throw new Error('Cached TinyTeX checksum mismatch.')
if (!await exists(path.join(bin, `xelatex${distribution.extension}`))) {
  if (await exists(root)) throw new Error('An incomplete runtime exists; preserve it and resolve manually before retrying.')
  if (process.platform === 'win32') await run(bundle, ['-y'])
  else await run('/usr/bin/tar', ['-xJf', bundle, '-C', destination])
}
await access(path.join(bin, `xelatex${distribution.extension}`))
const packages = ['synctex', 'xecjk', 'ctex', 'fandol']
const perl = process.platform === 'win32' ? path.join(root, 'tlpkg', 'tlperl', 'bin', 'perl.exe') : '/usr/bin/perl'
const tlmgr = path.join(root, 'texmf-dist', 'scripts', 'texlive', 'tlmgr.pl')
if (!(await Promise.all(packages.map(name => exists(path.join(root, 'tlpkg', 'tlpobj', `${name}.tlpobj`))))).every(Boolean)) {
  const repository = 'https://mirrors.ctan.org/systems/texlive/tlnet'
  await run(perl, [tlmgr, '--repository', repository, 'update', '--self'])
  await run(perl, [tlmgr, '--repository', repository, 'install', ...packages])
}
if (process.platform === 'darwin') await run(perl, [tlmgr, 'postaction', 'install', 'script', 'xetex'])
const packageRevisions = {}
for (const name of packages) {
  const contents = await readFile(path.join(root, 'tlpkg', 'tlpobj', `${name}.tlpobj`), 'utf8')
  packageRevisions[name] = contents.match(/^revision (\d+)/m)?.[1] ?? 'unknown'
}
const manifest = { version, platform: process.platform, architecture: process.arch, source: url, sha256, supplementalRepository: 'https://mirrors.ctan.org/systems/texlive/tlnet', packageRevisions, texLiveDatabaseSha256: await hash(path.join(root, 'tlpkg', 'texlive.tlpdb')), preparedAt: new Date().toISOString(), preparationMs: Date.now() - started, root: 'TinyTeX' }
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest, null, 2))
