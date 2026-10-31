import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PaperEnvironmentManager } from '../src/main/paperEnvironment'
import catalog from '../src/main/paperEnvironmentCatalog.json'

const { values } = parseArgs({ options: { directory: { type: 'string' }, bundles: { type: 'string' } } })
if (!values.directory) throw new Error('Pass --directory with a new, empty evidence directory (at least 2 GB free).')
const directory = path.resolve(values.directory)
await mkdir(directory, { recursive: true })
if ((await readdir(directory)).length) throw new Error('The verification directory must be empty; existing data will not be removed.')
let cancel = false, lastPhase = ''
const started = Date.now()
const environment = new PaperEnvironmentManager({
  directory: path.join(directory, 'environments'), catalog,
  bundledDirectory: path.resolve(values.bundles ?? 'vendor/tex/cache'),
  onProgress: state => {
    if (state.phase !== lastPhase) { console.log(`${state.phase}: ${state.message}`); lastPhase = state.phase }
    if (cancel && state.phase === 'extracting' && state.progress > 20) environment.cancel()
  },
})
assert.equal((await environment.runtime()).available, false)
const installed = await environment.install()
assert.equal(installed.phase, 'ready', installed.message)
const runtime = await environment.runtime()
assert.ok(runtime.available, runtime.message)
assert.ok(runtime.root.startsWith(path.join(directory, 'environments') + path.sep))
const pointer = await readFile(path.join(directory, 'environments', 'active.json'), 'utf8')
const verifiedBundle = JSON.parse(await readFile(path.join(runtime.root, '.markflow-environment.json'), 'utf8'))
assert.deepEqual(verifiedBundle, catalog.find(entry => entry.id === installed.activeVersion))
cancel = true
assert.equal((await environment.install()).phase, 'cancelled')
assert.equal(await readFile(path.join(directory, 'environments', 'active.json'), 'utf8'), pointer)
assert.equal((await environment.runtime()).root, runtime.root)
assert.ok(!(await readdir(path.join(directory, 'environments'))).some(name => name.startsWith('.staging-')))
await writeFile(path.join(directory, 'installation.json'), JSON.stringify({ platform: process.platform, architecture: process.arch, installed, verifiedBundle, runtime, cancelledInstallPreservedActive: true, installationAndCancellationMs: Date.now() - started }, null, 2))
await new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/paper-runtime-smoke.ts', '--runtime', runtime.root, '--evidence-dir', directory], { stdio: 'inherit', windowsHide: true, shell: false })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Native runtime verification failed: ${code}`)))
})
console.log(JSON.stringify({ directory, runtime: runtime.root, durationMs: Date.now() - started }, null, 2))
