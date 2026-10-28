import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { FileService } from '../src/main/files'
import { GitService } from '../src/main/git'

const base = path.join(process.cwd(), '.test-data')
await mkdir(base, { recursive: true })
const fixture = await mkdtemp(path.join(base, 'main-perf-'))
const project = path.join(fixture, 'project')
await mkdir(project)
for (let directory = 0; directory < 40; directory++) {
  const folder = path.join(project, `folder-${directory}`)
  await mkdir(folder)
  await Promise.all(Array.from({ length: 25 }, (_, file) => writeFile(path.join(folder, `note-${file}.md`), `# Note ${directory}/${file}\n\n${'Example text. '.repeat(120)}`)))
}
const gitBinary = path.join(process.cwd(), 'vendor/git/cmd/git.exe')
const command = (...args: string[]) => execFileSync(gitBinary, args, { cwd: project, windowsHide: true, stdio: 'ignore' })
command('init', '-b', 'main'); command('config', 'user.name', 'MarkFlow Performance'); command('config', 'user.email', 'perf@example.invalid'); command('add', '.'); command('commit', '-m', 'fixture')
const files = new FileService(project, path.join(fixture, 'profile'))
const git = new GitService(project, gitBinary)
const instrumented = git as unknown as { run: (...args: unknown[]) => Promise<unknown> }
const originalRun = instrumented.run.bind(git)
let calls: string[][] = []
instrumented.run = (...args) => { calls.push(args[0] as string[]); return originalRun(...args) }
const results: Record<string, unknown> = {}
for (const [name, operation] of [
  ['tree', () => files.tree()], ['read', () => files.read('folder-0/note-0.md')],
  ['gitStatus', () => git.status()], ['baseline', () => git.baseline('folder-0/note-0.md')],
] as const) {
  const milliseconds: number[] = []
  const counts: number[] = []
  for (let sample = 0; sample < 3; sample++) {
    calls = []
    const start = performance.now()
    await operation()
    milliseconds.push(Math.round((performance.now() - start) * 10) / 10)
    counts.push(calls.length)
  }
  results[name] = { milliseconds, medianMs: [...milliseconds].sort((a, b) => a - b)[1], gitProcesses: counts, lastCommands: calls }
}
console.log(JSON.stringify({ fixture, files: 1000, directories: 40, results }, null, 2))
