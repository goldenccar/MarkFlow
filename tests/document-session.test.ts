import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeDocumentContent, isDocDirty } from '../src/renderer/documentSession'
import { parseMarks, readMarkDocument, reconcileMarkDocument, setMarkStyle } from '../src/shared/marks'

test('opening raw Markdown allocates independent session identities without marking either document dirty', () => {
  const raw = '# Same\r\n\r\nparagraph\r\n'
  const a = initializeDocumentContent(raw, raw, 'markdown')
  const b = initializeDocumentContent(raw, raw, 'markdown')
  assert.equal(readMarkDocument(a.content).body, '# Same\n\nparagraph\n')
  assert.equal(isDocDirty(a), false)
  assert.equal(isDocDirty(b), false)
  assert.notEqual(readMarkDocument(a.content).metadata?.documentId, readMarkDocument(b.content).metadata?.documentId)
  const aIds = new Set(parseMarks(a.content).map(mark => mark.id))
  assert.ok(parseMarks(b.content).every(mark => !aIds.has(mark.id)))
  assert.ok([...aIds].every(id => !id.startsWith('snapshot:')))
})

test('new blank documents stay clean; an explicit style edit is a recoverable change and undo returns clean', () => {
  const blank = initializeDocumentContent('', '', 'markdown')
  assert.equal(readMarkDocument(blank.content).body, '')
  assert.equal(isDocDirty(blank), false)
  assert.equal(isDocDirty({ ...blank, content: setMarkStyle(blank.content, 0, { fontSize: 24 }) }), true)
  assert.equal(isDocDirty({ ...blank, content: blank.cleanContent }), false)
})

test('saved registries reopen byte-identically while restoring an unsaved draft remains dirty', () => {
  const opened = initializeDocumentContent('alpha\n\nbeta', 'alpha\n\nbeta', 'markdown')
  const styled = setMarkStyle(opened.content, 0, { fontSize: 24 })
  const recovered = initializeDocumentContent(styled, 'alpha\n\nbeta', 'markdown')
  assert.equal(recovered.content, styled)
  assert.equal(isDocDirty(recovered), true)
  const reopened = initializeDocumentContent(styled, styled, 'markdown')
  assert.equal(reopened.content, styled)
  assert.equal(isDocDirty(reopened), false)
  assert.deepEqual(parseMarks(reopened.content).map(mark => mark.id), parseMarks(opened.content).map(mark => mark.id))
})

test('committing a captured snapshot keeps later typing dirty until that exact content is saved', () => {
  const opened = initializeDocumentContent('alpha', 'alpha', 'markdown')
  const mark = parseMarks(opened.content)[0]
  const snapshot = reconcileMarkDocument(opened.content, 'alpha first', [{ id: mark.id, from: 0, to: 11 }])
  const lateContent = reconcileMarkDocument(snapshot, 'alpha first later', [{ id: mark.id, from: 0, to: 17 }])
  const afterSave = { ...opened, content: lateContent, cleanContent: snapshot }
  assert.equal(isDocDirty(afterSave), true)
  assert.equal(readMarkDocument(afterSave.content).body, 'alpha first later')
  assert.equal(parseMarks(afterSave.content)[0].id, mark.id)
  assert.equal(isDocDirty({ ...afterSave, cleanContent: lateContent }), false)
})

test('Formula raw text and unsupported metadata are preserved without an implicit edit', () => {
  const formula = initializeDocumentContent('x = y\r\n', 'x = y\r\n', 'latex-math')
  assert.deepEqual(formula, { content: 'x = y\n', cleanContent: 'x = y\n' })
  const invalid = 'text\n\n<!-- oops:marks {"v":2,"marks":[]} -->'
  const opened = initializeDocumentContent(invalid, invalid, 'markdown')
  assert.equal(opened.content, invalid)
  assert.equal(isDocDirty(opened), false)
  assert.ok(readMarkDocument(opened.content).issue)
})
