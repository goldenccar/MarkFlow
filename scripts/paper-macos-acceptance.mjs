import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { app: { type: 'string' }, help: { type: 'boolean' } } })
if (values.help) {
  console.log('On a Mac: node scripts/paper-macos-acceptance.mjs --app /absolute/path/MarkFlow.app\nRuns the packaged desktop, installs its bundled environment into an empty profile, then reuses that exact environment for native compilation. Evidence: .test-data/paper-macos-*')
  process.exit(0)
}
assert.equal(process.platform, 'darwin', 'macOS acceptance requires a real Mac. No acceptance result was created on this platform.')
assert.ok(values.app, 'Pass --app /absolute/path/MarkFlow.app; a development checkout is not an installed-app test.')
const appPath = await realpath(values.app)
assert.equal(path.extname(appPath), '.app', 'The target must be a packaged .app directory.')
const capture = (program, args) => {
  try { return { status: 0, output: execFileSync(program, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }).trim() } }
  catch (error) { return { status: error.status ?? null, output: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim(), error: error.message } }
}
const bundleExecutable = capture('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')])
assert.equal(bundleExecutable.status, 0, bundleExecutable.output)
assert.equal(path.basename(bundleExecutable.output), bundleExecutable.output)
const executable = path.join(appPath, 'Contents', 'MacOS', bundleExecutable.output)
await access(executable)
await mkdir('.test-data', { recursive: true })
const evidence = await mkdtemp(path.resolve('.test-data/paper-macos-'))
const report = {
  status: 'running', startedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
  system: capture('/usr/bin/sw_vers', []), kernel: os.release(), node: process.version,
  hardwareArm: capture('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64']),
  translatedProcess: capture('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated']),
  appPath, executable: capture('/usr/bin/file', ['-L', executable]),
  signing: capture('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]),
  gatekeeper: capture('/usr/sbin/spctl', ['--assess', '--type', 'execute', appPath]),
  preexistingTeXOnPath: capture('/usr/bin/which', ['latexmk', 'xelatex', 'biber']),
  checks: [],
  pending: ['Clean operating-system installation and downloaded-installer launch are not proved by this script.', 'Offline replay requires an independently disconnected network and a separate recorded run.', 'One machine only validates the recorded architecture; the other architecture remains untested.', 'Physical IME, keyboard, accessibility and Finder drag/drop checks remain manual.'],
}
async function run(name, args) {
  const chunks = []
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { chunks.push(bytes); process.stdout.write(bytes) })
    child.once('error', reject)
    child.once('close', resolve)
  })
  await writeFile(path.join(evidence, `${name}.log`), Buffer.concat(chunks))
  assert.equal(code, 0, `${name} failed; see ${path.join(evidence, `${name}.log`)}`)
}
async function result(prefix) {
  const folders = (await readdir(evidence)).filter(name => name.startsWith(prefix))
  assert.equal(folders.length, 1, `Expected one ${prefix} evidence directory`)
  return JSON.parse(await readFile(path.join(evidence, folders[0], 'results.json'), 'utf8'))
}
try {
  const digest = createHash('sha256')
  for await (const bytes of createReadStream(path.join(appPath, 'Contents', 'Resources', 'app.asar'))) digest.update(bytes)
  report.appAsarSha256 = digest.digest('hex')
  await run('desktop', ['scripts/paper-desktop-smoke.mjs', '--app', executable, '--evidence-dir', evidence])
  const desktop = await result('paper-desktop-')
  assert.equal(desktop.application.packaged, true)
  assert.equal(desktop.application.platform, 'darwin')
  assert.ok(desktop.application.environment?.id, 'Desktop test must install the packaged environment in a fresh profile.')
  assert.deepEqual(desktop.errors, [])
  report.application = desktop.application
  report.checks.push(...desktop.checks)
  const runtime = desktop.application.environment.root
  await run('native', ['--import', 'tsx', 'scripts/paper-runtime-smoke.ts', '--runtime', runtime, '--evidence-dir', evidence])
  const native = await result('paper-native-')
  assert.equal(native.platform, 'darwin')
  assert.equal(await realpath(native.runtime.root), await realpath(runtime), 'Native and desktop checks must use the same installed environment.')
  assert.equal(native.results.length, 7)
  assert.ok(native.results.every(item => item.status === 'success'))
  report.runtime = native.runtime
  report.checks.push(...native.results)
  report.binaryTypes = Object.fromEntries(Object.entries({ ...native.runtime.engines, latexmk: native.runtime.latexmk, bibtex: native.runtime.bibtex, biber: native.runtime.biber, synctex: native.runtime.synctex }).map(([name, file]) => {
    assert.ok(file, `${name} must be included in the installed environment`)
    return [name, capture('/usr/bin/file', ['-L', file])]
  }))
  report.status = 'native-and-packaged-desktop-passed'
} catch (error) {
  report.status = 'failed'
  report.error = error.stack ?? String(error)
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await writeFile(path.join(evidence, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, evidence, pending: report.pending }, null, 2))
}
