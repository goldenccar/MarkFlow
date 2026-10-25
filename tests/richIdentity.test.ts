import test from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Fragment, Slice } from '@tiptap/pm/model'
import { splitListItem } from '@tiptap/pm/schema-list'
import { createRichIdentityPlugin, richExtensions, cleanPastedMarkSlice } from '../src/renderer/richExtensions'
import { importMarkdown, exportMarkdownWithMap } from '../src/shared/richMarkdown'
import { ensureMarkDocument, parseMarks, readMarkDocument, setMarkStyle } from '../src/shared/marks'

const schema = getSchema(richExtensions(() => ({ path: 'doc.md', onExternal() {}, onNavigate() {} }), () => {}, () => {}, () => {}))
function fixture(body: string, styled = false) {
  const source = styled ? setMarkStyle(body, 0, { fontSize: 24 }) : ensureMarkDocument(body), base = importMarkdown(source), plugin = createRichIdentityPlugin()
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(base.doc), plugins: [plugin] })
  return { source, base, plugin, state }
}
test('rich Enter split at start/middle/end retains left identity and defaults the new right Mark', () => {
  for (const offset of [0, 4, 9]) {
    let { source, base, plugin, state } = fixture('LeftRight', true)
    const id = state.doc.firstChild!.attrs.markId
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, offset + 1)))
    plugin.props.handleKeyDown!.call(plugin, { state } as EditorView, { key: 'Enter', shiftKey: false } as KeyboardEvent)
    state = state.apply(state.tr.split(offset + 1))
    assert.equal(state.doc.firstChild!.attrs.markId, id)
    assert.equal(state.doc.firstChild!.attrs.markFontSize, 24)
    assert.notEqual(state.doc.lastChild!.attrs.markId, id)
    assert.equal(state.doc.lastChild!.attrs.markFontSize, null)
    const result = exportMarkdownWithMap(state.doc.toJSON(), base, source), marks = parseMarks(result.source)
    assert.equal(marks.length, 2); assert.equal(marks[0].id, id)
    assert.equal(readMarkDocument(result.source).body, 'LeftRight'.slice(0, offset) + '\n\n' + 'LeftRight'.slice(offset))
  }
})
test('rich merging retains first identity, and deleted identities cannot return via stale node insertion', () => {
  let { source, base, state } = fixture('First\n\nSecond', true)
  const first = state.doc.firstChild!, second = state.doc.lastChild!
  state = state.apply(state.tr.join(first.nodeSize))
  const joined = exportMarkdownWithMap(state.doc.toJSON(), base, source)
  assert.equal(state.doc.firstChild!.attrs.markId, first.attrs.markId)
  assert.ok(readMarkDocument(joined.source).metadata!.retiredIds!.includes(second.attrs.markId))
  state = state.apply(state.tr.insert(state.doc.content.size, second))
  assert.notEqual(state.doc.lastChild!.attrs.markId, second.attrs.markId)
  const restoredText = exportMarkdownWithMap(state.doc.toJSON(), base, joined.source)
  assert.equal(parseMarks(restoredText.source).length, 2)
})
test('rich duplicate insertion before original copies appearance but never steals original identity', () => {
  let { state } = fixture('Original\n\nAfter', true)
  const original = state.doc.firstChild!, id = original.attrs.markId
  state = state.apply(state.tr.insert(0, original))
  assert.notEqual(state.doc.firstChild!.attrs.markId, id)
  assert.equal(state.doc.child(1).attrs.markId, id)
  assert.equal(state.doc.firstChild!.attrs.markFontSize, 24)
  assert.equal(state.doc.firstChild!.attrs.sourceId, null)
  const slice = cleanPastedMarkSlice(new Slice(Fragment.from(original), 0, 0))
  assert.notEqual(slice.content.firstChild!.attrs.markId, id)
  assert.equal(slice.content.firstChild!.attrs.markFontSize, 24)
})
test('rich internal moves preserve identities and styles, while trusted history restore restores retired identities', () => {
  let { state } = fixture('First\n\nSecond', true)
  const original = state.doc, first = original.firstChild!, second = original.lastChild!
  state = state.apply(state.tr.delete(0, first.nodeSize).insert(second.nodeSize, first))
  assert.equal(state.doc.lastChild!.attrs.markId, first.attrs.markId)
  assert.equal(state.doc.lastChild!.attrs.markFontSize, 24)
  state = state.apply(state.tr.delete(0, second.nodeSize))
  state = state.apply(state.tr.replaceWith(0, state.doc.content.size, original.content).setMeta('preventUpdate', true))
  assert.deepEqual(state.doc.toJSON(), original.toJSON())
})
test('rich insertions immediately acquire independent identities and mappings cover all semantic Marks', () => {
  let { source, base, state } = fixture('Before')
  state = state.apply(state.tr.insert(state.doc.content.size, schema.nodes.paragraph.create(null, schema.text('New'))))
  const added = state.doc.lastChild!.attrs.markId
  assert.match(added, /^[\da-f-]{36}$/)
  const result = exportMarkdownWithMap(state.doc.toJSON(), base, source)
  assert.deepEqual(result.marks.map(mark => mark.type), ['paragraph', 'paragraph'])
  assert.equal(parseMarks(result.source)[1].id, added)
})

test('rich block-type conversion retains identity and style even when the command resets attributes', () => {
  let { source, base, state } = fixture('Title', true)
  const id = state.doc.firstChild!.attrs.markId
  state = state.apply(state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 }))
  assert.equal(state.doc.firstChild!.attrs.markId, id)
  assert.equal(state.doc.firstChild!.attrs.markFontSize, 24)
  const heading = exportMarkdownWithMap(state.doc.toJSON(), base, source)
  assert.equal(readMarkDocument(heading.source).body, '## Title')
  assert.equal(parseMarks(heading.source)[0].id, id)
  state = state.apply(state.tr.setNodeMarkup(0, schema.nodes.paragraph))
  assert.equal(state.doc.firstChild!.attrs.markId, id)
  assert.equal(parseMarks(exportMarkdownWithMap(state.doc.toJSON(), base, heading.source).source)[0].id, id)
})

test('rich Enter inside a root list item splits identities at the item boundary', () => {
  let { source, base, plugin, state } = fixture('- LeftRight\n- After', true)
  const id = state.doc.firstChild!.firstChild!.attrs.markId
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7)))
  plugin.props.handleKeyDown!.call(plugin, { state } as EditorView, { key: 'Enter', shiftKey: false } as KeyboardEvent)
  assert.equal(splitListItem(schema.nodes.listItem)(state, transaction => { state = state.apply(transaction) }), true)
  const list = state.doc.firstChild!
  assert.equal(list.childCount, 3)
  assert.equal(list.child(0).attrs.markId, id)
  assert.notEqual(list.child(1).attrs.markId, id)
  assert.equal(list.child(1).attrs.markFontSize, null)
  const output = exportMarkdownWithMap(state.doc.toJSON(), base, source)
  assert.deepEqual(output.marks.map(mark => mark.type), ['listItem', 'listItem', 'listItem'])
  assert.equal(readMarkDocument(output.source).body, '- Left\n- Right\n- After')
})
