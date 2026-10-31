import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { FileService, getSettings, putSettings } from '../src/main/files'
import { authorizedProject, createProjectDirectory, forgetProject, preserveProjectAuthorization, projectDirectoryPath, projectForFile, relocateProjectSettings, rememberProject, setProjectSyncMode } from '../src/main/projects'
import { UntitledService } from '../src/main/untitled'
import { defaultSettings, type UntitledDraft } from '../src/shared/types'

async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'oopsmd-projects-'))
  const root = path.join(temporary, 'project')
  const userData = path.join(temporary, 'profile')
  await fs.mkdir(root); await fs.mkdir(userData)
  return { root, userData, temporary, cleanup: () => fs.rm(temporary, { recursive: true, force: true }) }
}

test('old settings migrate recent roots into authorized projects without inventing history dates', async () => {
  const f = await fixture()
  try {
    const { projects: _projects, lastProject: _lastProject, ...old } = defaultSettings
    const other = path.join(f.temporary, 'other')
    await fs.writeFile(path.join(f.userData, 'settings.json'), JSON.stringify({ ...old, recent: [{ root: f.root, path: 'one.md' }, { root: other, path: 'two.md' }, { root: f.root, path: 'three.md' }] }))
    const settings = await getSettings(f.userData)
    assert.deepEqual(settings.projects, [{ root: f.root, lastOpened: '1970-01-01T00:00:00.000Z' }, { root: other, lastOpened: '1970-01-01T00:00:00.000Z' }])
    assert.equal(settings.lastProject, f.root)
    assert.equal(authorizedProject(settings, f.root), f.root)
    assert.throws(() => authorizedProject(settings, path.join(f.temporary, 'unknown')), /尚未授权/)
    await putSettings(f.userData, settings)
    assert.deepEqual((await getSettings(f.userData)).projects, settings.projects)
  } finally { await f.cleanup() }
})

test('project timestamps and last-project selection persist; renderer settings cannot grant new roots', async () => {
  const f = await fixture()
  try {
    const now = '2026-10-23T01:00:00.000Z'
    const settings = rememberProject(defaultSettings, f.root, now)
    await putSettings(f.userData, settings)
    assert.equal((await getSettings(f.userData)).lastProject, f.root)
    const injected = rememberProject({ ...settings, theme: 'dark' }, path.join(f.temporary, 'unauthorized'), now)
    injected.recent = [{ root: injected.lastProject!, path: 'secret.md' }]
    const protectedSettings = preserveProjectAuthorization(injected, settings)
    assert.deepEqual(protectedSettings.projects, settings.projects)
    assert.deepEqual(protectedSettings.recent, settings.recent)
    assert.equal(protectedSettings.lastProject, settings.lastProject)
    assert.equal(protectedSettings.theme, 'dark')
    await assert.rejects(putSettings(f.userData, { ...settings, lastProject: path.join(f.temporary, 'unknown') }), /不在已授权/)
    await assert.rejects(putSettings(f.userData, { ...settings, projects: [{ root: f.root, lastOpened: 'not a date' }] }), /时间无效/)
  } finally { await f.cleanup() }
})

test('first-save project selection respects preferred/current roots and the deepest remembered parent', async () => {
  const f = await fixture()
  try {
    const nested = path.join(f.root, 'nested')
    const file = path.join(nested, 'new.md')
    const settings = rememberProject(rememberProject(defaultSettings, f.root), nested)
    assert.equal(projectForFile(settings, file, f.root), f.root)
    assert.equal(projectForFile(settings, file, undefined, f.root), f.root)
    assert.equal(projectForFile(settings, file), nested)
    assert.equal(projectForFile(settings, path.join(f.temporary, 'elsewhere', 'new.md')), path.join(f.temporary, 'elsewhere'))
    assert.throws(() => projectForFile(settings, file, path.join(f.temporary, 'unauthorized')), /尚未授权/)
  } finally { await f.cleanup() }
})

test('untitled recovery persists independently of any project and rejects path-shaped IDs', async () => {
  const f = await fixture()
  try {
    const service = new UntitledService(f.userData)
    assert.deepEqual(await service.list(), [])
    const draft: UntitledDraft = { id: randomUUID(), content: '\\frac{一}{二}', mode: 'latex-math', updatedAt: new Date().toISOString() }
    await service.put(draft)
    assert.deepEqual(await new UntitledService(f.userData).list(), [draft])
    assert.equal(await fs.readFile(path.join(f.userData, 'untitled', `${draft.id}.json`), 'utf8'), JSON.stringify(draft))
    await assert.rejects(service.put({ ...draft, id: '../escape' }), /格式无效/)
    await assert.rejects(service.delete('../escape'), /标识无效/)
    await assert.rejects(service.put({ ...draft, mode: 'html' as UntitledDraft['mode'] }), /格式无效/)
    assert.deepEqual(await fs.readdir(f.root), [])
    await service.delete(draft.id)
    assert.deepEqual(await service.list(), [])
  } finally { await f.cleanup() }
})

test('first save publishes a complete new file, never replaces an existing name, and retains scratch until caller deletes it', async () => {
  const f = await fixture()
  try {
    const files = new FileService(f.root, f.userData)
    const untitled = new UntitledService(f.userData)
    const draft: UntitledDraft = { id: randomUUID(), content: 'first\r\n完整快照', mode: 'markdown', updatedAt: new Date().toISOString() }
    await untitled.put(draft)
    const saved = await files.createDocument('新 文档.md', draft.content)
    assert.equal(saved.content, 'first\n完整快照')
    assert.equal(await fs.readFile(path.join(f.root, saved.path), 'utf8'), saved.content)
    assert.equal((await files.read(saved.path)).revision, saved.revision)
    assert.deepEqual(await untitled.list(), [draft])
    await assert.rejects(files.createDocument(saved.path, 'overwrite'), /已存在.*未覆盖/)
    assert.equal(await fs.readFile(path.join(f.root, saved.path), 'utf8'), saved.content)
    assert.deepEqual(await fs.readdir(f.root), [saved.path])
    await assert.rejects(files.createDocument('missing/new.md', draft.content), { code: 'ENOENT' })
    assert.deepEqual(await untitled.list(), [draft])
  } finally { await f.cleanup() }
})

test('unsupported filesystem publication fails clearly, removes only its temporary file, and preserves scratch', async context => {
  const f = await fixture()
  try {
    const draft: UntitledDraft = { id: randomUUID(), content: 'keep this content', mode: 'markdown', updatedAt: new Date().toISOString() }
    const scratch = new UntitledService(f.userData)
    await scratch.put(draft)
    context.mock.method(fs, 'link', async () => { throw Object.assign(new Error('not supported'), { code: 'ENOTSUP' }) })
    await assert.rejects(new FileService(f.root, f.userData).createDocument('new.md', draft.content), /不支持安全.*草稿仍已保留/)
    assert.deepEqual(await fs.readdir(f.root), [])
    assert.deepEqual(await scratch.list(), [draft])
  } finally { context.mock.restoreAll(); await f.cleanup() }
})

test('first save returns its captured snapshot even if another program changes the file immediately after publication', async context => {
  const f = await fixture()
  try {
    const link = fs.link.bind(fs)
    context.mock.method(fs, 'link', async (source: Parameters<typeof fs.link>[0], destination: Parameters<typeof fs.link>[1]) => {
      await link(source, destination)
      await fs.writeFile(destination, 'external edit')
    })
    const files = new FileService(f.root, f.userData)
    const saved = await files.createDocument('new.md', 'requested snapshot')
    assert.equal(saved.content, 'requested snapshot')
    assert.equal(saved.revision, createHash('sha256').update('requested snapshot').digest('hex'))
    assert.equal((await files.read('new.md')).content, 'external edit')
    assert.notEqual((await files.read('new.md')).revision, saved.revision)
    await assert.rejects(files.write('new.md', 'next edit', saved.revision), /外部程序修改/)
  } finally { context.mock.restoreAll(); await f.cleanup() }
})

test('temporary-link cleanup failure does not disguise a successful first save as an unsaved file', async context => {
  const f = await fixture()
  try {
    context.mock.method(fs, 'rm', async () => { throw Object.assign(new Error('cleanup blocked'), { code: 'EPERM' }) })
    const saved = await new FileService(f.root, f.userData).createDocument('new.md', 'saved content')
    assert.equal(await fs.readFile(path.join(f.root, saved.path), 'utf8'), 'saved content')
    assert.equal(saved.content, 'saved content')
    assert.equal((await fs.readdir(f.root)).filter(name => name.startsWith('.oopsmd-')).length, 1)
  } finally { context.mock.restoreAll(); await f.cleanup() }
})

const hash = (value: string) => createHash('sha256').update(process.platform === 'win32' ? value.toLowerCase() : value).digest('hex')
const storagePaths = (userData: string, root: string) => ({
  drafts: path.join(userData, 'drafts', hash(path.resolve(root))),
  archive: path.join(userData, 'archive', hash(path.resolve(root)) + '.json'),
})

test('project metadata survives settings round-trips and reopening; changing sync mode preserves origin', async () => {
  const f = await fixture()
  try {
    let settings = rememberProject(defaultSettings, f.root)
    settings.projects[0] = { ...settings.projects[0], syncMode: 'git', remote: 'https://github.com/owner/repo.git' }
    settings = await putSettings(f.userData, settings)
    assert.deepEqual((await getSettings(f.userData)).projects, settings.projects)
    const reopened = rememberProject(settings, f.root, '2026-10-29T00:00:00.000Z')
    assert.deepEqual(reopened.projects[0], { ...settings.projects[0], lastOpened: '2026-10-29T00:00:00.000Z' })
    const external = setProjectSyncMode(reopened, f.root, 'external')
    assert.equal(external.projects[0].syncMode, 'external')
    const local = setProjectSyncMode(external, f.root, 'local')
    assert.equal(Object.hasOwn(local.projects[0], 'syncMode'), false)
    assert.equal(local.projects[0].remote, settings.projects[0].remote)
    assert.equal(settings.projects[0].syncMode, 'git')
    for (const metadata of [{ syncMode: 'invalid' }, { remote: '' }, { remote: 'url\nsecret' }, { remote: 42 }]) {
      await assert.rejects(putSettings(f.userData, { ...settings, projects: [{ ...settings.projects[0], ...metadata }] } as never), /无效/)
    }
    assert.throws(() => setProjectSyncMode(settings, f.root, 'invalid' as never), /同步方式无效/)
    assert.throws(() => setProjectSyncMode(settings, path.join(f.temporary, 'unknown'), 'git'), /尚未授权/)
  } finally { await f.cleanup() }
})

test('forgetting a project removes only registration and recent links, preserving files, drafts, archives and positions', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, 'note.md'), 'disk')
    const files = new FileService(f.root, f.userData), file = await files.read('note.md')
    await files.draft({ path: file.path, content: 'unsaved', revision: file.revision, updatedAt: new Date().toISOString() })
    const archive = await files.archive(file.path)
    const settings = { ...rememberProject(defaultSettings, f.root), recent: [{ root: f.root, path: file.path }], positions: { [`${f.root}/${file.path}`]: { cursor: 3, scroll: 9 } } }
    const forgotten = forgetProject(settings, f.root)
    await putSettings(f.userData, forgotten)
    assert.deepEqual(forgotten.projects, [])
    assert.deepEqual(forgotten.recent, [])
    assert.equal(forgotten.lastProject, null)
    assert.deepEqual(forgotten.positions, settings.positions)
    assert.equal(await fs.readFile(path.join(f.root, file.path), 'utf8'), 'disk')
    assert.equal((await files.getDraft(file.path))?.content, 'unsaved')
    assert.deepEqual(await files.listArchive(), archive)
    assert.equal(settings.projects.length, 1)
  } finally { await f.cleanup() }
})

test('relocating settings updates exact root references and preserves metadata, rejecting registered targets and position conflicts', async () => {
  const f = await fixture()
  try {
    const target = path.join(f.temporary, 'moved'), other = f.root + '-other'
    const settings = rememberProject(defaultSettings, f.root)
    settings.projects[0] = { ...settings.projects[0], syncMode: 'external', remote: 'https://example.com/source' }
    settings.recent = [{ root: f.root, path: 'a.md' }, { root: other, path: 'b.md' }]
    settings.positions = { [`${f.root}/a.md`]: { cursor: 2, scroll: 5, previewScroll: 17 }, [`${other}/b.md`]: { cursor: 1, scroll: 3 } }
    const next = relocateProjectSettings(settings, f.root, target)
    assert.deepEqual(next.projects, [{ ...settings.projects[0], root: target }])
    assert.equal(next.lastProject, target)
    assert.deepEqual(next.recent, [{ root: target, path: 'a.md' }, settings.recent[1]])
    assert.deepEqual(next.positions[`${target}/a.md`], settings.positions[`${f.root}/a.md`])
    assert.deepEqual(next.positions[`${other}/b.md`], settings.positions[`${other}/b.md`])
    assert.equal(next.positions[`${f.root}/a.md`], undefined)
    assert.throws(() => relocateProjectSettings(rememberProject(settings, target), f.root, target), /另一个项目/)
    assert.throws(() => relocateProjectSettings({ ...settings, positions: { ...settings.positions, [`${target}/a.md`]: { cursor: 99, scroll: 0 } } }, f.root, target), /不同阅读位置/)
    assert.throws(() => relocateProjectSettings(settings, f.root, '../escape'), /路径无效/)
    assert.equal(settings.projects[0].root, f.root)
    assert.ok(settings.positions[`${f.root}/a.md`])
  } finally { await f.cleanup() }
})

test('new project creation accepts one safe folder name and never overwrites existing targets or creates missing parents', async () => {
  const f = await fixture()
  try {
    const target = projectDirectoryPath(f.root, '中文 项目')
    await assert.rejects(fs.stat(target), { code: 'ENOENT' })
    assert.equal(await createProjectDirectory(f.root, '中文 项目'), target)
    assert.deepEqual(await fs.readdir(target), [])
    await assert.rejects(createProjectDirectory(f.root, '中文 项目'), /已存在.*未覆盖/)
    await fs.writeFile(path.join(f.root, 'existing'), 'keep')
    await assert.rejects(createProjectDirectory(f.root, 'existing'), /已存在.*未覆盖/)
    for (const name of ['', '.', '..', '../outside', 'a/b', 'a\\b', '.git', '.GIT', 'CON', 'aux.txt', 'bad:', 'trailing.', ' space', 'space ', 'bad\0']) {
      assert.throws(() => projectDirectoryPath(f.root, name), /单个文件夹/)
      await assert.rejects(createProjectDirectory(f.root, name), /单个文件夹/)
    }
    assert.throws(() => projectDirectoryPath('relative', 'safe'), /路径无效/)
    await assert.rejects(createProjectDirectory(path.join(f.root, 'absent'), 'nested'), { code: 'ENOENT' })
    assert.equal(await fs.readFile(path.join(f.root, 'existing'), 'utf8'), 'keep')
    await assert.rejects(fs.stat(path.join(target, '.git')), { code: 'ENOENT' })
  } finally { await f.cleanup() }
})

test('relocation copies BOM/EOL recovery drafts and archives from a missing old root, preserving original backups and allowing retries', async () => {
  const f = await fixture()
  try {
    await fs.mkdir(path.join(f.root, 'notes'))
    await fs.writeFile(path.join(f.root, 'notes', '一.md'), Buffer.from('\ufeffdisk\r\ntext'))
    const source = new FileService(f.root, f.userData), file = await source.read('notes/一.md')
    await source.draft({ path: file.path, content: 'new\ntext', revision: file.revision, updatedAt: new Date().toISOString() })
    const entries = await source.archive('notes')
    const original = storagePaths(f.userData, f.root), draftName = hash(file.path) + '.json'
    const draftBytes = await fs.readFile(path.join(original.drafts, draftName)), archiveBytes = await fs.readFile(original.archive)
    const target = path.join(f.temporary, 'relocated')
    await fs.rename(f.root, target)
    await source.migrateProjectData(target)
    await source.migrateProjectData(target)
    const destination = new FileService(target, f.userData), copied = storagePaths(f.userData, target)
    assert.equal((await destination.getDraft(file.path))?.content, 'new\ntext')
    assert.deepEqual(await destination.listArchive(), entries)
    assert.deepEqual(await fs.readFile(path.join(copied.drafts, draftName)), draftBytes)
    assert.deepEqual(await fs.readFile(copied.archive), archiveBytes)
    assert.deepEqual(await fs.readFile(path.join(original.drafts, draftName)), draftBytes)
    assert.deepEqual(await fs.readFile(original.archive), archiveBytes)
    assert.equal(JSON.parse(draftBytes.toString()).eol, '\r\n')
    assert.equal(JSON.parse(draftBytes.toString()).bom, true)
    assert.equal(await fs.readFile(path.join(target, 'notes', '一.md'), 'utf8'), '\ufeffdisk\r\ntext')
  } finally { await f.cleanup() }
})

test('relocation preflights all recovery collisions before copying and never overwrites target or source records', async () => {
  const f = await fixture()
  try {
    const target = path.join(f.temporary, 'target'); await fs.mkdir(target)
    const source = new FileService(f.root, f.userData), destination = new FileService(target, f.userData)
    const updatedAt = new Date().toISOString()
    await source.draft({ path: 'a.md', content: 'source a', revision: 'baseline', updatedAt })
    await source.draft({ path: 'b.md', content: 'source b', revision: 'baseline', updatedAt })
    await destination.draft({ path: 'b.md', content: 'target b', revision: 'other', updatedAt })
    await assert.rejects(source.migrateProjectData(target), /不同恢复记录.*未覆盖/)
    assert.equal(await destination.getDraft('a.md'), null)
    assert.equal((await destination.getDraft('b.md'))?.content, 'target b')
    assert.equal((await source.getDraft('a.md'))?.content, 'source a')
    assert.equal((await source.getDraft('b.md'))?.content, 'source b')
    await destination.clearDraft('b.md')
    await fs.writeFile(path.join(f.root, 'a.md'), 'a'); await fs.writeFile(path.join(target, 'b.md'), 'b')
    await source.archive('a.md'); await destination.archive('b.md')
    await assert.rejects(source.migrateProjectData(target), /不同恢复记录.*未覆盖/)
    assert.equal(await destination.getDraft('a.md'), null)
    assert.equal((await destination.listArchive())[0].path, 'b.md')
  } finally { await f.cleanup() }
})

test('publication failure preserves all original recovery data and leaves complete copies safe to retry', async context => {
  const f = await fixture()
  try {
    const target = path.join(f.temporary, 'target'); await fs.mkdir(target)
    const source = new FileService(f.root, f.userData), destination = new FileService(target, f.userData)
    for (const file of ['a.md', 'b.md']) await source.draft({ path: file, content: file, revision: 'baseline', updatedAt: new Date().toISOString() })
    const link = fs.link.bind(fs); let count = 0
    context.mock.method(fs, 'link', async (...args: Parameters<typeof fs.link>) => {
      if (++count === 2) throw Object.assign(new Error('blocked'), { code: 'EPERM' })
      return link(...args)
    })
    await assert.rejects(source.migrateProjectData(target), /旧记录完整保留/)
    for (const file of ['a.md', 'b.md']) assert.equal((await source.getDraft(file))?.content, file)
    assert.equal((await fs.readdir(storagePaths(f.userData, target).drafts)).filter(name => name.endsWith('.json')).length, 1)
    context.mock.restoreAll()
    await source.migrateProjectData(target)
    for (const file of ['a.md', 'b.md']) assert.equal((await destination.getDraft(file))?.content, file)
  } finally { context.mock.restoreAll(); await f.cleanup() }
})

test('relocation rejects draft or archive paths escaping through a target junction; pending archive movement recovers only at the new root', async () => {
  const f = await fixture()
  try {
    const target = path.join(f.temporary, 'target'), outside = path.join(f.temporary, 'outside')
    await fs.mkdir(target); await fs.mkdir(outside); await fs.mkdir(path.join(f.root, 'folder'))
    const source = new FileService(f.root, f.userData)
    await source.draft({ path: 'folder/a.md', content: 'recovery', revision: 'baseline', updatedAt: new Date().toISOString() })
    await fs.symlink(outside, path.join(target, 'folder'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(source.migrateProjectData(target), /之外/)
    await fs.unlink(path.join(target, 'folder'))
    const archive = storagePaths(f.userData, f.root).archive
    await fs.mkdir(path.dirname(archive), { recursive: true })
    await fs.writeFile(archive, JSON.stringify({ entries: [{ path: '../escape', archivedAt: new Date().toISOString() }] }))
    await assert.rejects(source.migrateProjectData(target), /路径无效/)
    const archivedAt = new Date().toISOString()
    const pending = { entries: [{ path: 'old.md', archivedAt }], pending: { kind: 'move', from: 'old.md', to: 'new.md', entries: [{ path: 'new.md', archivedAt }] } }
    await fs.writeFile(archive, JSON.stringify(pending))
    await fs.writeFile(path.join(target, 'new.md'), 'moved')
    await source.migrateProjectData(target)
    assert.deepEqual(await new FileService(target, f.userData).listArchive(), pending.pending.entries)
    assert.deepEqual(JSON.parse(await fs.readFile(archive, 'utf8')), pending)
    assert.equal((await source.getDraft('folder/a.md'))?.content, 'recovery')
  } finally { await f.cleanup() }
})

test('relocation refuses recovery-storage junctions pointing outside the device profile', async () => {
  const f = await fixture()
  try {
    const target = path.join(f.temporary, 'target'), outside = path.join(f.temporary, 'outside')
    await fs.mkdir(target); await fs.mkdir(outside)
    const source = new FileService(f.root, f.userData)
    await source.draft({ path: 'a.md', content: 'keep', revision: 'baseline', updatedAt: new Date().toISOString() })
    const destination = storagePaths(f.userData, target).drafts
    await fs.symlink(outside, destination, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(source.migrateProjectData(target), /设备数据目录之外/)
    assert.deepEqual(await fs.readdir(outside), [])
    assert.equal((await source.getDraft('a.md'))?.content, 'keep')
  } finally { await f.cleanup() }
})

test('an open buffer can persist its latest recovery after the project disappears, then relocate without losing later edits', async () => {
  const f = await fixture()
  try {
    const target = path.join(f.temporary, 'moved')
    await fs.writeFile(path.join(f.root, 'note.md'), 'disk baseline')
    const source = new FileService(f.root, f.userData), file = await source.read('note.md')
    await source.draft({ path: file.path, content: 'earlier edit', revision: file.revision, updatedAt: '2026-10-29T00:00:00.000Z' })
    await fs.rename(f.root, target)
    await source.draft({ path: file.path, content: 'latest edit after folder moved', revision: file.revision, updatedAt: '2026-10-29T01:00:00.000Z' })
    await assert.rejects(source.draft({ path: '../escape.md', content: 'invalid', revision: file.revision, updatedAt: new Date().toISOString() }), /路径无效/)
    await source.migrateProjectData(target)
    const recovered = await new FileService(target, f.userData).getDraft(file.path)
    assert.equal(recovered?.content, 'latest edit after folder moved')
    assert.equal(recovered?.revision, file.revision)
    assert.equal(await fs.readFile(path.join(target, file.path), 'utf8'), 'disk baseline')
    assert.equal(JSON.parse(await fs.readFile(path.join(storagePaths(f.userData, f.root).drafts, hash(file.path) + '.json'), 'utf8')).content, recovered?.content)
  } finally { await f.cleanup() }
})
