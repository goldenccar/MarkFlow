import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { PaperEnvironmentManager } from '../src/main/paperEnvironment'
import { validatePaperBundle, type PaperBundleManifest, type PaperEnvironmentCatalogEntry } from '../src/main/paperBundle'
import type { PaperRuntime } from '../src/main/paperRuntime'

const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
async function fixture(directory: string, version: string, alter?: (manifest: PaperBundleManifest) => void) {
  const content = Buffer.from(`portable compiler ${version}`)
  const manifest: PaperBundleManifest = {
    format: 1, id: `fixture-${version}`, version, platform: process.platform, arch: process.arch,
    packages: { fixture: { revision: '1', license: 'MIT' } }, provenance: {}, licenses: ['LICENSE.TL'],
    files: [{ path: 'LICENSE.TL', size: content.length, sha256: hash(content), mode: 0o644 }],
  }
  alter?.(manifest)
  const json = Buffer.from(JSON.stringify(manifest)), prefix = Buffer.alloc(12)
  prefix.write('MFTEX01\n'); prefix.writeUInt32BE(json.length, 8)
  const bytes = gzipSync(Buffer.concat([prefix, json, content]))
  const entry: PaperEnvironmentCatalogEntry = {
    id: manifest.id, version, platform: process.platform, arch: process.arch, filename: `${manifest.id}.mftex.gz`,
    sha256: hash(bytes), manifestSha256: hash(json), bytes: bytes.length, expandedBytes: content.length,
  }
  const bundle = path.join(directory, entry.filename)
  await writeFile(bundle, bytes)
  return { entry, bundle, manifest }
}
const inspect = async ({ root }: { root?: string } = {}): Promise<PaperRuntime> => {
  const content = await readFile(path.join(root!, 'LICENSE.TL'), 'utf8').catch(() => '')
  return { available: content.startsWith('portable compiler'), root: root!, binDir: root!, latexmk: 'latexmk', engines: { xelatex: 'xelatex', pdflatex: 'pdflatex', lualatex: 'lualatex' }, bibtex: 'bibtex', biber: 'biber', synctex: 'synctex' }
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'markflow-environment-'))
  try { await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('verified offline install activates only after validation and supports rollback', () => temporary(async directory => {
  const first = await fixture(directory, '1'), second = await fixture(directory, '2')
  const environment = new PaperEnvironmentManager({ directory: path.join(directory, 'managed'), catalog: [first.entry, second.entry], bundledDirectory: directory, inspect })
  assert.equal((await environment.runtime()).available, false)
  assert.equal((await environment.install()).phase, 'ready')
  const oldRoot = (await environment.runtime()).root
  assert.equal((await environment.install(second.bundle)).activeVersion, 'fixture-2')
  assert.equal((await environment.status()).canRollback, true)
  const newRoot = (await environment.runtime()).root
  assert.notEqual(oldRoot, newRoot)
  assert.equal((await environment.rollback()).activeVersion, 'fixture-1')
  assert.equal((await environment.runtime()).root, oldRoot)
  assert.equal(await readFile(path.join(newRoot, 'LICENSE.TL'), 'utf8'), 'portable compiler 2')
  const restarted = new PaperEnvironmentManager({ directory: path.join(directory, 'managed'), catalog: [first.entry, second.entry], inspect })
  assert.equal((await restarted.status()).phase, 'ready')
  assert.equal((await restarted.runtime()).root, oldRoot)
}))

test('a corrupt bundle is rejected before extraction and preserves the active runtime', () => temporary(async directory => {
  const first = await fixture(directory, '1'), second = await fixture(directory, '2')
  const environment = new PaperEnvironmentManager({ directory: path.join(directory, 'managed'), catalog: [first.entry, second.entry], inspect })
  await environment.install(first.bundle)
  const oldRoot = (await environment.runtime()).root
  const corrupt = await readFile(second.bundle); corrupt[corrupt.length - 1] ^= 1; await writeFile(second.bundle, corrupt)
  assert.equal((await environment.install(second.bundle)).phase, 'error')
  assert.equal((await environment.runtime()).root, oldRoot)
  assert.deepEqual((await readdir(path.join(directory, 'managed'))).filter(name => name.startsWith('.staging-')), [])
}))

test('cancellation during extraction preserves the old runtime and retry succeeds', () => temporary(async directory => {
  const first = await fixture(directory, '1'), second = await fixture(directory, '2')
  let cancel = false
  const environment = new PaperEnvironmentManager({ directory: path.join(directory, 'managed'), catalog: [first.entry, second.entry], inspect, onProgress: state => { if (cancel && state.phase === 'extracting') environment.cancel() } })
  await environment.install(first.bundle)
  const oldRoot = (await environment.runtime()).root
  cancel = true
  assert.equal((await environment.install(second.bundle)).phase, 'cancelled')
  assert.equal((await environment.runtime()).root, oldRoot)
  assert.deepEqual((await readdir(path.join(directory, 'managed'))).filter(name => name.startsWith('.staging-')), [])
  cancel = false
  assert.equal((await environment.install(second.bundle)).phase, 'ready')
}))

test('path traversal in even an authenticated malformed package is rejected before writing', () => temporary(async directory => {
  const malformed = await fixture(directory, '1', manifest => { manifest.files[0].path = '../escaped.txt' })
  const environment = new PaperEnvironmentManager({ directory: path.join(directory, 'managed'), catalog: [malformed.entry], inspect })
  assert.equal((await environment.install(malformed.bundle)).phase, 'error')
  assert.deepEqual(await readdir(path.join(directory, 'managed')), [])
  assert.ok(!(await readdir(directory)).includes('escaped.txt'))
}))

test('manifest rejects unsafe links, file-directory conflicts, duplicates and mismatched payload hashes', () => temporary(async directory => {
  const { manifest, entry } = await fixture(directory, '1')
  const bad = (alter: (copy: PaperBundleManifest) => void) => {
    const copy = structuredClone(manifest); alter(copy); assert.throws(() => validatePaperBundle(copy, entry))
  }
  bad(copy => { copy.files.push({ ...copy.files[0], path: 'license.tl' }) })
  bad(copy => { copy.files.push({ ...copy.files[0], path: 'LICENSE.TL/child' }) })
  bad(copy => { copy.files.push({ path: 'tool', size: 0, sha256: hash(Buffer.alloc(0)), mode: 0o755, link: '../outside' }) })
  bad(copy => { copy.files[0].path = 'C:/outside' })
  bad(copy => { copy.files[0].path = 'NUL.txt' })
  bad(copy => { copy.files[0].path = 'folder\\outside' })
  const malformed = await fixture(directory, '2', copy => { copy.files[0].sha256 = '0'.repeat(64) })
  const environment = new PaperEnvironmentManager({ directory: path.join(directory, 'managed'), catalog: [malformed.entry], inspect })
  assert.equal((await environment.install(malformed.bundle)).phase, 'error')
  assert.equal((await environment.runtime()).available, false)
}))

test('failed runtime validation does not activate or retain an incomplete installation', () => temporary(async directory => {
  const first = await fixture(directory, '1')
  const environment = new PaperEnvironmentManager({ directory: path.join(directory, 'managed'), catalog: [first.entry], inspect: async options => ({ ...await inspect(options), biber: undefined }) })
  assert.equal((await environment.install(first.bundle)).phase, 'error')
  assert.equal((await environment.runtime()).available, false)
  assert.deepEqual(await readdir(path.join(directory, 'managed')), [])
}))

test('unsupported platform packages and invalid active receipts never become executable roots', () => temporary(async directory => {
  const first = await fixture(directory, '1')
  const unsupported = new PaperEnvironmentManager({ directory: path.join(directory, 'unsupported'), catalog: [{ ...first.entry, arch: 'different-architecture' }], inspect })
  assert.equal((await unsupported.install(first.bundle)).phase, 'error')
  const environment = new PaperEnvironmentManager({ directory: path.join(directory, 'managed'), catalog: [first.entry], inspect })
  await environment.install(first.bundle)
  const root = (await environment.runtime()).root
  await writeFile(path.join(root, '.markflow-environment.json'), JSON.stringify({ id: first.entry.id, sha256: 'untrusted' }))
  assert.equal((await environment.runtime()).available, false)
  assert.equal((await environment.status()).activeVersion, undefined)
  assert.equal((await environment.status()).phase, 'idle')
}))

test('a missing active receipt never probes or executes a placeholder runtime', () => temporary(async directory => {
  let probes = 0
  const environment = new PaperEnvironmentManager({ directory, catalog: [], inspect: async options => { probes++; return inspect(options) } })
  assert.equal((await environment.runtime()).available, false)
  assert.equal(probes, 0)
}))
