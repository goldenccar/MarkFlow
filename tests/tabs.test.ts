import assert from 'node:assert/strict'
import test from 'node:test'
import { canStickPinnedTabs, fileTabId, orderTabs, readTabSession, reorderTabs, type DocumentTab } from '../src/renderer/tabs'

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
test('sticky pins reserve a complete ordinary tab and the separating gap', () => {
  const geometry = { pinnedCount: 2, pinnedWidth: 40, gap: 4, regularWidth: 180 }
  assert.equal(canStickPinnedTabs({ ...geometry, viewportWidth: 268 }), true)
  assert.equal(canStickPinnedTabs({ ...geometry, viewportWidth: 267.99 }), false)
  assert.equal(canStickPinnedTabs({ ...geometry, viewportWidth: 264 }), false)
})
test('an all-pinned rail needs no trailing gap or ordinary-tab reserve', () => {
  const geometry = { pinnedCount: 3, pinnedWidth: 40, gap: 4, regularWidth: 0 }
  assert.equal(canStickPinnedTabs({ ...geometry, viewportWidth: 128 }), true)
  assert.equal(canStickPinnedTabs({ ...geometry, viewportWidth: 127.99 }), false)
  assert.equal(canStickPinnedTabs({ ...geometry, pinnedCount: 1, viewportWidth: 40 }), true)
  assert.equal(canStickPinnedTabs({ ...geometry, pinnedCount: 0, viewportWidth: 0 }), true)
})
test('narrow desktop rails stop sticking pins before the ordinary tab is clipped', () => {
  const geometry = { pinnedWidth: 40, gap: 4, regularWidth: 180 }
  for (const { viewportWidth, lastFittingCount } of [
    { viewportWidth: 628, lastFittingCount: 10 },
    { viewportWidth: 500, lastFittingCount: 7 },
  ]) {
    assert.equal(canStickPinnedTabs({ ...geometry, viewportWidth, pinnedCount: lastFittingCount }), true)
    assert.equal(canStickPinnedTabs({ ...geometry, viewportWidth, pinnedCount: lastFittingCount + 1 }), false)
  }
})
test('unusable measurements do not enable sticky pins', () => {
  const geometry = { viewportWidth: 500, pinnedCount: 2, pinnedWidth: 40, gap: 4, regularWidth: 180 }
  for (const invalid of [
    { viewportWidth: Number.NaN }, { viewportWidth: -1 }, { pinnedCount: 1.5 },
    { pinnedCount: -1 }, { pinnedWidth: 0 }, { gap: -1 }, { regularWidth: Number.POSITIVE_INFINITY },
  ]) assert.equal(canStickPinnedTabs({ ...geometry, ...invalid }), false)
})
test('session metadata rejects broken records and deduplicates', () => {
  assert.deepEqual(readTabSession('{'), { tabs: [], active: '', closed: [] })
  const restored = readTabSession(JSON.stringify({ tabs: [tab('a'), tab('a'), { id: 1 }, null], active: 'a', closed: [tab('b')] }))
  assert.equal(restored.tabs.length, 1)
  assert.equal(restored.active, 'a')
  assert.equal(restored.closed[0].id, 'b')
})
