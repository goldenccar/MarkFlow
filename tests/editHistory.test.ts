import test from 'node:test'
import assert from 'node:assert/strict'
import { EditHistory } from '../src/renderer/editHistory'

test('one snapshot history crosses rich/source changes without mode-switch edits', () => {
  const history = new EditHistory({ value: 'original\r\n', cursor: 0 })
  history.change({ value: 'original\r\nA', cursor: 11 }, 'rich', 10)
  history.change({ value: 'original\r\nAB', cursor: 12 }, 'rich', 20)
  history.boundary()
  history.change({ value: 'original\r\nABC', cursor: 13 }, 'source', 30)
  assert.equal(history.undo()?.value, 'original\r\nAB')
  assert.equal(history.undo()?.value, 'original\r\n')
  assert.equal(history.redo()?.value, 'original\r\nAB')
  assert.equal(history.redo()?.value, 'original\r\nABC')
  assert.equal(history.redo(), null)
})

test('structural/format edits stay separate and a new edit removes redo', () => {
  const history = new EditHistory({ value: 'hello', cursor: 5 })
  history.change({ value: 'hello\n\n', cursor: 7 })
  history.change({ value: 'hello\n\nworld', cursor: 12 }, 'rich', 20)
  assert.equal(history.undo()?.value, 'hello\n\n')
  history.change({ value: 'hello\n\nnext', cursor: 11 }, 'source', 30)
  assert.equal(history.redo(), null)
  assert.equal(history.undo()?.value, 'hello\n\n')
  assert.equal(history.undo()?.value, 'hello')
})
