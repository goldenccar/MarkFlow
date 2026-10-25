import test from 'node:test'
import assert from 'node:assert/strict'
import { ChangeSet } from '@codemirror/state'
import { sourceMarkMappings } from '../src/renderer/sourceMarkMapping'
import { ensureMarkDocument, parseMarks, readMarkDocument, reconcileMarkDocument, setMarkStyle } from '../src/shared/marks'
import { importMarkdown, exportMarkdown } from '../src/shared/richMarkdown'

function edit(source: string, from: number, to: number, insert: string) {
  const before = readMarkDocument(source).body, changes = ChangeSet.of({ from, to, insert }, before.length)
  const body = before.slice(0, from) + insert + before.slice(to)
  const mappings = sourceMarkMappings(source, body, changes)
  return reconcileMarkDocument(source, body, mappings)
}
test('source text edits, type changes and duplicate paragraphs preserve the exact surviving IDs', () => {
  const source = ensureMarkDocument('Same\n\nSame\n\nLast'), ids = parseMarks(source).map(mark => mark.id)
  const changed = edit(source, 6, 6, '## '), marks = parseMarks(changed)
  assert.equal(readMarkDocument(changed).body, 'Same\n\n## Same\n\nLast')
  assert.deepEqual(marks.map(mark => mark.id), ids)
  assert.equal(marks[1].type, 'heading')
})
test('source splitting retains the left ID/style, merging retires the right ID', () => {
  const source = setMarkStyle('LeftRight\n\nAfter', 0, { fontSize: 24 }), id = parseMarks(source)[0].id
  const split = edit(source, 4, 4, '\n\n'), marks = parseMarks(split)
  assert.deepEqual(marks.map(mark => mark.raw), ['Left', 'Right', 'After'])
  assert.equal(marks[0].id, id); assert.equal(marks[0].style.fontSize, 24)
  assert.notEqual(marks[1].id, id); assert.deepEqual(marks[1].style, {})
  const merged = edit(split, 4, 6, ''), after = parseMarks(merged)
  assert.equal(after[0].id, id); assert.equal(after[0].style.fontSize, 24)
  assert.ok(readMarkDocument(merged).metadata!.retiredIds!.includes(marks[1].id))
})
test('source deletion does not resurrect a retired ID when identical text is later inserted', () => {
  const source = ensureMarkDocument('First\n\nSecond'), id = parseMarks(source)[0].id
  const removed = edit(source, 0, 7, ''), restoredText = edit(removed, 0, 0, 'First\n\n')
  assert.equal(readMarkDocument(restoredText).body, readMarkDocument(source).body)
  assert.notEqual(parseMarks(restoredText)[0].id, id)
  assert.ok(readMarkDocument(restoredText).metadata!.retiredIds!.includes(id))
  assert.equal(readMarkDocument(removed).metadata!.marks.some(mark => mark.raw.includes('First')), false)
})
test('source replacement retains one ID while new pasted paragraphs receive their own IDs', () => {
  const source = ensureMarkDocument('Alpha\n\nOmega'), id = parseMarks(source)[0].id
  const result = edit(source, 0, 5, 'New\n\nMore'), marks = parseMarks(result)
  assert.equal(marks[0].id, id)
  assert.equal(new Set(marks.map(mark => mark.id)).size, 3)
  assert.equal(marks[2].id, parseMarks(source)[1].id)
})
test('source typing in a registered empty Mark preserves its identity', () => {
  const source = ensureMarkDocument('Before\n\n'), id = parseMarks(source).at(-1)!.id
  const result = edit(source, 8, 8, 'Typed')
  assert.equal(parseMarks(result).at(-1)!.id, id)
  assert.equal(parseMarks(result).at(-1)!.raw, 'Typed')
})

test('source editing keeps interior empty IDs and removing their whitespace cannot produce duplicate mappings', () => {
  const source = ensureMarkDocument('First\n\nLast'), base = importMarkdown(source)
  base.doc.content!.splice(1, 0, { type: 'paragraph' }, { type: 'paragraph' })
  const withEmpty = exportMarkdown(base.doc, base), marks = parseMarks(withEmpty)
  assert.equal(marks.length, 4)
  const typed = edit(withEmpty, marks[1].from, marks[1].from, 'Middle')
  assert.equal(parseMarks(typed)[1].id, marks[1].id)
  assert.equal(parseMarks(typed)[1].raw, 'Middle')
  const removed = edit(withEmpty, marks[0].to, marks[3].from, '\n\n')
  const surviving = parseMarks(removed)
  assert.deepEqual(surviving.map(mark => mark.id), [marks[0].id, marks[3].id])
})
