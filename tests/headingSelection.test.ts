import test from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { richExtensions } from '../src/renderer/richExtensions'
import { importMarkdown } from '../src/shared/richMarkdown'
import { richHeadingIndex, richHeadingPositions, sourceHeadingIndex, sourceHeadingList } from '../src/renderer/headingSelection'

const schema = getSchema(richExtensions(() => ({ path: 'document.md', onExternal() {}, onNavigate() {} }), () => {}, () => {}, () => {}))
const body = 'Introduction\n\n# First\n\n> Lead\n>\n> ## Inside quote\n>\n> Body\n\n- Item\n\n  ### Inside list\n\n  Content\n\n# Last\n\nTail'

test('heading selection follows actual nested heading positions instead of root Mark starts', () => {
  const doc = schema.nodeFromJSON(importMarkdown(body).doc), positions = richHeadingPositions(doc)
  assert.equal(positions.length, 4)
  assert.equal(richHeadingIndex(doc, 1), null)
  positions.forEach((position, index) => {
    assert.equal(richHeadingIndex(doc, position + 1), index)
    if (index > 0) assert.equal(richHeadingIndex(doc, position - 1), index - 1)
  })
  assert.equal(richHeadingIndex(doc, doc.content.size), 3)
  assert.equal(richHeadingPositions(doc), positions)
})

test('source heading selection uses cursor line and matches nested heading document order', () => {
  const headings = sourceHeadingList(body)
  assert.deepEqual(headings.map(heading => heading.text), ['First', 'Inside quote', 'Inside list', 'Last'])
  assert.equal(sourceHeadingIndex(body, 0), null)
  for (const [index, heading] of headings.entries()) {
    const from = body.split('\n').slice(0, heading.line - 1).reduce((sum, line) => sum + line.length + 1, 0)
    assert.equal(sourceHeadingIndex(body, from), index)
    assert.equal(sourceHeadingIndex(body, from - 1), index ? index - 1 : null)
  }
  assert.equal(sourceHeadingIndex(body, body.length), 3)
})

test('CRLF, setext headings and heading-like code preserve correct source ordinals', () => {
  const source = 'intro\r\n\r\nTitle\r\n=====\r\n\r\n```md\r\n# code\r\n```\r\n\r\n## End'
  assert.deepEqual(sourceHeadingList(source).map(heading => heading.text), ['Title', 'End'])
  assert.equal(sourceHeadingIndex(source, source.indexOf('# code')), 0)
  assert.equal(sourceHeadingIndex(source, source.indexOf('## End')), 1)
  const doc = schema.nodeFromJSON(importMarkdown('plain text').doc)
  assert.equal(richHeadingIndex(doc, 2), null)
  assert.equal(sourceHeadingIndex('plain text', 2), null)
})
