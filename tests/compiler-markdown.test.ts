import test from 'node:test'
import assert from 'node:assert/strict'
import { markdownToDocument } from '../src/compiler/markdown'
import { CompilationError } from '../src/compiler/diagnostics'
import { normalizeDocument } from '../src/compiler/model'
import { ensureMarkDocument, parseMarks, readMarkDocument, setMarkStyle } from '../src/shared/marks'
import type { Diagnostic, SemanticContent } from '../src/compiler/types'

const text = (content: SemanticContent) => 'runs' in content ? content.runs.map(run => run.text).join('') : ''
function errorFrom(source: string): Diagnostic {
  try { markdownToDocument(source, 'notes/example.md'); assert.fail('Expected a compilation error') }
  catch (error) { assert.ok(error instanceof CompilationError); const diagnostic = error.diagnostics.find(item => item.severity === 'error'); assert.ok(diagnostic); return diagnostic }
}

test('registered document preserves its revision, every visible/definition ID and manual typography without rewriting the source', () => {
  const body = '# Title\n\n[Visit][site]\n\n[site]: https://example.org'
  const source = setMarkStyle(ensureMarkDocument(body), body.indexOf('[Visit]'), { fontFamily: 'fangsong', fontSize: 24 })
  const before = source, registered = readMarkDocument(source).metadata!, ids = parseMarks(source).map(mark => mark.id)
  const { document, diagnostics } = markdownToDocument(source, 'notes/example.md')
  assert.equal(source, before)
  assert.equal(document.documentId, registered.documentId)
  assert.equal(document.revision, registered.revision)
  assert.deepEqual([...document.marks.map(mark => mark.id), ...document.consumedSources!.map(mark => mark.id)], ids)
  assert.deepEqual(document.marks[1].style, { fontFamily: 'FangSong', fontSize: 24 })
  assert.equal(document.marks[1].source!.from, body.indexOf('[Visit]'))
  assert.equal(diagnostics.length, 0)
})

test('plain Markdown has repeatable snapshot-only identity and an explicit warning', () => {
  const source = '# Repeat\n\ntext'
  const first = markdownToDocument(source, 'same.md'), again = markdownToDocument(source, 'same.md')
  assert.deepEqual(first, again)
  assert.equal(first.document.revision, 0)
  assert.equal(first.diagnostics[0].code, 'MARKDOWN_TEMPORARY_IDENTITIES')
  assert.notEqual(first.document.documentId, markdownToDocument(source, 'other.md').document.documentId)
  assert.notEqual(first.document.marks[1].id, markdownToDocument(source + '!', 'same.md').document.marks[1].id)
  assert.equal(readMarkDocument(source).metadata, null)
})

test('common inline formats, hard breaks and safe HTTP links become text runs', () => {
  const source = 'plain **bold** *italic* ~~strike~~ <u>under **both**</u> <sup>2</sup> <sub>n</sub> <mark>lit</mark> [web](https://example.org)  \nnext\nsoft'
  const { document } = markdownToDocument(source, 'inline.md'), content = document.marks[0].content
  assert.equal(content.kind, 'paragraph'); if (content.kind !== 'paragraph') return
  assert.equal(text(content), 'plain bold italic strike under both 2 n lit web\nnext soft')
  for (const [word, expected] of [['bold', { bold: true }], ['italic', { italic: true }], ['strike', { strike: true }], ['both', { underline: true, bold: true }], ['2', { script: 'superscript' }], ['n', { script: 'subscript' }], ['lit', { highlight: '#fff2a8' }], ['web', { link: 'https://example.org' }]] as const) assert.deepEqual(content.runs.find(run => run.text === word)?.format, expected)
})

test('simple ordered/unordered lists and rectangular GFM tables keep their semantics', () => {
  const { document } = markdownToDocument('3. third\n4. fourth\n\n- first\n- second\n\n| A | B |\n| --- | --- |\n| **one** | two |', 'table.md')
  const [third, fourth, first, second, table] = document.marks.map(mark => mark.content)
  assert.deepEqual(third, { kind: 'list-item', ordered: true, ordinal: 3, runs: [{ text: 'third' }] })
  assert.equal(fourth.kind === 'list-item' && fourth.ordinal, 4)
  assert.equal(first.kind === 'list-item' && first.ordered, false)
  assert.equal(text(second), 'second')
  assert.equal(table.kind, 'table'); if (table.kind !== 'table') return
  assert.equal(table.header, true)
  assert.deepEqual(table.rows[1][0], [{ text: 'one', format: { bold: true } }])
})

test('reference links and images resolve definitions; assets remain relative and no file is read', () => {
  const source = '![Picture][IMAGE]\n\n[More][site]\n\n[image]: ./assets/../images/a%20b.png "A caption"\n[site]: https://example.org/path'
  const { document } = markdownToDocument(source, 'docs/ref.md')
  assert.equal(document.assets.length, 1)
  assert.equal(document.assets[0].path, 'images/a b.png')
  assert.deepEqual(document.marks[0].content, { kind: 'image', assetId: document.assets[0].id, alt: 'Picture', caption: 'A caption' })
  assert.equal(document.consumedSources?.length, 2)
  assert.deepEqual(document.marks[1].content, { kind: 'paragraph', runs: [{ text: 'More', format: { link: 'https://example.org/path' } }] })
  assert.equal(markdownToDocument('![x](../outside.png)', 'docs/ref.md').document.assets[0].path, '../outside.png')
})

test('BOM and CRLF source locations stay in original UTF-16 units while LF registry IDs survive', () => {
  const body = '😀中文\n\n# Heading\n\nline one\nline two'
  const saved = ensureMarkDocument(body), source = '\uFEFF' + saved.replaceAll('\n', '\r\n')
  const { document } = markdownToDocument(source, 'bom.md')
  assert.deepEqual(document.marks.map(mark => mark.id), parseMarks(saved).map(mark => mark.id))
  assert.deepEqual(document.marks[0].source, { file: 'bom.md', from: 1, to: 5, line: 1, column: 2 })
  assert.equal(document.marks[1].source!.from, source.indexOf('# Heading'))
  assert.equal(document.marks[1].source!.line, 3)
  assert.equal(document.marks[1].source!.column, 1)
  assert.equal(source.slice(document.marks[2].source!.from, document.marks[2].source!.to), 'line one\r\nline two')
  const crlfRegistered = ensureMarkDocument(body.replaceAll('\n', '\r\n'))
  assert.deepEqual(markdownToDocument(crlfRegistered, 'original-crlf.md').document.marks.map(mark => mark.id), parseMarks(crlfRegistered).map(mark => mark.id))
})

test('registered empty paragraphs and tombstone IDs are retained', () => {
  const source = ensureMarkDocument('paragraph\n\n')
  const { document } = markdownToDocument(source, 'blank.md')
  assert.deepEqual(document.marks.map(mark => mark.id), parseMarks(source).map(mark => mark.id))
  assert.deepEqual(document.marks.at(-1)!.content, { kind: 'paragraph', runs: [] })
  assert.deepEqual(document.retiredIds, [])
})

test('unsupported block and inline structures fail with the owning Mark and exact source line', () => {
  for (const unsupported of ['```js\nalert(1)\n```', '$$\nx+y\n$$', '> quote', '<div>HTML</div>', '- outer\n  - inner', '- [ ] task', 'text ![mixed](a.png)', '`inline code`', '$x$']) {
    const source = 'ok\r\n\r\n' + unsupported, diagnostic = errorFrom(source)
    assert.equal(diagnostic.source!.file, 'notes/example.md')
    assert.equal(diagnostic.source!.line, 3, unsupported)
    assert.ok(diagnostic.markId)
    assert.ok(diagnostic.code.startsWith('MARKDOWN_UNSUPPORTED'))
  }
})

test('unbalanced/attributed HTML, unsafe links and remote assets cannot pass through', () => {
  for (const source of ['<u>open', '<u>x</sup>', '<u class="x">x</u>', '<script>alert(1)</script>']) assert.match(errorFrom(source).code, /UNSUPPORTED/)
  for (const source of ['[x](javascript:alert)', '[x](file:///private)', '[x](https://user:secret@example.org)', '[x](mailto:a@example.org)']) assert.equal(errorFrom(source).code, 'MARKDOWN_UNSAFE_LINK')
  for (const source of ['![x](https://example.org/a.png)', '![x](data:image/png;base64,AA)', '![x](a%ZZ.png)', '![x](a.png#fragment)']) assert.equal(errorFrom(source).code, 'MARKDOWN_ASSET_PATH_INVALID')
})

test('invalid or unmatched metadata is rejected rather than silently creating new registered identities', () => {
  assert.equal(errorFrom('text\n\n<!-- oops:marks {"v":2,"marks":[]} -->').code, 'MARKDOWN_METADATA_INVALID')
  assert.equal(errorFrom('text\n\n<!-- oops:marks not-json -->').source!.line, 3)
  const saved = ensureMarkDocument('original paragraph')
  assert.equal(errorFrom(saved.replace('original paragraph', 'different paragraph')).code, 'MARKDOWN_METADATA_MISMATCH')
})

test('unsupported table alignment or ragged rows are not silently flattened', () => {
  assert.equal(errorFrom('| A | B |\n| :--- | ---: |\n| one | two |').code, 'MARKDOWN_UNSUPPORTED_TABLE')
  assert.equal(errorFrom('| A | B |\n| --- | --- |\n| one | two | three |').code, 'MARKDOWN_UNSUPPORTED_TABLE')
})

test('system font is an explicit fixed compiler family with a diagnostic', () => {
  const { document, diagnostics } = markdownToDocument(setMarkStyle(ensureMarkDocument('text'), 0, { fontFamily: 'system', fontSize: 18 }), 'font.md')
  assert.deepEqual(document.marks[0].style, { fontFamily: 'Microsoft YaHei', fontSize: 18 })
  assert.equal(diagnostics[0].code, 'MARKDOWN_SYSTEM_FONT_FIXED')
})

test('complete Markdown output passes the independent semantic model boundary', () => {
  const source = ensureMarkDocument('# Title\n\n**body** [link][url]\n\n1. item\n\n![asset](images/photo.png)\n\n| A | B |\n| --- | --- |\n| one | two |\n\n[url]: https://example.org')
  const { document } = markdownToDocument(source, 'model.md'), normalized = normalizeDocument(document)
  assert.equal(normalized.documentId, document.documentId)
  assert.equal(normalized.snapshot.revision, document.revision)
  assert.deepEqual(normalized.snapshot.roots.map(mark => mark.id), document.marks.map(mark => mark.id))
  assert.deepEqual(normalized.consumedSources, document.consumedSources)
})

test('invalid text and unsupported zero-based list numbering fail before producing lossy semantic input', () => {
  for (const source of ['ok\n\ntext\0end', 'text\ud800']) assert.equal(errorFrom(source).code, 'MARKDOWN_INVALID_TEXT')
  assert.equal(errorFrom('ok\n\ntext\0end').source!.line, 3)
  assert.equal(errorFrom('0. zero').code, 'MARKDOWN_UNSUPPORTED_LIST')
  assert.equal(errorFrom('[label](https://example.org "tooltip")').code, 'MARKDOWN_UNSUPPORTED_LINK_TITLE')
})
