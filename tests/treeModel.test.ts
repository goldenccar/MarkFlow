import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveOwner, filterTree, moveDestination } from '../src/renderer/treeModel'

test('logical archive hides subtrees while retaining ancestors for the archive browser', () => {
  const entries = [{ path: 'notes', name: 'notes', directory: true, children: [
    { path: 'notes/keep.md', name: 'keep.md', directory: false },
    { path: 'notes/later', name: 'later', directory: true, children: [{ path: 'notes/later/a.md', name: 'a.md', directory: false }] },
  ] }]
  const records = [{ path: 'notes/later', archivedAt: '2026-10-23T00:00:00Z' }]
  assert.deepEqual(filterTree(entries, records, false)[0].children?.map(x => x.path), ['notes/keep.md'])
  assert.deepEqual(filterTree(entries, records, true)[0].children?.map(x => x.path), ['notes/later'])
  assert.equal(archiveOwner(records, 'NOTES/LATER/a.md')?.path, 'notes/later')
  assert.equal(archiveOwner(records, 'notes/later-other.md'), undefined)
  assert.equal(entries[0].children.length, 2)
})
test('drag destinations reject self, descendants and unchanged locations', () => {
  assert.equal(moveDestination('notes/a.md', 'notes'), null)
  assert.equal(moveDestination('notes', 'notes/inside'), null)
  assert.equal(moveDestination('notes', 'NOTES'), null)
  assert.equal(moveDestination('notes/a.md', ''), 'a.md')
  assert.equal(moveDestination('notes/a.md', 'other'), 'other/a.md')
})
