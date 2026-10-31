import test from 'node:test'
import assert from 'node:assert/strict'
import { markAt, parseMarks, readMarkDocument, reconcileMarkDocument, setMarkStyle, ensureMarkDocument, applyMarkdownMarkCommand } from '../src/shared/marks'
import { changeCount } from '../src/shared/changes'

test('manual Mark typography is portable and preserves the complete original Markdown body', () => {
  for (const body of ['first\n\nsecond\n', '# 标题\r\n\r\n段落\r\n\r\n', '']) {
    const styled = setMarkStyle(body, 0, { fontFamily: 'kaiti', fontSize: 24 })
    assert.equal(readMarkDocument(styled).body, body)
    assert.equal(readMarkDocument(styled + '\n\n').body, body)
    assert.deepEqual(parseMarks(styled)[0].style, { fontFamily: 'kaiti', fontSize: 24 })
    assert.ok(!parseMarks(styled)[0].id.startsWith('snapshot:'))
    assert.ok(!parseMarks(styled).some(mark => mark.raw.includes('oops:marks')))
    assert.equal(changeCount(body, styled), 0)
    const reset = setMarkStyle(styled, 0, null)
    assert.deepEqual(parseMarks(reset)[0].style, {})
    assert.equal(parseMarks(reset)[0].id, parseMarks(styled)[0].id)
    assert.equal(readMarkDocument(reset).body, body)
  }
})
test('two Mark overrides are independent and each property can inherit again', () => {
  const a = setMarkStyle('alpha\n\nbeta', 0, { fontFamily: 'fangsong', fontSize: 24 })
  const b = setMarkStyle(a, 7, { fontFamily: 'kaiti', fontSize: 18 })
  const c = setMarkStyle(b, 0, { fontFamily: null })
  assert.deepEqual(parseMarks(c).map(mark => mark.style), [{ fontSize: 24 }, { fontFamily: 'kaiti', fontSize: 18 }])
  assert.equal(setMarkStyle(c, 0, { fontSize: 24 }), c)
})
test('Mark metadata is inert, validated and preserves unknown fields', () => {
  const styled = setMarkStyle('text <!-- -- > -->', 0, { fontSize: 20 })
  const parsed = readMarkDocument(styled)
  assert.equal(parsed.body, 'text <!-- -- > -->')
  assert.ok(!parsed.suffix.includes('text <!--'))
  const withUnknown = styled.replace('"v":1', '"extension":{"future":true},"v":1').replace('"style":', '"custom":42,"style":')
  const changed = setMarkStyle(withUnknown, 0, { fontSize: 22 })
  assert.deepEqual(readMarkDocument(changed).metadata?.extension, { future: true })
  assert.equal(readMarkDocument(changed).metadata?.marks[0].custom, 42)
  assert.throws(() => setMarkStyle(styled, 0, { fontSize: Infinity }))
  assert.throws(() => setMarkStyle(styled, 0, { fontFamily: 'url(evil)' as never }))
  const future = styled.replace('"v":1', '"v":2')
  assert.equal(readMarkDocument(future).body, future)
  assert.throws(() => setMarkStyle(future, 0, { fontSize: 22 }))
  const code = '```html\n\n<!-- oops:marks {"v":1,"marks":[]} -->'
  assert.equal(readMarkDocument(code).metadata, null)
})
test('exact snapshot identity distinguishes identical Marks without assigning ambiguous external edits', () => {
  const body = Array.from({ length: 12 }, () => 'same paragraph').join('\n\n')
  const target = parseMarks(body)[5]
  const styled = setMarkStyle(body, target.from, { fontSize: 28 })
  assert.equal(parseMarks(styled)[5].style.fontSize, 28)
  assert.equal(parseMarks(styled).filter(mark => mark.explicit).length, 1)
  const changed = 'prefix\n\n' + styled
  assert.equal(parseMarks(changed).filter(mark => mark.explicit).length, 0)
  assert.equal(readMarkDocument(changed).metadata?.marks.length, 12)
  const repeated = setMarkStyle('same\n\nmiddle\n\nsame', 0, { fontSize: 28 })
  const deleted = repeated.slice('same\n\n'.length)
  assert.ok(parseMarks(deleted).every(mark => !mark.explicit), 'deleting one of duplicate paragraphs must not transfer its style to the survivor')
})
test('transaction mappings retain identity through edits and leave new or deleted Marks unstyled', () => {
  const source = setMarkStyle('alpha\n\nbeta', 0, { fontSize: 24 })
  const id = parseMarks(source)[0].id
  const edited = reconcileMarkDocument(source, 'alpha changed\n\nnew\n\nbeta', [{ id, from: 0, to: 13 }])
  assert.equal(parseMarks(edited)[0].id, id)
  assert.deepEqual(parseMarks(edited).map(mark => mark.style), [{ fontSize: 24 }, {}, {}])
  const removed = reconcileMarkDocument(edited, 'new\n\nbeta', [])
  assert.ok(readMarkDocument(removed).metadata?.retiredIds?.includes(id))
  assert.ok(parseMarks(removed).every(mark => !mark.explicit))
})
test('unique unchanged Mark moves can be recovered from external edits; unknown metadata remains verbatim', () => {
  const source = setMarkStyle('alpha\n\nbeta', 0, { fontSize: 24 })
  const edited = 'prefix\n\n' + source
  assert.equal(markAt(edited, 8)?.style.fontSize, 24)
  const reordered = reconcileMarkDocument(source, 'beta\n\nalpha')
  assert.equal(parseMarks(reordered)[1].id, parseMarks(source)[0].id)
  const deliberate = source.replace('"fontSize":24', '"fontSize":20')
  assert.equal(reconcileMarkDocument(source, deliberate), deliberate)
})

test('registered metadata remains separate while a code fence is incomplete', () => {
  const body = 'alpha\n\n```js\nunfinished'
  const source = setMarkStyle(body, 0, { fontSize: 24 })
  assert.equal(readMarkDocument(source).body, body)
  assert.equal(parseMarks(source)[0].style.fontSize, 24)
  const edited = source.replace('unfinished', 'changed')
  assert.equal(readMarkDocument(edited).body, body.replace('unfinished', 'changed'))
})

test('hydration registers every Mark once, preserves legacy IDs and never shares identity between raw documents', () => {
  const body = '# Title\r\n\r\nA\r\n\r\n- one\r\n- two\r\n\r\n'
  const first = ensureMarkDocument(body), second = ensureMarkDocument(body)
  const marks = parseMarks(first)
  assert.equal(readMarkDocument(first).body, body)
  assert.equal(marks.length, 5)
  assert.ok(marks.every(mark => /^[\da-f-]{36}$/.test(mark.id)))
  assert.equal(new Set(marks.map(mark => mark.id)).size, marks.length)
  assert.ok(parseMarks(second).every(mark => !marks.some(old => old.id === mark.id)))
  assert.equal(ensureMarkDocument(first), first)
  const metadata = readMarkDocument(first).metadata!
  const partial = first.slice(0, -readMarkDocument(first).suffix.length) + '\r\n\r\n<!-- oops:marks ' + JSON.stringify({ v: 1, bodyHash: metadata.bodyHash, marks: [metadata.marks[1]] }) + ' -->'
  const migrated = ensureMarkDocument(partial)
  assert.equal(parseMarks(migrated)[1].id, marks[1].id)
  assert.ok(parseMarks(migrated).every(mark => !mark.id.startsWith('snapshot:')))
  assert.equal(changeCount(body, first), 0)
})

test('engine-backed Markdown movement preserves identity; copying preserves style with a fresh identity', () => {
  const source = setMarkStyle('Alpha\n\nBeta\n\nGamma\n', 0, { fontFamily: 'kaiti', fontSize: 22 })
  const original = parseMarks(source)
  const moved = applyMarkdownMarkCommand(source, { type: 'move', id: original[0].id, index: 2 })
  assert.equal(readMarkDocument(moved).body, 'Beta\n\nGamma\n\nAlpha')
  assert.deepEqual(parseMarks(moved).map(mark => mark.id), [original[1].id, original[2].id, original[0].id])
  const copied = applyMarkdownMarkCommand(moved, { type: 'copy', id: original[0].id, index: 1 })
  const marks = parseMarks(copied)
  assert.equal(marks[1].raw, 'Alpha')
  assert.deepEqual(marks[1].style, original[0].style)
  assert.ok(!original.some(mark => mark.id === marks[1].id))
  assert.equal(marks[3].id, original[0].id)
  assert.equal(ensureMarkDocument(copied), copied)
  assert.throws(() => applyMarkdownMarkCommand(source, { type: 'move', id: original[0].id, index: 20 }))
})

test('complete transaction mappings give new Marks stable IDs and reject duplicate or retired identities atomically', () => {
  const source = ensureMarkDocument('Alpha\n\nBeta'), before = parseMarks(source), nextId = crypto.randomUUID()
  const updated = reconcileMarkDocument(source, 'Alpha!\n\nNew\n\nBeta', [
    { id: before[0].id, from: 0, to: 6, type: 'paragraph' },
    { id: nextId, from: 8, to: 11, type: 'paragraph', style: { fontSize: 20 } },
    { id: before[1].id, from: 13, to: 17, type: 'paragraph' },
  ])
  assert.deepEqual(parseMarks(updated).map(mark => mark.id), [before[0].id, nextId, before[1].id])
  const deleted = reconcileMarkDocument(updated, 'Beta', [{ id: before[1].id, from: 0, to: 4, type: 'paragraph' }])
  assert.equal(parseMarks(deleted)[0].id, before[1].id)
  assert.throws(() => reconcileMarkDocument(deleted, 'New', [{ id: nextId, from: 0, to: 3, type: 'paragraph' }]), /reused/)
  assert.throws(() => reconcileMarkDocument(source, 'A\n\nB', [
    { id: before[0].id, from: 0, to: 1, type: 'paragraph' }, { id: before[0].id, from: 3, to: 4, type: 'paragraph' },
  ]), /Duplicate/)
  assert.equal(readMarkDocument(source).body, 'Alpha\n\nBeta')
  assert.ok(!readMarkDocument(deleted).suffix.includes('Alpha'), 'deleted prose is not retained in tombstones')
})

test('the body determines Mark order even if an external tool reorders registry records', () => {
  const source = ensureMarkDocument('Alpha\n\nBeta'), document = readMarkDocument(source), metadata = document.metadata!
  const shuffled = document.body + '\n\n<!-- oops:marks ' + JSON.stringify({ ...metadata, marks: [...metadata.marks].reverse() }) + ' -->'
  const a = parseMarks(shuffled)[0]
  const copied = applyMarkdownMarkCommand(shuffled, { type: 'copy', id: a.id, index: 1 })
  assert.equal(readMarkDocument(copied).body, 'Alpha\n\nAlpha\n\nBeta')
  assert.equal(parseMarks(copied)[0].id, a.id)
})

test('registered empty Marks inside Markdown gaps survive persistence and hydration', () => {
  const source = ensureMarkDocument('Alpha\n\nBeta'), marks = parseMarks(source), emptyId = crypto.randomUUID()
  const edited = reconcileMarkDocument(source, 'Alpha\n\n\n\nBeta', [
    { id: marks[0].id, type: 'paragraph', from: 0, to: 5 },
    { id: emptyId, type: 'empty', from: 7, to: 7 },
    { id: marks[1].id, type: 'paragraph', from: 9, to: 13 },
  ])
  assert.deepEqual(parseMarks(edited).map(mark => mark.id), [marks[0].id, emptyId, marks[1].id])
  assert.equal(ensureMarkDocument(edited), edited)
})

test('exact registered trailing empty Marks survive a single final newline without changing IDs', () => {
  for (const eol of ['\n', '\r\n']) {
    const original = ensureMarkDocument('Alpha'), first = parseMarks(original)[0], emptyId = crypto.randomUUID(), body = `Alpha${eol}`
    const edited = reconcileMarkDocument(original, body, [
      { id: first.id, type: 'paragraph', from: 0, to: 5 },
      { id: emptyId, type: 'empty', from: body.length, to: body.length },
    ])
    assert.deepEqual(parseMarks(edited).map(mark => mark.id), [first.id, emptyId])
    assert.equal(parseMarks(edited)[1].line, 2)
    assert.equal(readMarkDocument(edited).body, body)
    assert.equal(ensureMarkDocument(edited), edited)
    const stale = edited.replace(/"bodyHash":"[^"]+"/, '"bodyHash":"0:0:0"')
    assert.ok(!parseMarks(stale).some(mark => mark.id === emptyId), 'a stale registry cannot invent a trailing empty Mark')
  }
})

test('registered empty Marks still reject overlap, interior single-newline gaps, missing newline and orphan records', () => {
  for (const [body, offset, orphan] of [['Alpha\n\nBeta', 6, false], ['Alpha\n', 2, false], ['Alpha', 5, false], ['Alpha\n', 6, true]] as const) {
    const document = readMarkDocument(ensureMarkDocument(body)), extra = { id: crypto.randomUUID(), type: 'empty', from: offset, to: offset, raw: '', before: body.slice(0, offset), after: body.slice(offset), style: {}, orphan }
    const source = body + '\n\n<!-- oops:marks ' + JSON.stringify({ ...document.metadata, marks: [...document.metadata!.marks, extra] }) + ' -->'
    assert.ok(!parseMarks(source).some(mark => mark.id === extra.id), JSON.stringify({ body, offset, orphan }))
  }
})
