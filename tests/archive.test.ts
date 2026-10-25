import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { FileService, getSettings, putSettings } from '../src/main/files'
import { defaultSettings } from '../src/shared/types'

async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'oopsmd-archive-'))
  const root = path.join(temporary, 'project')
  const userData = path.join(temporary, 'profile')
  await fs.mkdir(root)
  const trash = async (target: string) => {
    const destination = path.join(temporary, 'trash')
    await fs.mkdir(destination, { recursive: true })
    await fs.rename(target, path.join(destination, path.basename(target)))
  }
  const key = process.platform === 'win32' ? root.toLowerCase() : root
  const metadata = path.join(userData, 'archive', `${createHash('sha256').update(key).digest('hex')}.json`)
  return { root, userData, temporary, metadata, trash, files: new FileService(root, userData, trash), cleanup: () => fs.rm(temporary, { recursive: true, force: true }) }
}

test('logical archive persists per project without changing the file, directory tree or links', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, '中文 note.md'), '\uFEFForiginal\r\n')
    await fs.writeFile(path.join(f.root, 'index.md'), '[note](<中文 note.md>)')
    const original = await fs.readFile(path.join(f.root, '中文 note.md'))
    const tree = await f.files.tree()
    assert.deepEqual(await f.files.listArchive(), [])
    const entries = await f.files.archive('中文 note.md')
    assert.equal(entries.length, 1)
    assert.equal(entries[0].path, '中文 note.md')
    assert.ok(Number.isFinite(Date.parse(entries[0].archivedAt)))
    assert.deepEqual(await new FileService(f.root, f.userData).listArchive(), entries)
    assert.deepEqual(await f.files.archive('中文 note.md'), entries)
    assert.deepEqual(await f.files.tree(), tree)
    assert.deepEqual(await fs.readFile(path.join(f.root, '中文 note.md')), original)
    assert.equal(await fs.readFile(path.join(f.root, 'index.md'), 'utf8'), '[note](<中文 note.md>)')
    const other = path.join(f.temporary, 'other')
    await fs.mkdir(other)
    assert.deepEqual(await new FileService(other, f.userData).listArchive(), [])
    assert.deepEqual(await f.files.unarchive('中文 note.md'), [])
    assert.deepEqual(await f.files.tree(), tree)
  } finally { await f.cleanup() }
})

test('folder archive covers its subtree and moving a child outside retains its archive timestamp', async () => {
  const f = await fixture()
  try {
    await fs.mkdir(path.join(f.root, 'folder'))
    await fs.writeFile(path.join(f.root, 'folder/one.md'), 'one')
    await fs.writeFile(path.join(f.root, 'folder/two.md'), 'two')
    await f.files.archive('folder/one.md')
    const entries = await f.files.archive('folder')
    assert.deepEqual(entries.map(entry => entry.path), ['folder'])
    assert.deepEqual(await f.files.archive('folder/two.md'), entries)
    await assert.rejects(f.files.unarchive('folder/one.md'), /先恢复该文件夹/)
    await f.files.move('folder/one.md', 'outside.md')
    assert.deepEqual((await f.files.listArchive()).map(entry => entry.path), ['folder', 'outside.md'])
    assert.ok((await f.files.listArchive()).every(entry => entry.archivedAt === entries[0].archivedAt))
    await f.files.move('folder', 'FOLDER')
    assert.deepEqual((await f.files.listArchive()).map(entry => entry.path), ['FOLDER', 'outside.md'])
    assert.deepEqual((await f.files.unarchive('FOLDER')).map(entry => entry.path), ['outside.md'])
    assert.equal(await fs.readFile(path.join(f.root, 'FOLDER/two.md'), 'utf8'), 'two')
  } finally { await f.cleanup() }
})

test('archive paths reject traversal, Git internals, missing targets and symlink escapes', async () => {
  const f = await fixture()
  try {
    const outside = path.join(f.temporary, 'outside')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'secret.md'), 'private')
    await fs.symlink(outside, path.join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const target of ['', '../outside/secret.md', '.git/config', 'escape/secret.md', path.join(outside, 'secret.md')]) {
      await assert.rejects(f.files.archive(target))
      await assert.rejects(f.files.unarchive(target))
    }
    await assert.rejects(f.files.archive('missing.md'), { code: 'ENOENT' })
    assert.deepEqual(await f.files.listArchive(), [])
    assert.equal(await fs.readFile(path.join(outside, 'secret.md'), 'utf8'), 'private')
    await fs.mkdir(path.dirname(f.metadata), { recursive: true })
    await fs.writeFile(f.metadata, JSON.stringify({ entries: [{ path: 'escape/secret.md', archivedAt: new Date().toISOString() }] }))
    await assert.rejects(f.files.listArchive(), /之外/)
  } finally { await f.cleanup() }
})

test('directory rename follows nested archive markers and deletion removes only affected records', async () => {
  const f = await fixture()
  try {
    await fs.mkdir(path.join(f.root, 'old/nested'), { recursive: true })
    await fs.writeFile(path.join(f.root, 'old/nested/note.md'), 'note')
    await fs.writeFile(path.join(f.root, 'keep.md'), 'keep')
    const marked = await f.files.archive('old/nested/note.md')
    await f.files.archive('keep.md')
    await f.files.move('old', 'new')
    const entries = await new FileService(f.root, f.userData).listArchive()
    assert.equal(entries.find(entry => entry.path === 'new/nested/note.md')?.archivedAt, marked[0].archivedAt)
    await f.files.remove('new')
    assert.deepEqual((await f.files.listArchive()).map(entry => entry.path), ['keep.md'])
    assert.equal(await fs.readFile(path.join(f.temporary, 'trash/new/nested/note.md'), 'utf8'), 'note')
  } finally { await f.cleanup() }
})

test('metadata preparation failure prevents disk mutation; failed trash preserves the original archive', async context => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, 'note.md'), 'note')
    const entries = await f.files.archive('note.md')
    const rename = fs.rename.bind(fs)
    context.mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      if (to === f.metadata) throw new Error('metadata locked')
      await rename(from, to)
    })
    await assert.rejects(f.files.move('note.md', 'new.md'), /metadata locked/)
    await assert.rejects(f.files.remove('note.md'), /metadata locked/)
    assert.equal(await fs.readFile(path.join(f.root, 'note.md'), 'utf8'), 'note')
    context.mock.restoreAll()
    const failedTrash = new FileService(f.root, f.userData, async () => { throw new Error('trash refused') })
    await assert.rejects(failedTrash.remove('note.md'), /trash refused/)
    assert.deepEqual(await new FileService(f.root, f.userData).listArchive(), entries)
    assert.equal(await fs.readFile(path.join(f.root, 'note.md'), 'utf8'), 'note')
  } finally { context.mock.restoreAll(); await f.cleanup() }
})

test('completed move and delete recover archive metadata after a failed final write and restart', async context => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, 'note.md'), 'note')
    const entries = await f.files.archive('note.md')
    const failFinalWrite = () => {
      const rename = fs.rename.bind(fs)
      let metadataWrites = 0
      context.mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
        if (to === f.metadata && ++metadataWrites === 2) throw new Error('final metadata write failed')
        await rename(from, to)
      })
    }
    failFinalWrite()
    const moved = await f.files.move('note.md', 'NOTE.md')
    assert.match(moved.warning!, /文件已移动.*归档记录待完成/)
    assert.ok(JSON.parse(await fs.readFile(f.metadata, 'utf8')).pending)
    context.mock.restoreAll()
    assert.deepEqual(await new FileService(f.root, f.userData).listArchive(), [{ ...entries[0], path: 'NOTE.md' }])
    assert.equal(await fs.readFile(path.join(f.root, 'NOTE.md'), 'utf8'), 'note')
    failFinalWrite()
    const removed = await f.files.remove('NOTE.md')
    assert.match(removed.warning!, /回收站.*归档记录待完成/)
    context.mock.restoreAll()
    assert.deepEqual(await new FileService(f.root, f.userData).listArchive(), [])
    assert.equal(await fs.readFile(path.join(f.temporary, 'trash/NOTE.md'), 'utf8'), 'note')
  } finally { context.mock.restoreAll(); await f.cleanup() }
})

test('failed file rename restores old archive state on the next read', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, 'note.md'), 'note')
    const entries = await f.files.archive('note.md')
    await assert.rejects(f.files.move('note.md', 'missing/new.md'), { code: 'ENOENT' })
    assert.deepEqual(await new FileService(f.root, f.userData).listArchive(), entries)
    assert.equal(await fs.readFile(path.join(f.root, 'note.md'), 'utf8'), 'note')
  } finally { await f.cleanup() }
})

test('new profiles default to preview while a saved layout remains unchanged', async () => {
  const f = await fixture()
  try {
    assert.equal((await getSettings(f.userData)).layout, 'preview')
    await putSettings(f.userData, { ...defaultSettings, layout: 'split' })
    assert.equal((await getSettings(f.userData)).layout, 'split')
  } finally { await f.cleanup() }
})
