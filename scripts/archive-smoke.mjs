import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'

// Run only after the coordinated build is ready. Native IPC runs against an isolated
// profile; the recycle-bin callback is redirected to this fixture's recovery folder.
const workspace = process.cwd()
await mkdir(path.join(workspace, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(workspace, '.test-data', 'archive-'))
const project = path.join(temporary, '中文 项目')
const otherProject = path.join(temporary, 'other-project')
const profile = path.join(temporary, 'profile')
const trash = path.join(temporary, 'test-trash')
await Promise.all([mkdir(path.join(project, 'folder'), { recursive: true }), mkdir(otherProject), mkdir(trash)])
await writeFile(path.join(project, 'folder/note.md'), '\uFEFF# Archive\r\n\r\nOriginal content\r\n')
await writeFile(path.join(project, 'keep.md'), '[Note](folder/note.md)\n')
await writeFile(path.join(project, 'taken.md'), 'must survive\n')
await writeFile(path.join(otherProject, 'keep.md'), 'other project\n')
const gitBin = process.env.OOPSMD_SMOKE_EXE
  ? path.join(path.dirname(process.env.OOPSMD_SMOKE_EXE), 'resources', 'git', 'cmd', 'git.exe') : 'git'
const git = (...args) => execFileSync(gitBin, args, { cwd: project, encoding: 'utf8', windowsHide: true }).trim()
git('init', '-b', 'main')
git('config', 'user.name', 'OopsMD Archive Test')
git('config', 'user.email', 'test@example.invalid')
git('add', '.')
git('commit', '-m', 'baseline')
const initialHead = git('rev-parse', 'HEAD')
const originalBytes = await readFile(path.join(project, 'folder/note.md'))
const hash = createHash('sha256').update(process.platform === 'win32' ? project.toLowerCase() : project).digest('hex')
const metadata = path.join(profile, 'archive', `${hash}.json`)
const env = { ...process.env, OOPSMD_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
const checks = []
const errors = []
let app
let page
const passed = name => { checks.push(name); console.log(`PASS ${name}`) }
const invoke = (name, ...args) => page.evaluate(({ name, args }) => window.oops[name](...args), { name, args })

async function launch() {
  app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [workspace] }), env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.oops?.listArchive)
  await app.evaluate(async ({ shell }, destination) => {
    const fs = process.getBuiltinModule('fs/promises')
    const path = process.getBuiltinModule('path')
    shell.trashItem = async target => fs.rename(target, path.join(destination, path.basename(target)))
  }, trash)
}
async function exit() {
  if (!app) return
  const exiting = app
  app = undefined
  const closed = exiting.waitForEvent('close', { timeout: 10000 })
  await exiting.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}
async function choose(folder) {
  await app.evaluate(({ dialog }, destination) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] }) }, folder)
  const result = await invoke('chooseLibrary')
  assert.equal(result.root, folder)
}

try {
  await launch()
  assert.equal((await invoke('settings')).layout, 'preview')
  await choose(project)
  const initialTree = await invoke('tree')
  const entries = await invoke('archive', 'folder')
  assert.deepEqual(entries.map(entry => entry.path), ['folder'])
  assert.deepEqual(await invoke('tree'), initialTree)
  assert.deepEqual(await readFile(path.join(project, 'folder/note.md')), originalBytes)
  assert.equal(git('status', '--porcelain'), '')
  assert.equal(git('rev-parse', 'HEAD'), initialHead)
  passed('real preload IPC archives a folder without changing file bytes, links, tree or Git')

  await exit(); await launch()
  await invoke('openProject', project)
  assert.deepEqual(await invoke('listArchive'), entries)
  await choose(otherProject)
  assert.deepEqual(await invoke('listArchive'), [])
  await invoke('openProject', project)
  assert.deepEqual(await invoke('listArchive'), entries)
  passed('archive persists across restart and remains scoped to its authorized project')

  const opened = await invoke('read', 'folder/note.md')
  const recovery = { path: opened.file.path, content: 'unsaved recovery', revision: opened.file.revision, updatedAt: new Date().toISOString() }
  await invoke('draft', recovery)
  await assert.rejects(invoke('unarchive', 'folder/note.md'), /先恢复该文件夹/)
  await assert.rejects(invoke('move', 'folder/note.md', 'taken.md'), /已存在/)
  await invoke('move', 'folder/note.md', 'moved.md')
  const movedArchive = await invoke('listArchive')
  assert.deepEqual(movedArchive.map(entry => entry.path), ['folder', 'moved.md'])
  assert.ok(movedArchive.every(entry => entry.archivedAt === entries[0].archivedAt))
  assert.equal((await invoke('read', 'moved.md')).draft.content, recovery.content)
  assert.deepEqual(await readFile(path.join(project, 'moved.md')), originalBytes)
  assert.equal(await readFile(path.join(project, 'taken.md'), 'utf8'), 'must survive\n')
  passed('moving an archived descendant preserves its designation, bytes and dirty recovery draft')

  await assert.rejects(invoke('remove', 'moved.md'), /恢复草稿/)
  assert.equal((await invoke('read', 'moved.md')).draft.content, recovery.content)
  await invoke('clearDraft', 'moved.md')
  await invoke('remove', 'moved.md')
  assert.deepEqual((await invoke('listArchive')).map(entry => entry.path), ['folder'])
  assert.deepEqual(await readFile(path.join(trash, 'moved.md')), originalBytes)
  assert.equal(await stat(path.join(project, 'moved.md')).then(() => true, () => false), false)
  await invoke('unarchive', 'folder')
  assert.deepEqual(await invoke('listArchive'), [])
  passed('dirty drafts block delete; deliberate recovery removal permits recoverable trash and clears archive')

  await invoke('archive', 'keep.md')
  await app.evaluate(async (_electron, filename) => {
    const fs = process.getBuiltinModule('fs/promises')
    globalThis.__archiveOriginalRename = fs.rename
    let writes = 0
    fs.rename = async (source, target) => {
      if (target === filename && ++writes === 2) throw new Error('archive final metadata write failed')
      return globalThis.__archiveOriginalRename(source, target)
    }
  }, metadata)
  const renamed = await invoke('move', 'keep.md', 'KEEP.md')
  assert.match(renamed.warning, /文件已移动.*归档记录待完成/)
  assert.ok(JSON.parse(await readFile(metadata, 'utf8')).pending)
  await exit(); await launch()
  await invoke('openProject', project)
  assert.deepEqual((await invoke('listArchive')).map(entry => entry.path), ['KEEP.md'])
  assert.equal(JSON.parse(await readFile(metadata, 'utf8')).pending, undefined)
  await invoke('unarchive', 'KEEP.md')
  assert.deepEqual(await invoke('listArchive'), [])
  assert.equal(await readFile(path.join(project, 'KEEP.md'), 'utf8'), '[Note](folder/note.md)\n')
  passed('a completed case-only move with failed metadata cleanup recovers after process restart')

  for (const invalid of ['../outside.md', '.git/config', project]) await assert.rejects(invoke('archive', invalid))
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => {
      await new Promise(resolve => { globalThis.__releaseArchiveChooser = resolve })
      return { canceled: false, filePaths: [destination] }
    }
  }, otherProject)
  await page.evaluate(() => {
    globalThis.__archiveChoose = window.oops.chooseLibrary()
    globalThis.__staleArchive = window.oops.archive('KEEP.md').then(() => ({ ok: true }), error => ({ ok: false, error: String(error) }))
  })
  await app.evaluate(async () => {
    while (!globalThis.__releaseArchiveChooser) await new Promise(resolve => setTimeout(resolve, 10))
    globalThis.__releaseArchiveChooser()
  })
  await page.evaluate(() => globalThis.__archiveChoose)
  const stale = await page.evaluate(() => globalThis.__staleArchive)
  assert.equal(stale.ok, false)
  assert.match(stale.error, /文档库已切换/)
  assert.deepEqual(await invoke('listArchive'), [])
  await invoke('openProject', project)
  assert.deepEqual(await invoke('listArchive'), [])
  passed('invalid paths and queued stale-project archive requests are rejected by scoped IPC')

  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, checks, temporary, profile, project, metadata, trash }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, checks, errors, temporary, error: String(error) }, null, 2))
  throw error
} finally { await exit() }
