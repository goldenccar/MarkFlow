import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EditorState, Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { getSchema } from '@tiptap/core'
import { EditorState as RichState } from '@tiptap/pm/state'
import { createDefaultCompletionSettings, normalizeCompletionSettings, validateCompletionSettings, type CompletionEngine } from '../src/shared/completionSettings'
import { defaultSettings } from '../src/shared/types'
import { getSettings, putSettings } from '../src/main/files'
import { builtinCompletionCommands, completionUsageKey, rankCompletions, recordCompletion, slashToken } from '../src/renderer/completion'
import { slashCompletionSource } from '../src/renderer/sourceCompletion'
import { allowsRichCompletion, customRichContent, indentRichParagraphs, richCompletionCommand } from '../src/renderer/richCompletion'
import { richExtensions } from '../src/renderer/richExtensions'

test('completion preferences default each engine independently and recover valid old fields', () => {
  const defaults = normalizeCompletionSettings(undefined)
  assert.deepEqual(Object.keys(defaults), ['markdown', 'formula', 'latex'])
  defaults.formula.enabled = false
  assert.equal(defaults.markdown.enabled, true); assert.equal(defaults.latex.enabled, true)
  const loaded = normalizeCompletionSettings({ markdown: { matching: 'broken', triggers: { slash: false, backslash: 'no' }, customCommands: [null, { id: 'good', trigger: 'Hello', description: '说明', content: '正文' }, { id: 'bad', trigger: '/bad', description: '', content: 'bad' }] }, formula: null })
  assert.equal(loaded.markdown.matching, 'contains'); assert.deepEqual(loaded.markdown.triggers, { slash: false, backslash: true })
  assert.deepEqual(loaded.markdown.customCommands.map(item => item.trigger), ['hello']); assert.equal(loaded.formula.enabled, true)
})
test('strict completion validation rejects duplicate keywords, IDs, size abuse and bad triggers', () => {
  const item = { id: 'one', trigger: 'memo', description: '说明', content: '正文' }
  for (const commands of [
    [item, { ...item, id: 'two', trigger: 'MEMO' }], [item, { ...item, trigger: 'other' }],
    [{ ...item, trigger: '/memo' }], [{ ...item, content: 'x'.repeat(4097) }], [{ ...item, content: '\0' }],
    Array.from({ length: 33 }, (_, index) => ({ ...item, id: String(index), trigger: `word${index}` })),
    Array.from({ length: 17 }, (_, index) => ({ ...item, id: String(index), trigger: `word${index}`, content: 'x'.repeat(4096) })),
  ]) assert.throws(() => validateCompletionSettings({ markdown: { customCommands: commands } }), /补全设置无效/)
  assert.throws(() => validateCompletionSettings({ formula: { triggers: { slash: 'yes' } } }), /触发符/)
})
test('rules separate formula and full LaTeX catalogs and preserve matching priority over sorting', () => {
  assert.ok(!builtinCompletionCommands('formula').some(item => item.label === 'section'))
  assert.ok(builtinCompletionCommands('latex').some(item => item.label === 'section'))
  const settings = createDefaultCompletionSettings().latex
  settings.matching = 'prefix'
  assert.deepEqual(rankCompletions(slashToken('\\section')!, 'latex', {}, settings).map(item => item.label), ['section'])
  settings.matching = 'contains'; settings.sort = 'alphabetical'
  assert.deepEqual(rankCompletions(slashToken('\\sec')!, 'latex', {}, settings).map(item => item.label), ['section', 'subsection'])
  const alphabetical = rankCompletions(slashToken('\\')!, 'latex', { 'tex:sqrt': { count: 999, last: 100 } }, settings)
  assert.equal(alphabetical[0].label, 'aligned')
  settings.triggers.slash = false
  assert.equal(slashToken('/', '', 'latex', settings), null)
  assert.ok(slashToken('\\', '', 'latex', settings))
  settings.enabled = false
  assert.equal(slashToken('\\', '', 'latex', settings), null)
})
test('custom keywords override builtins only in their engine and disabled commands are excluded', () => {
  const settings = createDefaultCompletionSettings()
  settings.formula.customCommands.push({ id: 'fraction', trigger: 'frac', description: '我的分式', content: '\\frac{a+b}{c}' })
  const token = slashToken('\\frac')!
  assert.deepEqual(rankCompletions(token, 'formula', {}, settings.formula).map(item => item.id), ['custom:fraction'])
  assert.deepEqual(rankCompletions(token, 'latex', {}, settings.latex).map(item => item.id), ['tex:frac'])
  settings.formula.disabledCommands.push('custom:fraction')
  assert.equal(rankCompletions(token, 'formula', {}, settings.formula).length, 0)
  settings.formula.customCommands = []; settings.formula.disabledCommands = ['tex:frac']
  assert.equal(rankCompletions(token, 'formula', {}, settings.formula).length, 0)
})
test('live source rules reject stale menu acceptance and insert custom text literally without recreating state', () => {
  let rules = createDefaultCompletionSettings().formula, engine: CompletionEngine = 'formula'
  let state = EditorState.create({ doc: '\\fr', selection: { anchor: 3 } })
  const view = { get state() { return state }, composing: false, dispatch: (value: Parameters<EditorState['update']>[0] | Transaction) => { state = value instanceof Transaction ? value.state : state.update(value).state } } as unknown as EditorView
  const source = slashCompletionSource(() => engine, () => {}, () => rules), context = () => new CompletionContext(state, state.selection.main.head, false)
  const result = source(context()) as CompletionResult, option = result.options[0], originalState = state
  rules = { ...rules, enabled: false }
  if (typeof option.apply === 'function') option.apply(view, option, result.from, result.to!)
  assert.equal(state, originalState); assert.equal(source(context()), null)
  rules = { ...rules, enabled: true, customCommands: [{ id: 'literal', trigger: 'fr', description: '纯文本', content: '<img src=x onerror=alert(1)>' }] }
  const customResult = source(context())!, custom = customResult.options[0]
  if (typeof custom.apply === 'function') custom.apply(view, custom, customResult.from, customResult.to!)
  assert.equal(state.doc.toString(), '<img src=x onerror=alert(1)>')
  state = EditorState.create({ doc: '\\sec', selection: { anchor: 4 } }); rules = createDefaultCompletionSettings().latex; engine = 'latex'
  assert.ok(source(context())!.options.some(item => item.label === '\\section'))
})
test('custom Markdown creates only safe schema nodes and never carries copied Mark IDs', () => {
  const schema = getSchema(richExtensions(() => ({ path: 'doc.md', onExternal() {}, onNavigate() {} }), () => {}, () => {}, () => {}))
  const content = customRichContent('## 标题\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
  const doc = schema.nodeFromJSON({ type: 'doc', content }); doc.check()
  assert.equal(content[0].type, 'heading')
  assert.ok(content.some(node => node.type === 'opaqueBlock' && node.attrs?.raw.includes('<script>')))
  assert.ok(!JSON.stringify(content).includes('"onerror":'))
  doc.descendants(node => { if (node.attrs.markId !== undefined) assert.equal(node.attrs.markId, null) })
})
test('rich indentation, accepted snippets and history restoration cannot reopen completion', () => {
  const schema = getSchema(richExtensions(() => ({ path: 'doc.md', onExternal() {}, onNavigate() {} }), () => {}, () => {}, () => {}))
  const state = RichState.create({ schema, doc: schema.node('doc', null, schema.node('paragraph', null, schema.text('/h'))) })
  assert.equal(allowsRichCompletion(state.tr.insertText('2', 3)), true)
  indentRichParagraphs(state, transaction => { assert.equal(allowsRichCompletion(transaction), false) })
  const completion = state.tr.insertText('/').setMeta(richCompletionCommand, true)
  assert.equal(allowsRichCompletion(completion), false)
  const restoration = state.tr.insertText('/').setMeta('preventUpdate', true)
  assert.equal(allowsRichCompletion(restoration), false)
  // The identity plugin's appended transaction must not turn a silent command back into typing.
  assert.equal(allowsRichCompletion(state.tr.setNodeMarkup(0).setMeta('appendedTransaction', completion)), false)
  assert.equal(allowsRichCompletion(state.tr.setNodeMarkup(0).setMeta('appendedTransaction', restoration)), false)
})
test('usage counts are engine-isolated, bounded and contain IDs rather than snippet text', () => {
  const stored = new Map<string, string>(), previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) } })
  try {
    recordCompletion('custom:isolated', 'formula'); recordCompletion('custom:isolated', 'formula'); recordCompletion('custom:isolated', 'latex')
    assert.equal(JSON.parse(stored.get(`${completionUsageKey}:formula`)!)['custom:isolated'].count, 2)
    assert.equal(JSON.parse(stored.get(`${completionUsageKey}:latex`)!)['custom:isolated'].count, 1)
    for (let index = 0; index < 140; index++) recordCompletion(`custom:old${index}`, 'markdown')
    const value = JSON.parse(stored.get(`${completionUsageKey}:markdown`)!)
    assert.equal(Object.keys(value).length, 128); assert.ok(value['custom:old139'])
    assert.ok(Object.values(value).every(item => Object.keys(item as object).sort().join(',') === 'count,last'))
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage') }
})
test('application settings persist all engine rules; invalid saves leave the last good file intact', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markflow-completion-settings-'))
  try {
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ ...defaultSettings, completion: undefined }))
    const settings = await getSettings(directory)
    settings.completion.formula.triggers.slash = false
    settings.completion.latex.customCommands.push({ id: 'title', trigger: 'title', description: '标题', content: '\\title{Hello}' })
    await putSettings(directory, settings)
    assert.deepEqual((await getSettings(directory)).completion, settings.completion)
    const before = await fs.readFile(path.join(directory, 'settings.json'), 'utf8')
    await assert.rejects(putSettings(directory, { ...settings, completion: { ...settings.completion, formula: { ...settings.completion.formula, sort: 'bad' as 'usage' } } }), /排序方式/)
    assert.equal(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'), before)
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ ...settings, completion: { ...settings.completion, markdown: { enabled: false, customCommands: 'corrupt' } } }))
    const recovered = await getSettings(directory)
    assert.equal(recovered.completion.markdown.enabled, false); assert.deepEqual(recovered.completion.latex, settings.completion.latex)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
