import assert from 'node:assert/strict'
import test from 'node:test'
import { fileTabId, orderTabs, readTabSession, reorderTabs, type DocumentTab } from '../src/renderer/tabs'

const tab = (id: string, pinned = false): DocumentTab => ({ id, root: 'C:/notes', path: `${id}.md`, title: id, mode: 'markdown', pinned, dirty: false })
test('file identity is case insensitive on Windows and normalizes root separators', () => {
  assert.equal(fileTabId('C:\\Notes', 'A.md'), fileTabId('c:/notes', 'a.MD'))
})
test('tab order keeps pins together and dragging stays in its pin group', () => {
  const tabs = orderTabs([tab('a'), tab('b', true), tab('c')])
  assert.deepEqual(tabs.map(tab => tab.id), ['b', 'a', 'c'])
  assert.deepEqual(reorderTabs(tabs, 'c', 'a').map(tab => tab.id), ['b', 'c', 'a'])
  assert.equal(reorderTabs(tabs, 'c', 'b'), tabs)
})
test('session metadata rejects broken records and deduplicates', () => {
  assert.deepEqual(readTabSession('{'), { tabs: [], active: '', closed: [] })
  const restored = readTabSession(JSON.stringify({ tabs: [tab('a'), tab('a'), { id: 1 }, null], active: 'a', closed: [tab('b')] }))
  assert.equal(restored.tabs.length, 1)
  assert.equal(restored.active, 'a')
  assert.equal(restored.closed[0].id, 'b')
})
