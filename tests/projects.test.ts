import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { FileService, getSettings, putSettings } from '../src/main/files'
import { authorizedProject, preserveProjectAuthorization, projectForFile, rememberProject } from '../src/main/projects'
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
