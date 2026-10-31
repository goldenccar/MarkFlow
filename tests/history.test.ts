import test from 'node:test'
import assert from 'node:assert/strict'
import { SnapshotHistory } from '../src/engine/history'

test('retained generic snapshots are measured once per checkpoint rather than rescanned on each edit', () => {
  let calls = 0
  const history = new SnapshotHistory({ value: 'initial' }, { sizeOf: value => { calls++; return value.value.length }, maxBytes: 10000 })
  for (let index = 0; index < 65; index++) history.change({ value: String(index) })
  assert.equal(calls, 65)
  assert.equal(history.bytes, 'initial'.length + Array.from({ length: 65 }, (_, index) => String(index).length).reduce((a, b) => a + b))
  assert.equal(calls, 66)
})

test('byte-budget trimming remains correct across undo, redo and a replacement branch', () => {
  const history = new SnapshotHistory('A', { sizeOf: value => value.length, maxBytes: 5 })
  history.change('BB'); history.change('CCC'); history.change('DDDD')
  assert.equal(history.bytes, 9)
  assert.equal(history.undo(), 'CCC'); assert.equal(history.bytes, 9)
  assert.equal(history.undo(), 'BB'); assert.equal(history.bytes, 9)
  assert.equal(history.undo(), null)
  assert.equal(history.redo(), 'CCC')
  history.change('EEEEE')
  assert.equal(history.bytes, 10); assert.equal(history.redo(), null)
  assert.equal(history.undo(), 'CCC'); assert.equal(history.redo(), 'EEEEE')
  history.change('FFFFFF')
  assert.equal(history.bytes, 11)
  assert.equal(history.undo(), 'EEEEE'); assert.equal(history.undo(), null)
})

test('grouped edits and boundaries retain entry-count limits and one oversized undo checkpoint', () => {
  const history = new SnapshotHistory('0', { sizeOf: value => value.length, maxEntries: 2 })
  history.change('1', 'typing', 10); history.change('2', 'typing', 20)
  assert.equal(history.change('2', 'typing', 25), false)
  history.boundary(); history.change('3', 'typing', 30); history.change('4', '', 40)
  assert.equal(history.bytes, 3)
  assert.equal(history.undo(), '3'); assert.equal(history.undo(), '2'); assert.equal(history.undo(), null)
  assert.equal(history.redo(), '3'); assert.equal(history.redo(), '4')
  const oversized = new SnapshotHistory('A', { sizeOf: value => value.length, maxBytes: 1 })
  oversized.change('BBBB'); oversized.change('C')
  assert.equal(oversized.bytes, 5)
  assert.equal(oversized.undo(), 'BBBB'); assert.equal(oversized.undo(), null)
})

test('current view-state replacement is measured when it becomes a checkpoint', () => {
  const history = new SnapshotHistory({ text: 'A', cursor: 0 }, { equal: (a, b) => a.text === b.text, sizeOf: value => value.text.length + value.cursor, maxBytes: 10 })
  history.current.cursor = 2
  history.change({ text: 'BB', cursor: 1 })
  assert.equal(history.bytes, 6)
  history.undo()
  history.current = { text: 'A', cursor: 5 }
  history.redo()
  assert.equal(history.bytes, 9)
  history.change({ text: 'CCC', cursor: 2 })
  assert.equal(history.bytes, 14)
  assert.deepEqual(history.undo(), { text: 'BB', cursor: 1 })
  assert.deepEqual(history.undo(), { text: 'A', cursor: 5 })
})
