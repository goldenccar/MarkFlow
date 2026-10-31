import test from 'node:test'
import assert from 'node:assert/strict'
import { getSchema, type JSONContent } from '@tiptap/core'
import { importMarkdown, exportMarkdown, exportMarkdownWithMap } from '../src/shared/richMarkdown'
import { richExtensions, cleanPastedMarkSlice } from '../src/renderer/richExtensions'
import { ensureMarkDocument, parseMarks, readMarkDocument, setMarkStyle } from '../src/shared/marks'
import { Fragment, Slice } from '@tiptap/pm/model'
import { parseBlocks } from '../src/shared/blocks'

const schema = getSchema(richExtensions(() => ({ path: 'doc.md', onExternal() {}, onNavigate() {} }), () => {}, () => {}, () => {}))
const normalize = (doc: JSONContent) => { const node = schema.nodeFromJSON(doc); node.check(); return node.toJSON() as JSONContent }
const body = (source: string) => readMarkDocument(source).body
const sample = '# 标题\r\n\r\nA **strong** and *italic* ~~gone~~ [reference][ref].\r\n\r\n- [x] done\r\n- [ ] next\r\n  - nested\r\n\r\n| left | right |\r\n| :--- | ---: |\r\n| one | two |\r\n\r\n> quoted\r\n> text\r\n\r\n```js meta=value\r\nconst x = 1\r\n```\r\n\r\n$$\r\nx^2 + y^2\r\n$$\r\n\r\nInline $a+b$ and ![alt](images/a.png "title").\r\n\r\n<!-- comment exactly -->\r\n\r\n<div class="x">untouched</div>\r\n\r\n[ref]: other.md "reference title"\r\n\r\n[^note]: footnote\r\n\r\nFootnote[^note].\r\n\r\n'

test('rich schema preserves original CommonMark/GFM/math/opaque source bytes without editing', () => {
  for (const source of [sample, '', '\r\n  \r\n', 'plain\n', 'one\n\n\n\nsecond\n\n', '1) one\n2) two\n', '>\n', '- \n', '1. \n', '> -\n', '<u>under</u> <sup>2</sup> <sub>x</sub> <mark>marked</mark>']) {
    const base = importMarkdown(source)
    assert.equal(exportMarkdown(normalize(base.doc), base), source)
  }
})

test('editing one paragraph retains every other block, comments and exact CRLF gaps', () => {
  const base = importMarkdown(sample), doc = normalize(base.doc)
  doc.content![1].content!.unshift({ type: 'text', text: 'NEW ' })
  const result = body(exportMarkdown(doc, base))
  assert.ok(result.startsWith('# 标题\r\n\r\nNEW A **strong**'))
  assert.equal(result.slice(result.indexOf('\r\n\r\n- [x]')), sample.slice(sample.indexOf('\r\n\r\n- [x]')))
  assert.ok(result.includes('[reference][ref]'))
})

test('reused list ranges never reuse IDs/styles and invalidate when list Markdown changes', () => {
  const source = ensureMarkDocument('- First\n- Second\n\nTail'), base = importMarkdown(source), doc = normalize(base.doc)
  const first = exportMarkdownWithMap(doc, base), originalItems = first.marks.filter(mark => mark.itemIndex !== undefined)
  doc.content!.at(-1)!.content![0].text = 'Changed tail'
  const second = exportMarkdownWithMap(doc, base, first.source)
  assert.deepEqual(second.marks.filter(mark => mark.itemIndex !== undefined), originalItems)
  doc.content![0].content![0].attrs!.markId = 'new-copied-mark'
  doc.content![0].content![0].attrs!.markFontSize = 24
  const third = exportMarkdownWithMap(doc, base, second.source), copied = third.marks.find(mark => mark.itemIndex === 0)!
  assert.equal(copied.id, 'new-copied-mark'); assert.equal(copied.style?.fontSize, 24)
  assert.equal(parseMarks(third.source)[0].id, 'new-copied-mark')
  doc.content![0].content![0].content![0].content![0].text = 'Longer first item'
  const fourth = exportMarkdownWithMap(doc, base, third.source), items = fourth.marks.filter(mark => mark.itemIndex !== undefined)
  assert.equal(body(fourth.source).slice(items[0].from, items[0].to), '- Longer first item')
  assert.equal(body(fourth.source).slice(items[1].from, items[1].to), '- Second')
  assert.notEqual(items[1].from, originalItems[1].from)
})

test('rich Enter/ShiftEnter produce new paragraphs and Markdown hard breaks without dropping empty blocks', () => {
  const base = importMarkdown('Alpha'), doc = normalize(base.doc)
  doc.content!.push({ type: 'paragraph', content: [] })
  assert.equal(body(exportMarkdown(doc, base)), 'Alpha\n\n')
  doc.content![1].content = [{ type: 'text', text: 'Beta' }, { type: 'hardBreak' }, { type: 'text', text: 'Gamma' }]
  assert.equal(body(exportMarkdown(doc, base)), 'Alpha\n\nBeta\\\nGamma')
  doc.content!.push({ type: 'paragraph', content: [] }, { type: 'paragraph', content: [] })
  assert.equal(body(exportMarkdown(doc, base)), 'Alpha\n\nBeta\\\nGamma\n\n\n\n')
})

test('generated list ranges match the parser for nested, loose, task, empty and opaque content', () => {
  const cases = [
    '  * first  \n  * second\n', '9) nine\n10) ten', '- [ ] plain\n- [x] done\n- mixed',
    '- first\n\n  second paragraph\n\n- second', '- first\n  - nested\n    - nested again\n- end',
    '- first\n  > quoted\n  > next\n- last', '- first\n\n  ```js\n  - content\n  ```\n- last',
    '- first\n- <unknown>keep\n- raw</unknown>', '- first\n  - child <x>raw</x>\n- last', '- first\n- second\\\n  continued', '- first\n-',
    '- first\n- <u>under</u>', '- first\n- second\n\n  $$\n  x^2\n  $$', '- first\n- second\n\n  ---\n',
    '- first\n- [reference][ref]\n\n[ref]: destination', '- first\n- ![alt](a.png)',
  ]
  for (const eol of ['\n', '\r\n']) for (const raw of cases) {
    const source = ensureMarkDocument(raw.replaceAll('\n', eol)), base = importMarkdown(source), doc = normalize(base.doc)
    doc.content![0].content![0].content![0].content![0].text += ' changed'
    const output = exportMarkdownWithMap(doc, base)
    assert.deepEqual(output.marks.map(({ from, to, type }) => ({ from, to, type })), parseBlocks(body(output.source)).map(({ from, to, type }) => ({ from, to, type })), raw)
    assert.deepEqual(parseMarks(output.source).map(mark => mark.id), parseMarks(source).map(mark => mark.id), raw)
  }
  for (const text of ['space ', 'tab\t', 'newline\n', '\u3000', 'trailing\u00a0', '- literal\n+ next\n10. value\n# heading']) {
    const base = importMarkdown('- first\n- last'), doc = normalize(base.doc)
    doc.content![0].content![1].content![0].content![0].text = text
    const output = exportMarkdownWithMap(doc, base)
    assert.deepEqual(output.marks.map(({ from, to }) => ({ from, to })), parseBlocks(body(output.source)).map(({ from, to }) => ({ from, to })))
  }
})

test('shared syntax never carries identities or content across changed documents', () => {
  const raw = '# First\n\n- repeated\n- repeated', first = importMarkdown(ensureMarkDocument(raw))
  const second = importMarkdown(ensureMarkDocument(raw)), changed = importMarkdown('# Second\n\n- changed\n- repeated')
  assert.equal(first.source, raw); assert.equal(second.source, raw)
  assert.notDeepEqual(first.markMappings.map(mark => mark.id), second.markMappings.map(mark => mark.id))
  assert.equal(changed.doc.content![0].content![0].text, 'Second')
  parseBlocks('x'.repeat(70_000))
  assert.equal(importMarkdown(first.identitySource).source, raw)
  assert.equal(exportMarkdown(normalize(first.doc), first), first.originalSource)
})

test('first typing in an empty document and trailing empty paragraphs is safe and lossless', () => {
  for (const source of ['', '\r\n \r\n', 'before\n\n\n\n']) {
    const base = importMarkdown(source), doc = normalize(base.doc)
    doc.content!.at(-1)!.content = [{ type: 'text', text: 'new' }]
    assert.equal(body(exportMarkdown(doc, base)), source + 'new')
  }
})

test('all seven toolbar marks survive saving and reopening as rich marks', () => {
  for (const type of ['bold', 'italic', 'strike', 'underline', 'superscript', 'subscript', 'highlight']) {
    const base = importMarkdown('Hello'), doc = normalize(base.doc)
    doc.content![0].content![0].marks = [{ type }]
    const markdown = exportMarkdown(doc, base), reopened = normalize(importMarkdown(markdown).doc)
    assert.equal(reopened.content![0].content![0].text, 'Hello')
    assert.ok(reopened.content![0].content![0].marks?.some(mark => mark.type === type), `${type}: ${markdown}`)
  }
})

test('editing code, table, task list and math maintains valid structured content and untouched opaque nodes', () => {
  const base = importMarkdown(sample), doc = normalize(base.doc)
  const code = doc.content!.find(node => node.type === 'codeBlock')!; code.content![0].text += '\nconsole.log(x)'
  doc.content!.find(node => node.type === 'mathBlock')!.attrs!.latex = 'x^3'
  doc.content!.find(node => node.type === 'taskList')!.content![1].attrs!.checked = true
  doc.content!.find(node => node.type === 'table')!.content![1].content![0].content![0].content![0].text = 'changed'
  const output = exportMarkdown(doc, base), reparsed = normalize(importMarkdown(output).doc)
  assert.ok(output.includes('```js meta=value\r\nconst x = 1\r\nconsole.log(x)\r\n```'))
  assert.ok(output.includes('- [x] next'))
  assert.ok(output.includes('<!-- comment exactly -->\r\n\r\n<div class="x">untouched</div>'))
  assert.equal(reparsed.content!.find(node => node.type === 'mathBlock')!.attrs!.latex, 'x^3')
  assert.ok(JSON.stringify(reparsed).includes('changed'))
})

test('adjacent edits retain unsupported inline HTML and unknown block bytes', () => {
  const source = 'Before <custom flag="x">raw</custom> after.\n\n<!-- a\n b -->\n\n<div>private</div>\n'
  const base = importMarkdown(source), doc = normalize(base.doc)
  doc.content![0].content!.unshift({ type: 'text', text: 'EDIT ' })
  assert.equal(body(exportMarkdown(doc, base)), 'EDIT ' + source)
})

test('malformed formatting and multiline opaque inline HTML retain their exact payload on nearby edits', () => {
  for (const source of ['before </u> text <u>unclosed\n', 'before <custom\r\n flag="yes">text</custom> after\r\n']) {
    const base = importMarkdown(source), doc = normalize(base.doc)
    doc.content![0].content!.unshift({ type: 'text', text: 'EDIT ' })
    assert.equal(body(exportMarkdown(doc, base)), 'EDIT ' + source)
  }
})

test('node insertion and deletion keep surviving raw blocks and correct separators', () => {
  const base = importMarkdown('first\n\n<!-- keep -->\n\nlast\n'), doc = normalize(base.doc)
  doc.content!.splice(0, 1)
  doc.content!.splice(1, 0, { type: 'paragraph', content: [{ type: 'text', text: 'new' }] })
  assert.equal(body(exportMarkdown(doc, base)), '<!-- keep -->\n\nnew\n\nlast\n')
})

test('per-Mark typography remains outside the body and survives rich edits with exact identities', () => {
  const body = '# Heading\r\n\r\nFirst **paragraph**.\r\n\r\nSecond paragraph.\r\n\r\n- first item\r\n- second item\r\n\r\n<!-- untouched -->\r\n'
  let source = setMarkStyle(body, body.indexOf('First'), { fontFamily: 'fangsong', fontSize: 24 })
  source = setMarkStyle(source, body.indexOf('- second'), { fontFamily: 'kaiti', fontSize: 20 })
  const base = importMarkdown(source), doc = normalize(base.doc), firstId = parseMarks(source)[1].id, itemId = parseMarks(source)[4].id
  assert.equal(base.source, body)
  assert.equal(doc.content!.some(node => node.attrs?.raw?.includes('oops:marks')), false)
  assert.equal(exportMarkdown(doc, base), source)
  assert.equal(doc.content![1].attrs!.markFontSize, 24)
  assert.equal(doc.content![3].content![1].attrs!.markId, itemId)
  doc.content![1].content!.unshift({ type: 'text', text: 'Edited ' })
  doc.content![3].content![1].content![0].content![0].text = 'edited item'
  const output = exportMarkdown(doc, base), marks = parseMarks(output)
  assert.equal(marks[1].id, firstId); assert.equal(marks[1].style.fontSize, 24)
  assert.equal(marks[4].id, itemId); assert.equal(marks[4].style.fontFamily, 'kaiti')
  assert.ok(readMarkDocument(output).body.endsWith('<!-- untouched -->\r\n'))
  assert.deepEqual(marks[2].style, {})
  assert.equal(exportMarkdown(normalize(importMarkdown(output).doc), importMarkdown(output)), output)
})

test('split and removed rich Marks preserve only authoritative surviving styles', () => {
  const source = setMarkStyle('AlphaBeta\n\nOther', 0, { fontSize: 26 }), base = importMarkdown(source), doc = normalize(base.doc)
  const id = doc.content![0].attrs!.markId
  doc.content![0].content = [{ type: 'text', text: 'Alpha' }]
  doc.content!.splice(1, 0, { type: 'paragraph', content: [{ type: 'text', text: 'Beta' }] })
  let result = exportMarkdown(doc, base), marks = parseMarks(result)
  assert.equal(marks[0].id, id); assert.equal(marks[0].style.fontSize, 26); assert.deepEqual(marks[1].style, {})
  doc.content!.shift()
  result = exportMarkdown(doc, base)
  assert.equal(parseMarks(result).some(mark => mark.explicit), false)
  assert.ok(readMarkDocument(result).metadata?.retiredIds?.includes(id))
  assert.equal(readMarkDocument(result).metadata?.marks.some(mark => mark.id === id), false)
  const recreated = normalize(base.doc)
  recreated.content![0].attrs!.markId = null; recreated.content![0].attrs!.markFontSize = null
  const sameText = exportMarkdown(recreated, base)
  assert.equal(readMarkDocument(sameText).body, readMarkDocument(source).body)
  assert.equal(parseMarks(sameText)[0].explicit, false, 'manually retyped identical text does not resurrect deleted identity')
})

test('empty styled Mark becomes typed paragraph without losing identity or neighboring bytes', () => {
  for (const body of ['', 'Before\n\n']) {
    const source = setMarkStyle(body, body.length, { fontSize: 22 }), base = importMarkdown(source), doc = normalize(base.doc)
    const id = parseMarks(source).at(-1)!.id
    doc.content!.at(-1)!.content = [{ type: 'text', text: 'Typed' }]
    const result = exportMarkdown(doc, base)
    assert.equal(readMarkDocument(result).body, body + 'Typed')
    assert.equal(parseMarks(result).at(-1)!.id, id)
    assert.equal(parseMarks(result).at(-1)!.style.fontSize, 22)
  }
})

test('pasting a styled Mark before its original keeps its appearance with a fresh identity', () => {
  const source = setMarkStyle('**Original**\n\nAfter', 0, { fontFamily: 'fangsong', fontSize: 24 }), base = importMarkdown(source)
  const original = schema.nodeFromJSON(base.doc).firstChild!, id = original.attrs.markId
  const copy = cleanPastedMarkSlice(new Slice(Fragment.from(original), 0, 0)).content.firstChild!
  assert.notEqual(copy.attrs.markId, id); assert.match(copy.attrs.markId, /^[\da-f-]{36}$/); assert.equal(copy.attrs.markFontSize, 24); assert.equal(copy.attrs.sourceId, null)
  assert.equal(copy.firstChild!.marks[0].type.name, 'bold')
  const doc = normalize(base.doc); doc.content!.unshift(copy.toJSON())
  const result = exportMarkdown(doc, base), marks = parseMarks(result)
  assert.equal(marks[0].id, copy.attrs.markId); assert.equal(marks[0].style.fontSize, 24); assert.equal(marks[1].id, id); assert.equal(marks[1].style.fontSize, 24)
  const partial = cleanPastedMarkSlice(new Slice(Fragment.from(original), 1, 1))
  assert.equal(partial.openStart, 1); assert.equal(partial.openEnd, 1)
})

test('rich mappings supply current Markdown types and retain fallback for changed opaque payloads', () => {
  let source = 'Paragraph\n\n<!-- unchanged -->\n\n[ref]: other.md\n\n[^note]: note'
  for (const at of [source.indexOf('Paragraph'), source.indexOf('<!--'), source.indexOf('[ref]'), source.indexOf('[^note]')]) source = setMarkStyle(source, at, { fontSize: 24 })
  const base = importMarkdown(source), doc = normalize(base.doc), id = parseMarks(source)[0].id
  doc.content![0] = { ...doc.content![0], type: 'heading', attrs: { ...doc.content![0].attrs, level: 2 }, content: [{ type: 'text', text: 'Changed heading' }] }
  const output = exportMarkdownWithMap(doc, base)
  assert.deepEqual(output.marks.map(mark => mark.type), ['heading', 'html', 'definition', 'footnoteDefinition'])
  assert.equal(readMarkDocument(output.source).metadata!.marks.find(mark => mark.id === id)!.type, 'heading')
  assert.equal(parseMarks(output.source)[0].id, id)
  doc.content![1].attrs!.raw = 'raw text instead of the original comment'
  const uncertain = exportMarkdownWithMap(doc, base)
  assert.equal(uncertain.marks[1].type, 'paragraph')
  assert.equal(parseMarks(uncertain.source)[1].type, 'paragraph')
  assert.equal(parseMarks(uncertain.source)[1].style.fontSize, 24)
})

test('edited literal, formula, table and list item mappings keep their Markdown semantic types', () => {
  const cases: Array<[string, string, (node: JSONContent) => void]> = [
    ['```js\none\n```', 'code', node => { node.content![0].text = 'two' }],
    ['$$\nx^2\n$$', 'math', node => { node.attrs!.latex = 'x^3' }],
    ['> quote', 'blockquote', node => { node.content![0].content![0].text = 'changed' }],
    ['| A |\n| - |\n| B |', 'table', node => { node.content![1].content![0].content![0].content![0].text = 'C' }],
    ['- one\n- two', 'listItem', node => { node.content![0].content![0].content![0].text = 'changed' }],
  ]
  for (const [body, type, edit] of cases) {
    const source = setMarkStyle(body, 0, { fontSize: 22 }), base = importMarkdown(source), doc = normalize(base.doc)
    edit(doc.content![0])
    const output = exportMarkdownWithMap(doc, base)
    assert.equal(output.marks[0].type, type)
    assert.equal(readMarkDocument(output.source).metadata!.marks[0].type, type)
    assert.equal(parseMarks(output.source)[0].style.fontSize, 22)
  }
})

test('all rich Marks, including consecutive interior and leading empties, survive repeated reopen exactly', () => {
  const source = ensureMarkDocument('First\n\nLast'), base = importMarkdown(source), doc = normalize(base.doc)
  doc.content!.splice(1, 0, { type: 'paragraph' }, { type: 'paragraph' })
  doc.content!.unshift({ type: 'paragraph' })
  let result = exportMarkdown(doc, base)
  assert.equal(body(result), '\n\nFirst\n\n\n\n\n\nLast')
  const ids = parseMarks(result).map(mark => mark.id)
  assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5)
  for (let pass = 0; pass < 3; pass++) {
    const reopened = importMarkdown(result), normalized = normalize(reopened.doc)
    assert.equal(normalized.content!.length, 5)
    assert.deepEqual(normalized.content!.map(node => node.attrs!.markId), ids)
    assert.equal(exportMarkdown(normalized, reopened), result)
    result = exportMarkdown(normalized, reopened)
  }
})

test('successive rich edits reconcile against current identity state and never revive deleted newly created Marks', () => {
  const source = ensureMarkDocument('First'), base = importMarkdown(source), doc = normalize(base.doc)
  doc.content!.push({ type: 'paragraph', content: [{ type: 'text', text: 'New' }] })
  const added = exportMarkdownWithMap(doc, base, source), addedId = parseMarks(added.source)[1].id
  doc.content!.pop()
  const deleted = exportMarkdownWithMap(doc, base, added.source)
  assert.ok(readMarkDocument(deleted.source).metadata!.retiredIds!.includes(addedId))
  doc.content!.push({ type: 'paragraph', content: [{ type: 'text', text: 'New' }] })
  const recreated = exportMarkdownWithMap(doc, base, deleted.source)
  assert.notEqual(parseMarks(recreated.source)[1].id, addedId)
  assert.equal(readMarkDocument(recreated.source).metadata!.marks.length, 2)
})

test('moving semantically equal rich paragraphs moves their distinct raw syntax with their IDs', () => {
  const source = ensureMarkDocument('**Same**\n\n__Same__'), base = importMarkdown(source), doc = normalize(base.doc), ids = parseMarks(source).map(mark => mark.id)
  doc.content!.reverse()
  const result = exportMarkdown(doc, base)
  assert.equal(body(result), '__Same__\n\n**Same**')
  assert.deepEqual(parseMarks(result).map(mark => mark.id), ids.reverse())
})
