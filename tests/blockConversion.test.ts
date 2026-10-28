import test from 'node:test'
import assert from 'node:assert/strict'
import { convertMarkdownBlock, blockConversionReason, blockFormats } from '../src/renderer/blockConversion'
import { getSchema } from '@tiptap/core'
import { richExtensions } from '../src/renderer/richExtensions'
import { ensureMarkDocument, parseMarks, readMarkDocument, setMarkStyle } from '../src/shared/marks'
import { importMarkdown } from '../src/shared/richMarkdown'
import { EditHistory } from '../src/renderer/editHistory'

test('block conversions retain identity and typography and preserve unrelated source bytes', () => {
  const source = setMarkStyle('Title **bold**\r\n\r\nOther _emphasis_\r\n', 0, { fontSize: 24 }), id = parseMarks(source)[0].id
  const heading = convertMarkdownBlock(source, id, 'heading2').value
  assert.equal(readMarkDocument(heading).body, '## Title **bold**\r\n\r\nOther _emphasis_\r\n')
  assert.equal(parseMarks(heading)[0].id, id)
  assert.equal(parseMarks(heading)[0].style.fontSize, 24)
  const code = convertMarkdownBlock(heading, id, 'codeBlock').value
  assert.match(readMarkDocument(code).body, /^```\r\nTitle \*\*bold\*\*\r\n```/)
  const paragraph = convertMarkdownBlock(heading, id, 'paragraph').value
  assert.equal(readMarkDocument(paragraph).body, readMarkDocument(source).body)
  const history = new EditHistory({ value: source, cursor: 0 })
  history.boundary(); history.change({ value: heading, cursor: 0 }); history.boundary()
  assert.equal(history.undo()!.value, source)
  assert.equal(history.redo()!.value, heading)
})

test('converting one list item leaves sibling identities and ordered numbering intact', () => {
  const source = ensureMarkDocument('3. Before\n4. Target\n5. After\n\nTail'), marks = parseMarks(source)
  const result = convertMarkdownBlock(source, marks[1].id, 'heading1').value
  assert.equal(readMarkDocument(result).body, '3. Before\n\n# Target\n\n5. After\n\nTail')
  assert.deepEqual(parseMarks(result).map(mark => mark.id), marks.map(mark => mark.id))
})

test('nested lists reject lossy heading conversion and retain all children as a quote or code', () => {
  const source = ensureMarkDocument('- Parent\n  - child\n    - grandchild\n- Sibling'), id = parseMarks(source)[0].id
  const node = importMarkdown(source).doc.content![0].content![0]
  assert.match(blockConversionReason(node, 'heading1')!, /子块/)
  assert.throws(() => convertMarkdownBlock(source, id, 'heading1'), /子块/)
  const quote = convertMarkdownBlock(source, id, 'blockquote').value
  assert.match(readMarkDocument(quote).body, /> Parent\n>\n> - child\n>   - grandchild/)
  assert.equal(parseMarks(quote)[0].id, id)
  const code = convertMarkdownBlock(source, id, 'codeBlock').value
  assert.match(readMarkDocument(code).body, /```\nParent\n\n- child\n  - grandchild\n```/)
  assert.match(readMarkDocument(code).body, /- Sibling$/)
})

test('code conversion preserves links, images and math as literal Markdown', () => {
  const source = ensureMarkDocument('[link](https://example.com) ![picture](a.png) $x^2$'), id = parseMarks(source)[0].id
  const code = convertMarkdownBlock(source, id, 'codeBlock').value
  assert.equal(readMarkDocument(code).body, '```\n[link](https://example.com) ![picture](a.png) $x^2$\n```')
  const paragraph = convertMarkdownBlock(code, id, 'paragraph').value
  const node = importMarkdown(paragraph).doc.content![0]
  assert.equal(node.content!.map(child => child.text ?? '').join(''), '[link](https://example.com) ![picture](a.png) $x^2$')
})

test('list type conversion preserves nested structure and stable identities', () => {
  const source = ensureMarkDocument('- First\n  - Child\n- Second'), marks = parseMarks(source)
  const task = convertMarkdownBlock(source, marks[0].id, 'taskList').value
  assert.match(readMarkDocument(task).body, /- \[ \] First\n  - Child/)
  assert.deepEqual(parseMarks(task).map(mark => mark.id), marks.map(mark => mark.id))
  const bullets = convertMarkdownBlock(task, marks[0].id, 'bulletList').value
  assert.deepEqual(parseMarks(bullets).map(mark => mark.id), marks.map(mark => mark.id))
  assert.equal(readMarkDocument(bullets).body, readMarkDocument(source).body)
})

test('every supported format round-trips through the editor schema without dropping text or identity', () => {
  const schema = getSchema(richExtensions(() => ({ path: 'document.md', onExternal() {}, onNavigate() {} }), () => {}, () => {}, () => {}))
  for (const body of ['Alpha **beta**', '## Alpha **beta**', '- Alpha **beta**', '> Alpha **beta**', '```js\nAlpha beta\n```']) {
    const source = ensureMarkDocument(body), id = parseMarks(source)[0].id
    for (const option of blockFormats) {
      const value = convertMarkdownBlock(source, id, option.value).value, base = importMarkdown(value)
      const doc = schema.nodeFromJSON(base.doc); doc.check()
      assert.ok(doc.textContent.includes('Alpha'), `${body} to ${option.value}`)
      assert.ok(doc.textContent.includes('beta'), `${body} to ${option.value}`)
      assert.equal(parseMarks(value)[0].id, id, `${body} to ${option.value}`)
    }
  }
})

test('unsupported tables stay intact and multiline code remains text when converted to a paragraph', () => {
  const table = ensureMarkDocument('| A | B |\n| - | - |\n| x | y |'), id = parseMarks(table)[0].id
  assert.throws(() => convertMarkdownBlock(table, id, 'paragraph'), /暂不支持/)
  const code = ensureMarkDocument('```\n# literal\n- list\n```'), codeId = parseMarks(code)[0].id
  assert.throws(() => convertMarkdownBlock(code, codeId, 'heading1'), /多行/)
  const paragraph = convertMarkdownBlock(code, codeId, 'paragraph').value
  const content = importMarkdown(paragraph).doc.content![0].content!
  assert.deepEqual(content.map(child => child.type), ['text', 'hardBreak', 'text'])
  assert.equal(content.filter(child => child.type === 'text').map(child => child.text).join('\n'), '# literal\n- list')
  assert.equal(parseMarks(paragraph).length, 1)
})
