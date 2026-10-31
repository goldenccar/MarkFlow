import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { sha256File, validatePaperBundle, type PaperBundleEntry, type PaperBundleManifest, type PaperEnvironmentCatalogEntry } from '../src/main/paperBundle'
import { inspectPaperRuntime } from '../src/main/paperRuntime'

// Freeze a prepared runtime, including its package database and license notices.
// End users install the resulting package in the app; tlmgr is never run on their machine.
const argument = (name: string, fallback: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback
const root = path.resolve(argument('--root', 'vendor/tex/TinyTeX'))
const output = path.resolve(argument('--output', 'vendor/tex/cache'))
const catalogPath = path.resolve(argument('--catalog', 'src/main/paperEnvironmentCatalog.json'))
const version = argument('--version', '2026.10.1')
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,40}$/.test(version)) throw new Error('Invalid runtime version.')
const runtime = await inspectPaperRuntime({ root })
if (!runtime.available || !runtime.bibtex || !runtime.biber || !runtime.synctex || !runtime.engines.lualatex) throw new Error(`Runtime is incomplete: ${runtime.message ?? root}`)
const relativeFiles: string[] = []
async function walk(directory: string, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (!prefix && entry.name === 'temp') continue
    const relative = prefix + entry.name
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/')
    else relativeFiles.push(relative)
  }
}
await walk(root)
const files: PaperBundleEntry[] = new Array(relativeFiles.length)
let cursor = 0
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < relativeFiles.length) {
    const index = cursor++, relative = relativeFiles[index], file = path.join(root, relative)
    const info = await lstat(file)
    if (info.isSymbolicLink()) {
      // Resolve internal link chains into direct relative links for a portable, bounded extractor.
      let target = path.resolve(path.dirname(file), await readlink(file))
      for (let depth = 0; (await lstat(target)).isSymbolicLink(); depth++) {
        if (depth > 30) throw new Error(`Cyclic symlink: ${relative}`)
        target = path.resolve(path.dirname(target), await readlink(target))
      }
      const inside = path.relative(root, target)
      if (inside.startsWith('..') || path.isAbsolute(inside) || !(await stat(target)).isFile()) throw new Error(`Unsafe symlink: ${relative}`)
      files[index] = { path: relative, size: 0, sha256: createHash('sha256').digest('hex'), mode: 0o755, link: path.relative(path.dirname(file), target).replaceAll('\\', '/') }
    } else {
      if (!info.isFile()) throw new Error(`Unsupported file: ${relative}`)
      files[index] = { path: relative, size: info.size, sha256: await sha256File(file), mode: info.mode & 0o777 }
    }
  }
}))
const packages: PaperBundleManifest['packages'] = {}
for (const relative of relativeFiles.filter(file => file.startsWith('tlpkg/tlpobj/') && file.endsWith('.tlpobj'))) {
  const source = await readFile(path.join(root, relative), 'utf8')
  packages[path.basename(relative, '.tlpobj')] = { revision: source.match(/^revision (.+)$/m)?.[1] ?? 'unknown', license: source.match(/^catalogue-license (.+)$/m)?.[1] }
}
const provenance = JSON.parse(await readFile(path.resolve(argument('--provenance', 'vendor/tex/manifest.json')), 'utf8'))
const manifest: PaperBundleManifest = {
  format: 1, id: `texlive-${version}-${process.platform}-${process.arch}`, version, platform: process.platform, arch: process.arch,
  packages, licenses: files.filter(file => /(?:^|\/)(?:LICENSE(?:\.|$)|LICENCE(?:\.|$)|COPYING(?:\.|$))/i.test(file.path)).map(file => file.path), provenance, files,
}
const manifestBytes = Buffer.from(JSON.stringify(manifest))
const entry: PaperEnvironmentCatalogEntry = {
  id: manifest.id, version, platform: process.platform, arch: process.arch,
  filename: '', sha256: '', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), bytes: 0,
  expandedBytes: files.reduce((sum, file) => sum + file.size, 0),
}
entry.filename = `${entry.id}-${entry.manifestSha256.slice(0, 12)}.mftex.gz`
validatePaperBundle(manifest, entry)
await mkdir(output, { recursive: true })
const temporary = path.join(output, `.pack-${randomUUID()}.partial`)
const bundle = path.join(output, entry.filename)
const header = Buffer.alloc(12)
header.write('MFTEX01\n'); header.writeUInt32BE(manifestBytes.length, 8)
console.log(`Freezing ${files.length} files (${Math.round(entry.expandedBytes / 1048576)} MiB) from ${root}`)
async function* content() {
  yield header; yield manifestBytes
  for (const file of files) {
    if (file.link !== undefined) continue
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(path.join(root, file.path))) { digest.update(chunk); yield chunk }
    if (digest.digest('hex') !== file.sha256) throw new Error(`Runtime changed while packaging: ${file.path}`)
  }
}
try {
  await pipeline(Readable.from(content()), createGzip({ level: 6 }), createWriteStream(temporary, { flags: 'wx' }))
  entry.bytes = (await stat(temporary)).size
  entry.sha256 = await sha256File(temporary)
  const existing = await stat(bundle).catch(() => undefined)
  if (existing) {
    if (existing.size !== entry.bytes || await sha256File(bundle) !== entry.sha256) throw new Error('An immutable bundle already exists with different bytes.')
    await rm(temporary)
  } else await rename(temporary, bundle)
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8').catch(() => '[]')) as PaperEnvironmentCatalogEntry[]
  if (catalog.some(old => old.id === entry.id && old.sha256 !== entry.sha256)) throw new Error('This immutable version already has different contents. Increment --version before releasing it.')
  await writeFile(catalogPath, JSON.stringify([entry, ...catalog.filter(old => old.id !== entry.id)], null, 2) + '\n')
  await writeFile(path.join(output, `${entry.id}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(path.join(output, `${entry.id}.catalog.json`), JSON.stringify(entry, null, 2) + '\n')
  console.log(JSON.stringify({ bundle, ...entry, fileCount: files.length, packageCount: Object.keys(packages).length, licenses: manifest.licenses }, null, 2))
} finally { await rm(temporary, { force: true }) }
