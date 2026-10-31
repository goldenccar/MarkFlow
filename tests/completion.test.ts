import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState as SourceState, Transaction as SourceTransaction } from '@codemirror/state'
import { keymap, type EditorView as SourceView } from '@codemirror/view'
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { slashCommands, slashToken, rankCompletions, parseCompletionUsage } from '../src/renderer/completion'
import { sourceCompletion, slashCompletionSource } from '../src/renderer/sourceCompletion'
import { indentRichParagraphs, richIndent } from '../src/renderer/richCompletion'
import { createRichIdentityPlugin, richExtensions } from '../src/renderer/richExtensions'
import { ensureMarkDocument, parseMarks, readMarkDocument } from '../src/shared/marks'
import { importMarkdown, exportMarkdownWithMap } from '../src/shared/richMarkdown'

test('slash activation excludes URLs, fractions, escapes and command interiors', () => {
  for (const text of ['https://', 'a/b', '1 /', 'a /', '\\\\', '\\\\frac', 'word\\frac', 'path/to/']) assert.equal(slashToken(text), null, text)
  assert.equal(slashToken('\\fr', 'ac'), null)
  assert.equal(slashToken('text /h1', '', 'markdown'), null)
  assert.deepEqual(slashToken('/'), { from: 0, to: 1, marker: '/', query: '' })
  assert.equal(slashToken('$\\fr')?.query, 'fr')
  assert.equal(slashToken('  /h2', '', 'markdown')?.query, 'h2')
})
test('exact and prefix matches outrank frequency; ties use accepted count and recency', () => {
  const usage = { 'tex:subsection': { count: 999, last: 10 }, 'tex:section': { count: 1, last: 2 } }
  assert.equal(rankCompletions(slashToken('\\section')!, 'latex', usage)[0].label, 'section')
  assert.equal(rankCompletions(slashToken('\\sec')!, 'latex', usage)[0].label, 'section')
  assert.equal(rankCompletions(slashToken('\\')!, 'latex', usage)[0].label, 'subsection')
  const recent = { 'tex:alpha': { count: 2, last: 8 }, 'tex:beta': { count: 2, last: 9 } }
  assert.equal(rankCompletions(slashToken('\\')!, 'latex', recent)[0].label, 'beta')
  assert.equal(rankCompletions(slashToken('/h')!, 'markdown', usage)[0].label, 'h1')
})
test('usage storage rejects corrupt, oversized or unknown records and bounds counts', () => {
  for (const raw of ['null', '[]', '{', 'x'.repeat(17000)]) assert.equal(Object.keys(parseCompletionUsage(raw)).length, 0)
  const values = parseCompletionUsage(JSON.stringify({ documentText: 'secret', 'tex:frac': { count: 1e12, last: 1 }, 'tex:sqrt': { count: -1, last: 1 }, 'tex:alpha': { count: 3, last: 'bad' } }))
  assert.deepEqual(Object.keys(values), ['tex:frac']); assert.equal(values['tex:frac'].count, 10000)
})
function sourceFixture(text: string, selection = { anchor: text.length }, readOnly = false) {
  let state = SourceState.create({ doc: text, selection, extensions: [sourceCompletion('latex', () => {}), SourceState.readOnly.of(readOnly)] })
  const view = { get state() { return state }, composing: false, dispatch: (spec: Parameters<SourceState['update']>[0] | SourceTransaction) => { state = spec instanceof SourceTransaction ? spec.state : state.update(spec).state } } as unknown as SourceView
  return view
}
test('source completion replaces only its token, puts caret inside braces and guards read-only', () => {
  for (const [initial, mode, expected] of [['x + \\fr', 'latex', 'x + \\frac{}{}'], ['\\fr', 'markdown', '$\\frac{}{}$'], ['$\\fr$', 'markdown', '$\\frac{}{}$'], ['$$\n\\fr', 'markdown', '$$\n\\frac{}{}']] as const) {
    const cursor = initial.endsWith('$') ? initial.length - 1 : initial.length, view = sourceFixture(initial, { anchor: cursor })
    const result = slashCompletionSource(mode)(new CompletionContext(view.state, cursor, false)) as CompletionResult
    const option = result.options[0]
    assert.equal(typeof option.apply, 'function')
    if (typeof option.apply === 'function') option.apply(view, option, result.from, result.to!)
    assert.equal(view.state.doc.toString(), expected)
    assert.equal(view.state.sliceDoc(view.state.selection.main.head - 1, view.state.selection.main.head + 1), '{}')
  }
  const readonly = sourceFixture('\\fr', undefined, true)
  assert.equal(slashCompletionSource('latex')(new CompletionContext(readonly.state, 3, false)), null)
  assert.ok(slashCommands.find(command => command.label === 'aligned')!.insert.includes('\\\\\n'))
})
test('plain source Tab indents selected lines by two spaces and Shift-Tab reverses without replacing text', () => {
  const view = sourceFixture('first\nsecond', { anchor: 2, head: 9 } as { anchor: number })
  const run = (key: string) => view.state.facet(keymap).flat().find(binding => binding.key === key)!.run!(view)
  assert.equal(run('Tab'), true); assert.equal(view.state.doc.toString(), '  first\n  second')
  assert.equal(run('Shift-Tab'), true); assert.equal(view.state.doc.toString(), 'first\nsecond')
  Object.defineProperty(view, 'composing', { value: true })
  assert.equal(run('Tab'), false); assert.equal(view.state.doc.toString(), 'first\nsecond')
  const readonly = sourceFixture('text', undefined, true)
  assert.equal(readonly.state.facet(keymap).flat().find(binding => binding.key === 'Tab')!.run!(readonly), false)
})
const schema = getSchema(richExtensions(() => ({ path: 'doc.md', onNavigate() {}, onExternal() {} }), () => {}, () => {}, () => {}))
test('rich paragraph indentation survives Markdown, retains IDs and reverses selected paragraphs', () => {
  const source = ensureMarkDocument('First\n\nSecond'), base = importMarkdown(source)
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(base.doc), plugins: [createRichIdentityPlugin()] })
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, state.doc.content.size - 2)))
  const dispatch = (transaction: Parameters<EditorState['apply']>[0]) => { state = state.apply(transaction) }
  indentRichParagraphs(state, dispatch)
  const exported = exportMarkdownWithMap(state.doc.toJSON(), base, source)
  assert.equal(readMarkDocument(exported.source).body, `${richIndent}First\n\n${richIndent}Second`)
  assert.deepEqual(parseMarks(exported.source).map(mark => mark.id), parseMarks(source).map(mark => mark.id))
  const reopened = schema.nodeFromJSON(importMarkdown(exported.source).doc)
  assert.equal(reopened.firstChild!.textContent, richIndent + 'First')
  indentRichParagraphs(state, dispatch, true)
  assert.equal(readMarkDocument(exportMarkdownWithMap(state.doc.toJSON(), base, source).source).body, 'First\n\nSecond')
})
test('rich code Tab indents the selected code lines, not the whole code block', () => {
  let state = EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('codeBlock', null, schema.text('first\nsecond\nthird'))]) })
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8)))
  indentRichParagraphs(state, transaction => { state = state.apply(transaction) })
  assert.equal(state.doc.textContent, 'first\n  second\nthird')
  indentRichParagraphs(state, transaction => { state = state.apply(transaction) }, true)
  assert.equal(state.doc.textContent, 'first\nsecond\nthird')
})
