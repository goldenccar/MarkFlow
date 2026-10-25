import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { GitService } from '../src/main/git'

const identity = { name: 'OopsMD Test', email: 'oopsmd@example.invalid' }
const git = (cwd: string, ...args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile('git', ['-c', 'core.autocrlf=false', ...args], { cwd, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout.trimEnd()))
})
async function temp(t: TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oopsmd-git-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
async function library(t: TestContext, initial: Record<string, string | Buffer> = { 'note.md': 'baseline\n' }) {
  const root = await temp(t)
  for (const [name, content] of Object.entries(initial)) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), content) }
  const service = new GitService(root)
  await service.init(identity)
  await git(root, 'config', 'core.autocrlf', 'false')
  return { root, service }
}
async function clones(t: TestContext) {
  const dir = await temp(t)
  const remote = path.join(dir, 'remote.git')
  const a = path.join(dir, 'a')
  const b = path.join(dir, 'b')
  await mkdir(remote); await mkdir(a)
  await git(remote, 'init', '--bare', '--initial-branch=main')
  await writeFile(path.join(a, 'note.md'), 'baseline\n')
  const first = new GitService(a)
  await first.init(identity)
  await git(a, 'config', 'core.autocrlf', 'false')
  await git(a, 'remote', 'add', 'origin', remote)
  await first.sync()
  await git(dir, 'clone', remote, b)
  await git(b, 'config', 'user.name', identity.name)
  await git(b, 'config', 'user.email', identity.email)
  await git(b, 'config', 'core.autocrlf', 'false')
  return { a, b, remote, first, second: new GitService(b) }
}

test('detection is read-only, initialization creates one explicit baseline', async t => {
  const root = await temp(t)
  await writeFile(path.join(root, 'note.md'), 'hello\n')
  const service = new GitService(root)
  assert.equal((await service.status()).repository, false)
  assert.equal(await service.baseline('note.md'), null)
  const state = await service.init(identity)
  assert.equal(state.repository, true)
  assert.equal(state.branch, 'main')
  assert.equal(await service.baseline('note.md'), 'hello\n')
  assert.equal((await service.history('note.md')).length, 1)
  await writeFile(path.join(root, 'note.md'), 'changed\n')
  await service.init(identity)
  assert.equal((await service.history('note.md')).length, 1)
})

test('single-file commits preserve unrelated partial staging and working copies', async t => {
  const { root, service } = await library(t, { 'note.md': 'base\n', 'other.md': 'other base\n' })
  await writeFile(path.join(root, 'other.md'), 'staged other\n')
  await git(root, 'add', 'other.md')
  await writeFile(path.join(root, 'other.md'), 'unstaged other\n')
  await writeFile(path.join(root, 'note.md'), 'my snapshot\n')
  const result = await service.commit(['note.md'], 'Save note', { 'note.md': 'my snapshot\n' })
  assert.equal(result.error, undefined)
  assert.equal(result.committed, true)
  assert.equal(await git(root, 'show', 'HEAD:other.md'), 'other base')
  assert.equal(await git(root, 'show', ':other.md'), 'staged other')
  assert.equal(await readFile(path.join(root, 'other.md'), 'utf8'), 'unstaged other\n')
  assert.equal(await git(root, 'diff', '--cached', '--name-only'), 'other.md')
  assert.equal(await git(root, 'show', 'HEAD:note.md'), 'my snapshot')
  assert.equal((await service.commit(['note.md'], 'No change')).committed, false)
})

test('current-path partial staging rejects commit without changing either version', async t => {
  const { root, service } = await library(t)
  await writeFile(path.join(root, 'note.md'), 'staged\n')
  await git(root, 'add', 'note.md')
  await writeFile(path.join(root, 'note.md'), 'later saved\n')
  const before = await git(root, 'rev-parse', 'HEAD')
  const result = await service.commit(['note.md'], 'Should reject')
  assert.equal(result.committed, false)
  assert.match(result.error!, /暂存/)
  assert.equal(await git(root, 'rev-parse', 'HEAD'), before)
  assert.equal(await git(root, 'show', ':note.md'), 'staged')
  assert.equal(await readFile(path.join(root, 'note.md'), 'utf8'), 'later saved\n')
})

test('snapshot expectation detects external disk drift before committing', async t => {
  const { root, service } = await library(t)
  await writeFile(path.join(root, 'note.md'), 'external content\n')
  const result = await service.commit(['note.md'], 'Should reject', { 'note.md': 'expected content\n' })
  assert.equal(result.committed, false)
  assert.match(result.error!, /外部修改/)
  assert.equal(await service.baseline('note.md'), 'baseline\n')
  assert.equal(await readFile(path.join(root, 'note.md'), 'utf8'), 'external content\n')
})

test('editing after snapshot capture remains on disk without entering the recorded version', async t => {
  const { root, service } = await library(t)
  await writeFile(path.join(root, 'note.md'), 'captured snapshot\n')
  const internal = service as unknown as { run: (args: string[], options?: unknown) => Promise<Buffer> }
  const run = internal.run.bind(service)
  internal.run = async (args, options) => {
    if (args[0] === 'commit-tree') await writeFile(path.join(root, 'note.md'), 'later typing\n')
    return run(args, options)
  }
  assert.equal((await service.commit(['note.md'], 'Captured', { 'note.md': 'captured snapshot\n' })).committed, true)
  assert.equal(await service.baseline('note.md'), 'captured snapshot\n')
  assert.equal(await readFile(path.join(root, 'note.md'), 'utf8'), 'later typing\n')
  assert.deepEqual((await service.status()).changes, ['note.md'])
})

test('locks and missing identity leave saved content intact, without deleting another lock', async t => {
  const { root, service } = await library(t)
  await writeFile(path.join(root, 'note.md'), 'saved\n')
  const lock = path.join(root, '.git', 'index.lock')
  await writeFile(lock, 'external lock')
  assert.match((await service.commit(['note.md'], 'Locked')).error!, /锁定/)
  assert.equal(await readFile(lock, 'utf8'), 'external lock')
  await rm(lock)
  await git(root, 'config', 'user.name', '')
  assert.match((await service.commit(['note.md'], 'No identity')).error!, /姓名和邮箱/)
  assert.equal(await readFile(path.join(root, 'note.md'), 'utf8'), 'saved\n')
})

test('parent repositories, path traversal and nested repositories are blocked', async t => {
  const { root, service } = await library(t)
  const child = path.join(root, 'child')
  await mkdir(child)
  const nested = new GitService(child)
  assert.match((await nested.status()).blocked!, /根目录/)
  await assert.rejects(nested.init(identity), /根目录/)
  assert.match((await service.commit(['../escape.md'], 'Bad path')).error!, /文档库/)
  assert.match((await service.commit(['.git/config'], 'Bad path')).error!, /元数据/)
  await git(child, 'init')
  await writeFile(path.join(child, 'inside.md'), 'nested')
  assert.match((await service.commit(['child/inside.md'], 'Nested')).error!, /嵌套/)
})

test('initialization refuses an existing unborn staged index', async t => {
  const root = await temp(t)
  await git(root, 'init', '--initial-branch=main')
  await writeFile(path.join(root, 'note.md'), 'staged')
  await git(root, 'add', 'note.md')
  const service = new GitService(root)
  await assert.rejects(service.init(identity), /暂存/)
  assert.equal(await git(root, 'show', ':note.md'), 'staged')
})

test('history includes versions and follows renamed Chinese paths with spaces', async t => {
  const { root, service } = await library(t, { '中文 文件.md': 'first\n' })
  const first = (await service.history('中文 文件.md'))[0]
  await writeFile(path.join(root, '中文 文件.md'), 'second\n')
  assert.equal((await service.commit(['中文 文件.md'], 'Second')).committed, true)
  await rename(path.join(root, '中文 文件.md'), path.join(root, '新 名称.md'))
  assert.equal((await service.commit(['中文 文件.md', '新 名称.md'], 'Rename')).committed, true)
  const history = await service.history('新 名称.md')
  assert.equal(history.length, 3)
  assert.equal(history[0].subject, 'Rename')
  assert.equal(await service.version('新 名称.md', first.oid), 'first\n')
  await assert.rejects(service.version('新 名称.md', '--bad-option'), /版本标识/)
})

test('Windows case-only file rename saves one actual spelling and preserves unrelated staging', { skip: process.platform !== 'win32' }, async t => {
  const { root, service } = await library(t, { 'A.md': 'original\n', 'other.md': 'original other\n' })
  const first = (await service.history('A.md'))[0]
  await writeFile(path.join(root, 'other.md'), 'staged other\n')
  await git(root, 'add', 'other.md')
  await writeFile(path.join(root, 'other.md'), 'unstaged other\n')
  await rename(path.join(root, 'A.md'), path.join(root, 'temporary.md'))
  await rename(path.join(root, 'temporary.md'), path.join(root, 'a.md'))
  const state = await service.status()
  assert.ok(state.changes.includes('A.md'))
  assert.ok(state.changes.includes('a.md'))
  const result = await service.commit(['a.md'], 'Case rename', { 'a.md': 'original\n' })
  assert.equal(result.error, undefined)
  assert.equal(result.committed, true)
  assert.equal(await git(root, 'ls-tree', '--name-only', 'HEAD'), 'a.md\nother.md')
  assert.equal(await git(root, 'ls-files'), 'a.md\nother.md')
  assert.equal(await git(root, 'show', ':other.md'), 'staged other')
  assert.equal(await readFile(path.join(root, 'other.md'), 'utf8'), 'unstaged other\n')
  assert.equal(await service.version('a.md', first.oid), 'original\n')
  assert.equal((await service.history('a.md')).length, 2)
  assert.deepEqual((await service.status()).changes, ['other.md'])
})

test('Windows case-only directory rename records requested file without duplicating old tree paths', { skip: process.platform !== 'win32' }, async t => {
  const { root, service } = await library(t, { 'Folder/Note.md': 'original\n' })
  const first = (await service.history('Folder/Note.md'))[0]
  await rename(path.join(root, 'Folder'), path.join(root, 'temporary'))
  await rename(path.join(root, 'temporary'), path.join(root, 'folder'))
  assert.deepEqual((await service.status()).changes.sort(), ['Folder/Note.md', 'folder/Note.md'])
  const result = await service.commit(['folder/Note.md'], 'Folder case rename')
  assert.equal(result.error, undefined)
  assert.equal(await git(root, 'ls-tree', '-r', '--name-only', 'HEAD'), 'folder/Note.md')
  assert.equal(await git(root, 'ls-files'), 'folder/Note.md')
  assert.equal(await service.version('folder/Note.md', first.oid), 'original\n')
  assert.deepEqual((await service.status()).changes, [])
})

test('Windows case-only rename refuses staged changes under the previous spelling', { skip: process.platform !== 'win32' }, async t => {
  const { root, service } = await library(t, { 'A.md': 'original\n' })
  await writeFile(path.join(root, 'A.md'), 'staged\n')
  await git(root, 'add', 'A.md')
  await rename(path.join(root, 'A.md'), path.join(root, 'temporary.md'))
  await rename(path.join(root, 'temporary.md'), path.join(root, 'a.md'))
  const result = await service.commit(['a.md'], 'Must reject')
  assert.equal(result.committed, false)
  assert.match(result.error!, /暂存/)
  assert.equal(await git(root, 'show', ':A.md'), 'staged')
  assert.equal(await git(root, 'ls-tree', '--name-only', 'HEAD'), 'A.md')
})

test('explicit attachments are included, other new files stay untracked, deletion can be recorded', async t => {
  const { root, service } = await library(t)
  await writeFile(path.join(root, 'note.md'), '![asset](asset.bin)\n')
  const binary = Buffer.from([0, 1, 255, 3])
  await writeFile(path.join(root, 'asset.bin'), binary)
  await writeFile(path.join(root, 'other.md'), 'other')
  assert.equal((await service.commit(['note.md', 'asset.bin'], 'Attach')).committed, true)
  assert.equal(await git(root, 'ls-tree', '--name-only', 'HEAD'), 'asset.bin\nnote.md')
  await rm(path.join(root, 'asset.bin'))
  assert.equal((await service.commit(['asset.bin'], 'Delete asset')).committed, true)
  assert.equal(await git(root, 'ls-tree', '--name-only', 'HEAD'), 'note.md')
})

test('per-repository queue serializes different service instances', async t => {
  const { root, service } = await library(t)
  const other = new GitService(root)
  await writeFile(path.join(root, 'a.md'), 'A')
  await writeFile(path.join(root, 'b.md'), 'B')
  const results = await Promise.all([service.commit(['a.md'], 'A'), other.commit(['b.md'], 'B')])
  assert.equal(results.every(result => result.committed && !result.error), true)
  assert.equal(await git(root, 'rev-list', '--count', 'HEAD'), '3')
})

test('GitHub configuration validates URLs and never accepts embedded credentials', async t => {
  const { service, root } = await library(t)
  await assert.rejects(service.configure('https://token@github.com/owner/repo.git', 'main', identity), /令牌/)
  await assert.rejects(service.configure('ext::arbitrary-command', 'main', identity), /GitHub/)
  await assert.rejects(service.configure('https://github.com/owner/repo.git', '../bad', identity))
  assert.equal((await service.configure('https://github.com/owner/repo.git', 'main', identity)).remote, 'https://github.com/owner/repo.git')
  assert.equal((await service.configure('git@github.com:owner/repo.git', 'main', identity)).remote, 'git@github.com:owner/repo.git')
  await git(root, 'config', '--add', 'remote.origin.pushurl', 'git@github.com:old/wrong.git')
  await service.configure('https://github.com/owner/new.git', 'main', identity)
  assert.equal(await git(root, 'remote', 'get-url', '--push', '--all', 'origin'), 'https://github.com/owner/new.git')
})

test('inherited Git repository and config environment cannot redirect writes outside the library', async t => {
  const { root, service } = await library(t)
  const outside = await temp(t)
  await git(outside, 'init', '--initial-branch=main')
  await writeFile(path.join(root, 'note.md'), 'in library\n')
  const poison = { GIT_DIR: path.join(outside, '.git'), GIT_WORK_TREE: outside, GIT_INDEX_FILE: path.join(outside, 'index'), GIT_CONFIG_PARAMETERS: `'core.worktree=${outside.replaceAll('\\', '/')}'`, GIT_NAMESPACE: 'unrelated' }
  const previous = Object.fromEntries(Object.keys(poison).map(key => [key, process.env[key]]))
  try {
    Object.assign(process.env, poison)
    assert.equal((await service.commit(['note.md'], 'Local scope')).committed, true)
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
  assert.equal(await git(root, 'show', 'HEAD:note.md'), 'in library')
  await assert.rejects(git(outside, 'rev-parse', '--verify', 'HEAD'))
  await assert.rejects(readFile(path.join(outside, 'index')), { code: 'ENOENT' })
})

test('two clones round-trip additions, changes, binary attachments and deletions', async t => {
  const { a, b, first, second } = await clones(t)
  await writeFile(path.join(a, 'new.md'), 'new\n')
  await writeFile(path.join(a, 'attachment.bin'), Buffer.from([0, 255, 10]))
  await first.commit(['new.md', 'attachment.bin'], 'Add document and attachment')
  const uploaded = await first.sync()
  assert.equal(uploaded.ahead, 0)
  assert.ok(uploaded.lastSync)
  await second.sync()
  assert.equal(await readFile(path.join(b, 'new.md'), 'utf8'), 'new\n')
  assert.deepEqual(await readFile(path.join(b, 'attachment.bin')), Buffer.from([0, 255, 10]))
  await writeFile(path.join(b, 'new.md'), 'edited on second\n')
  await rm(path.join(b, 'attachment.bin'))
  await second.commit(['new.md', 'attachment.bin'], 'Edit and delete')
  await second.sync(); await first.sync()
  assert.equal(await readFile(path.join(a, 'new.md'), 'utf8'), 'edited on second\n')
  await assert.rejects(readFile(path.join(a, 'attachment.bin')), { code: 'ENOENT' })
})

test('divergent text edits conflict, resolution finishes a merge without force push', async t => {
  const { a, b, first, second } = await clones(t)
  await writeFile(path.join(a, 'note.md'), 'from first\n')
  await writeFile(path.join(b, 'note.md'), 'from second\n')
  await first.commit(['note.md'], 'First edit'); await second.commit(['note.md'], 'Second edit')
  await first.sync()
  const conflict = await second.sync()
  assert.deepEqual(conflict.conflicts, ['note.md'])
  assert.match((await second.commit(['note.md'], 'Blocked during merge')).error!, /合并/)
  await assert.rejects(second.finishMerge(), /全部冲突/)
  assert.deepEqual((await second.resolveConflict('note.md', 'ours')).conflicts, [])
  await second.finishMerge(); await second.sync(); await first.sync()
  assert.equal(await readFile(path.join(a, 'note.md'), 'utf8'), 'from second\n')
  assert.equal((await git(b, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').length, 3)
})

test('delete/modify conflict supports choosing the deleted side and binary conflicts support theirs', async t => {
  const { a, b, first, second } = await clones(t)
  await writeFile(path.join(a, 'asset.bin'), Buffer.from([0, 1]))
  await first.commit(['asset.bin'], 'Add binary'); await first.sync(); await second.sync()
  await rm(path.join(a, 'note.md'))
  await writeFile(path.join(a, 'asset.bin'), Buffer.from([0, 2]))
  await first.commit(['note.md', 'asset.bin'], 'Delete and binary first')
  await writeFile(path.join(b, 'note.md'), 'modified second\n')
  await writeFile(path.join(b, 'asset.bin'), Buffer.from([0, 3]))
  await second.commit(['note.md', 'asset.bin'], 'Modify and binary second')
  await first.sync()
  assert.deepEqual((await second.sync()).conflicts.sort(), ['asset.bin', 'note.md'])
  await second.resolveConflict('note.md', 'theirs')
  await second.resolveConflict('asset.bin', 'theirs')
  await second.finishMerge(); await second.sync()
  await assert.rejects(readFile(path.join(b, 'note.md')), { code: 'ENOENT' })
  assert.deepEqual(await readFile(path.join(b, 'asset.bin')), Buffer.from([0, 2]))
})

test('abort restores pre-merge local version and dirty worktrees prevent synchronization', async t => {
  const { a, b, first, second } = await clones(t)
  await writeFile(path.join(b, 'untracked.md'), 'draft')
  await assert.rejects(second.sync(), /未跟踪/)
  await rm(path.join(b, 'untracked.md'))
  await writeFile(path.join(a, 'note.md'), 'first\n'); await first.commit(['note.md'], 'First')
  await writeFile(path.join(b, 'note.md'), 'second\n'); await second.commit(['note.md'], 'Second')
  await first.sync(); await second.sync()
  const aborted = await second.abortMerge()
  assert.deepEqual(aborted.conflicts, [])
  assert.equal(await readFile(path.join(b, 'note.md'), 'utf8'), 'second\n')
  assert.deepEqual(aborted.changes, [])
})

test('failed remote synchronization leaves local save and commit available', async t => {
  const { root, service } = await library(t)
  await git(root, 'remote', 'add', 'origin', path.join(root, 'missing.git'))
  await assert.rejects(service.sync())
  assert.equal((await service.status()).lastSync, null)
  await writeFile(path.join(root, 'note.md'), 'offline saved\n')
  assert.equal((await service.commit(['note.md'], 'Offline')).committed, true)
  assert.equal(await service.baseline('note.md'), 'offline saved\n')
})

test('sync does not autostash edits made during fetch even when repository config enables it', async t => {
  const { a, b, first, second } = await clones(t)
  await writeFile(path.join(a, 'note.md'), 'remote update\n')
  await first.commit(['note.md'], 'Remote update'); await first.sync()
  await git(b, 'config', 'merge.autoStash', 'true')
  const internal = second as unknown as { run: (args: string[], options?: unknown) => Promise<Buffer> }
  const run = internal.run.bind(second)
  internal.run = async (args, options) => {
    const result = await run(args, options)
    if (args[0] === 'fetch') await writeFile(path.join(b, 'note.md'), 'local edit during fetch\n')
    return result
  }
  await assert.rejects(second.sync(), /本地修改/)
  assert.equal(await readFile(path.join(b, 'note.md'), 'utf8'), 'local edit during fetch\n')
  assert.equal(await git(b, 'stash', 'list'), '')
  assert.equal(await git(b, 'show', 'HEAD:note.md'), 'baseline')
  await writeFile(path.join(b, 'note.md'), 'baseline\n')
  internal.run = async (args, options) => {
    const result = await run(args, options)
    if (args[0] === 'fetch') await git(b, 'switch', '-c', 'other')
    return result
  }
  await assert.rejects(second.sync(), /分支/)
  assert.equal(await git(b, 'show', 'refs/heads/main:note.md'), 'baseline')
  assert.equal(await git(b, 'branch', '--show-current'), 'other')
})

test('sync ignores branch merge strategy options and remote mirror configuration', async t => {
  const { a, b, first, second } = await clones(t)
  await writeFile(path.join(a, 'first.md'), 'from first\n')
  await first.commit(['first.md'], 'First')
  await writeFile(path.join(b, 'second.md'), 'from second\n')
  await second.commit(['second.md'], 'Second')
  await first.sync()
  await git(b, 'config', 'branch.main.mergeOptions', '--strategy=ours')
  await git(b, 'config', 'remote.origin.mirror', 'true')
  await git(b, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*')
  await git(b, 'config', 'fetch.pruneTags', 'true')
  await git(b, 'tag', 'local-only')
  await second.sync(); await first.sync()
  assert.equal(await readFile(path.join(b, 'first.md'), 'utf8'), 'from first\n')
  assert.equal(await readFile(path.join(a, 'second.md'), 'utf8'), 'from second\n')
  assert.equal(await git(b, 'tag', '--list'), 'local-only')
})
