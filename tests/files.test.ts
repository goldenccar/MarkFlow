import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { FileService, getSettings, putSettings } from '../src/main/files'
import { defaultSettings } from '../src/shared/types'

async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'oopsmd-files-'))
  const root = path.join(temporary, 'library')
  const userData = path.join(temporary, 'app')
  await fs.mkdir(root)
  const trashed: string[] = []
  const service = new FileService(root, userData, async target => {
    const trash = path.join(temporary, 'trash')
    await fs.mkdir(trash, { recursive: true })
    await fs.rename(target, path.join(trash, path.basename(target)))
    trashed.push(target)
  })
  return { temporary, root, userData, service, trashed, cleanup: () => fs.rm(temporary, { recursive: true, force: true }) }
}

test('Unicode and space paths share one sorted tree; text reads preserve the original file', async () => {
  const f = await fixture()
  try {
    await f.service.create('中文 目录', true)
    await f.service.create('中文 目录/文稿 1.md', false)
    await fs.writeFile(path.join(f.root, '中文 目录/文稿 1.md'), '你好\n')
    await fs.mkdir(path.join(f.root, '.git'))
    await fs.mkdir(path.join(f.root, 'node_modules'))
    const tree = await f.service.tree()
    assert.equal(tree.length, 1)
    assert.equal(tree[0].children?.[0].path, '中文 目录/文稿 1.md')
    assert.equal((await f.service.read('中文 目录/文稿 1.md')).content, '你好\n')
    await assert.rejects(f.service.create('中文 目录/文稿 1.md', false), { code: 'EEXIST' })
  } finally { await f.cleanup() }
})

test('reject traversal, absolute paths, Windows reserved names, Git internals and binary text', async () => {
  const f = await fixture()
  try {
    for (const input of ['../secret.md', 'a/../../secret.md', '/secret.md', 'C:\\secret.md', 'a\\..\\secret.md', '.git/config', '.GIT/config', 'CON.md', 'CONIN$', 'COM¹.txt', 'a/COM1.txt', 'a.', 'trailing ', 'a:b', 'a//b']) {
      await assert.rejects(f.service.resolve(input), { name: 'Error' }, input)
    }
    await fs.writeFile(path.join(f.root, 'binary.md'), Buffer.from([0xff, 0xfe]))
    await assert.rejects(f.service.read('binary.md'), /UTF-8/)
    await fs.writeFile(path.join(f.root, 'zero-byte.md'), 'text\0data')
    await assert.rejects(f.service.read('zero-byte.md'), /二进制/)
    await assert.rejects(f.service.create('script.js', false), /仅支持/)
    await assert.rejects(f.service.remove(''), /路径无效/)
    assert.throws(() => new FileService(f.root, path.join(f.root, 'app')), /之外/)
    assert.throws(() => new FileService(path.join(f.root, '.git'), f.userData), /内部目录/)
  } finally { await f.cleanup() }
})

test('junction or symlink paths cannot escape the library or alias Git internals', async () => {
  const f = await fixture()
  try {
    const external = path.join(f.temporary, 'external')
    await fs.mkdir(external)
    await fs.writeFile(path.join(external, 'secret.md'), 'secret')
    await fs.symlink(external, path.join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await fs.mkdir(path.join(f.root, '.git'))
    await fs.symlink(path.join(f.root, '.git'), path.join(f.root, 'git-alias'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const input of ['escape/secret.md', 'escape/new.md', 'git-alias/config']) await assert.rejects(f.service.resolve(input), /之外|Git/)
    assert.deepEqual(await f.service.tree(), [])
  } finally { await f.cleanup() }
})

test('atomic save retains BOM and CRLF and rejects external changes', async () => {
  const f = await fixture()
  try {
    const filename = path.join(f.root, 'note.md')
    const original = Buffer.from('\uFEFFfirst\r\n中文\r\n')
    await fs.writeFile(filename, original)
    const file = await f.service.read('note.md')
    assert.equal(file.content, 'first\n中文\n')
    assert.equal(file.eol, '\r\n')
    assert.equal(file.bom, true)
    await f.service.write('note.md', file.content, file.revision)
    assert.deepEqual(await fs.readFile(filename), original)
    const saved = await f.service.write('note.md', `${file.content}next\n`, file.revision)
    assert.equal(await fs.readFile(filename, 'utf8'), '\uFEFFfirst\r\n中文\r\nnext\r\n')
    await fs.writeFile(filename, 'external version')
    await assert.rejects(f.service.write('note.md', 'local version', saved.revision), /外部程序修改/)
    assert.equal(await fs.readFile(filename, 'utf8'), 'external version')
    assert.ok(!(await fs.readdir(f.root)).some(name => name.startsWith('.oopsmd-')))
  } finally { await f.cleanup() }
})

test('simultaneous saves using one revision cannot silently replace one another', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, 'note.md'), 'base')
    const file = await f.service.read('note.md')
    const results = await Promise.allSettled([
      f.service.write('note.md', 'first', file.revision),
      f.service.write('note.md', 'second', file.revision),
    ])
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    assert.equal(await fs.readFile(path.join(f.root, 'note.md'), 'utf8'), 'first')
  } finally { await f.cleanup() }
})

test('save returns its captured snapshot when an external edit follows the atomic rename', async context => {
  const f = await fixture()
  try {
    const filename = path.join(f.root, 'note.md')
    await fs.writeFile(filename, '\uFEFFbaseline\r\n')
    const file = await f.service.read('note.md')
    const rename = fs.rename.bind(fs)
    context.mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      await rename(from, to)
      if (to === filename) await fs.writeFile(filename, 'external after atomic rename')
    })
    const saved = await f.service.write('note.md', 'requested snapshot\n', file.revision)
    assert.equal(saved.content, 'requested snapshot\n')
    assert.equal(saved.bom, true)
    assert.equal(saved.eol, '\r\n')
    const disk = await f.service.read('note.md')
    assert.equal(disk.content, 'external after atomic rename')
    assert.notEqual(saved.revision, disk.revision)
    await assert.rejects(f.service.write('note.md', 'next edit', saved.revision), /外部程序修改/)
  } finally { context.mock.restoreAll(); await f.cleanup() }
})

test('drafts remain outside the repository, preserve baseline format, and survive external changes', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, 'draft.md'), '\uFEFFbaseline\r\n')
    const file = await f.service.read('draft.md')
    await f.service.draft({ path: file.path, revision: file.revision, content: 'recover me', updatedAt: new Date().toISOString() })
    await fs.writeFile(path.join(f.root, 'draft.md'), 'external')
    const restored = await new FileService(f.root, f.userData).getDraft('draft.md')
    assert.equal(restored?.content, 'recover me')
    assert.equal(restored?.revision, file.revision)
    assert.equal((restored as unknown as { eol: string }).eol, '\r\n')
    assert.deepEqual(await fs.readdir(f.root), ['draft.md'])
    const otherRoot = path.join(f.temporary, 'other-library')
    await fs.mkdir(otherRoot)
    assert.equal(await new FileService(otherRoot, f.userData).getDraft('draft.md'), null)
    await f.service.clearDraft('draft.md')
    assert.equal(await f.service.getDraft('draft.md'), null)
  } finally { await f.cleanup() }
})

test('renames reject collisions and report relative links without rewriting source', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, 'note.md'), 'note')
    const index = '[note](note.md#title)\n[space](<中文 空格.md>)\n[ref]: note.md\n[web](https://example.test/note.md)'
    await fs.writeFile(path.join(f.root, 'index.md'), index)
    await fs.writeFile(path.join(f.root, 'taken.md'), 'taken')
    await assert.rejects(f.service.move('note.md', 'taken.md'), /已存在/)
    assert.equal(await fs.readFile(path.join(f.root, 'taken.md'), 'utf8'), 'taken')
    const result = await f.service.move('note.md', 'NOTE.md')
    assert.deepEqual(result.affectedLinks, ['index.md'])
    assert.ok((await fs.readdir(f.root)).includes('NOTE.md'))
    assert.equal(await fs.readFile(path.join(f.root, 'index.md'), 'utf8'), index)
    assert.equal(await fs.readFile(path.join(f.root, 'NOTE.md'), 'utf8'), 'note')
    await f.service.create('folder', true)
    await assert.rejects(f.service.move('folder', 'folder/child'), /自身内部/)
    await f.service.move('folder', 'FOLDER')
    assert.ok((await fs.readdir(f.root)).includes('FOLDER'))
    await fs.writeFile(path.join(f.root, 'image.png'), Buffer.from([0, 1, 2]))
    await f.service.move('image.png', 'picture.png')
    assert.deepEqual(await fs.readFile(path.join(f.root, 'picture.png')), Buffer.from([0, 1, 2]))
  } finally { await f.cleanup() }
})

test('delete uses the trash callback and refuses permanent deletion when unavailable', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, 'note.md'), 'note')
    await fs.writeFile(path.join(f.root, 'index.md'), '[note](note.md)')
    await assert.rejects(new FileService(f.root, f.userData).remove('note.md'), /回收站不可用/)
    await assert.rejects(new FileService(f.root, f.userData, async () => { throw new Error('trash failed') }).remove('note.md'), /trash failed/)
    assert.equal(await fs.readFile(path.join(f.root, 'note.md'), 'utf8'), 'note')
    const result = await f.service.remove('note.md')
    assert.deepEqual(result.affectedLinks, ['index.md'])
    assert.equal(f.trashed.length, 1)
    assert.equal(await fs.readFile(path.join(f.temporary, 'trash/note.md'), 'utf8'), 'note')
    await assert.rejects(f.service.read('note.md'), { code: 'ENOENT' })
  } finally { await f.cleanup() }
})

test('moving a directory migrates every recovery draft, including closed nested documents', async () => {
  const f = await fixture()
  try {
    await fs.mkdir(path.join(f.root, 'old/nested'), { recursive: true })
    for (const filename of ['old/open.md', 'old/nested/closed.md', 'unrelated.md']) {
      await fs.writeFile(path.join(f.root, filename), '\uFEFFbaseline\r\n')
      const file = await f.service.read(filename)
      await f.service.draft({ path: filename, content: `unsaved ${filename}`, revision: file.revision, updatedAt: new Date().toISOString() })
    }
    await f.service.move('old', '新 目录')
    const reopened = new FileService(f.root, f.userData)
    for (const suffix of ['open.md', 'nested/closed.md']) {
      const draft = await reopened.getDraft(`新 目录/${suffix}`)
      assert.equal(draft?.path, `新 目录/${suffix}`)
      assert.equal(draft?.content, `unsaved old/${suffix}`)
      assert.equal((draft as unknown as { eol: string }).eol, '\r\n')
      assert.equal(await reopened.getDraft(`old/${suffix}`), null)
    }
    assert.equal((await reopened.getDraft('unrelated.md'))?.content, 'unsaved unrelated.md')
  } finally { await f.cleanup() }
})

test('case-only file and directory renames retain recovery under the same hash', async () => {
  const f = await fixture()
  try {
    await fs.mkdir(path.join(f.root, 'folder'))
    await fs.writeFile(path.join(f.root, 'folder/note.md'), 'baseline')
    const file = await f.service.read('folder/note.md')
    await f.service.draft({ path: file.path, content: 'unsaved', revision: file.revision, updatedAt: new Date().toISOString() })
    await f.service.move('folder/note.md', 'folder/NOTE.md')
    assert.equal((await f.service.getDraft('folder/NOTE.md'))?.path, 'folder/NOTE.md')
    await f.service.move('folder', 'FOLDER')
    const draft = await new FileService(f.root, f.userData).getDraft('FOLDER/NOTE.md')
    assert.equal(draft?.path, 'FOLDER/NOTE.md')
    assert.equal(draft?.content, 'unsaved')
    assert.equal(draft?.revision, file.revision)
  } finally { await f.cleanup() }
})

test('failed disk move rolls back draft copies and destination draft collisions preserve both recoveries', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.root, 'old.md'), 'baseline')
    const file = await f.service.read('old.md')
    const updatedAt = new Date().toISOString()
    await f.service.draft({ path: file.path, content: 'source recovery', revision: file.revision, updatedAt })
    await assert.rejects(f.service.move('old.md', 'missing/new.md'), { code: 'ENOENT' })
    assert.equal((await f.service.getDraft('old.md'))?.content, 'source recovery')
    assert.equal(await f.service.getDraft('missing/new.md'), null)
    await f.service.draft({ path: 'new.md', content: 'destination recovery', revision: 'previous-file-revision', updatedAt })
    await assert.rejects(f.service.move('old.md', 'new.md'), /已有恢复草稿/)
    assert.equal((await f.service.getDraft('old.md'))?.content, 'source recovery')
    assert.equal((await f.service.getDraft('new.md'))?.content, 'destination recovery')
    assert.equal(await fs.readFile(path.join(f.root, 'old.md'), 'utf8'), 'baseline')
    await assert.rejects(fs.readFile(path.join(f.root, 'new.md')), { code: 'ENOENT' })
  } finally { await f.cleanup() }
})

test('deleting a folder refuses dirty closed-document drafts; saved drafts do not block trash', async () => {
  const f = await fixture()
  try {
    await fs.mkdir(path.join(f.root, 'folder'))
    await fs.writeFile(path.join(f.root, 'folder/closed.md'), 'baseline')
    const file = await f.service.read('folder/closed.md')
    await f.service.draft({ path: file.path, content: 'unsaved recovery', revision: file.revision, updatedAt: new Date().toISOString() })
    await assert.rejects(f.service.remove('folder'), /folder\/closed\.md.*恢复并保存/)
    assert.equal(f.trashed.length, 0)
    assert.equal((await f.service.getDraft(file.path))?.content, 'unsaved recovery')
    await f.service.write(file.path, 'unsaved recovery', file.revision)
    await f.service.remove('folder')
    assert.equal(f.trashed.length, 1)
    assert.equal(await fs.readFile(path.join(f.temporary, 'trash/folder/closed.md'), 'utf8'), 'unsaved recovery')
    assert.equal(await f.service.getDraft(file.path), null)
  } finally { await f.cleanup() }
})

test('settings validate thresholds and persist only the supported device-local fields', async () => {
  const f = await fixture()
  try {
    assert.equal((await getSettings(f.userData)).threshold, 500)
    const settings = { ...defaultSettings, threshold: 777, recent: [{ root: f.root, path: '中文 空格.md' }], positions: { note: { cursor: 3, scroll: 42 } } }
    await putSettings(f.userData, settings)
    assert.equal((await getSettings(f.userData)).threshold, 777)
    for (const threshold of [0, -1, 1.5, Number.NaN]) await assert.rejects(putSettings(f.userData, { ...settings, threshold }), /设置值无效/)
    await assert.rejects(putSettings(f.userData, { ...settings, fontSize: 1000 }), /设置值无效/)
    await putSettings(f.userData, { ...settings, positions: { preview: { cursor: 2, scroll: 5, previewScroll: 60.5 }, old: { cursor: 0, scroll: 0 } } })
    assert.deepEqual((await getSettings(f.userData)).positions.preview, { cursor: 2, scroll: 5, previewScroll: 60.5 })
    assert.deepEqual((await getSettings(f.userData)).positions.old, { cursor: 0, scroll: 0 })
    for (const previewScroll of [-1, Number.NaN, Number.POSITIVE_INFINITY]) await assert.rejects(putSettings(f.userData, { ...settings, positions: { preview: { cursor: 0, scroll: 0, previewScroll } } }), /预览阅读位置无效/)
    assert.equal((await getSettings(f.userData)).threshold, 777)
  } finally { await f.cleanup() }
})
