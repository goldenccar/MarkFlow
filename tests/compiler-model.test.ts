import assert from 'node:assert/strict'
import test from 'node:test'
import { MarkEngine } from '../src/engine/index'
import { CompilationError, diagnostic, throwIfErrors } from '../src/compiler/diagnostics'
import { applySemanticCommands, normalizeDocument, semanticEngineOptions } from '../src/compiler/model'
import type { MarkDocumentInput, SemanticContent } from '../src/compiler/types'

const paragraph = (text: string): SemanticContent => ({ kind: 'paragraph', runs: [{ text }] })
const source = { file: 'source.md', from: 0, to: 8, line: 1, column: 1 }
function document(): MarkDocumentInput {
  return {
    format: 'markflow', version: 1, documentId: 'report', revision: 7,
    marks: [
      { id: 'heading', content: { kind: 'heading', level: 1, runs: [{ text: '中文标题', format: { bold: true, highlight: '#fff2a8' } }] }, style: { fontFamily: 'Microsoft YaHei', fontSize: 24 }, source: { ...source } },
      { id: 'paragraph', content: { kind: 'paragraph', runs: [{ text: 'Linked text', format: { italic: true, underline: false, strike: false, script: 'superscript', link: 'https://example.com/evidence' } }] }, source: { file: 'source.json', pointer: '/marks/1' } },
      { id: 'list', content: { kind: 'list-item', ordered: true, ordinal: 2, runs: [{ text: '第二项' }] } },
      { id: 'image', content: { kind: 'image', assetId: 'picture', alt: '示意图', caption: '图一' } },
      { id: 'table', content: { kind: 'table', header: true, rows: [[[{ text: '项目' }], [{ text: '值' }]], [[{ text: 'A' }], []]] } },
      { id: 'alias', content: { kind: 'reference', targetId: 'paragraph' } },
    ],
    assets: [{ id: 'picture', path: 'images/中文 图.png' }], retiredIds: ['deleted'],
    consumedSources: [{ id: 'definition', source: { file: 'source.md', from: 80, to: 110 } }],
  }
}
const errorCode = (code: string, markId?: string) => (error: unknown) => error instanceof CompilationError
  && error.diagnostics.some(item => item.code === code && (markId === undefined || item.markId === markId))

test('normalization preserves flat identities, source positions, explicit overrides and assets without adopting caller objects', () => {
  const input = document(), before = structuredClone(input), normalized = normalizeDocument(input)
  assert.equal(normalized.documentId, 'report')
  assert.equal(normalized.snapshot.revision, 7)
  assert.deepEqual(normalized.snapshot.roots.map(mark => mark.id), input.marks.map(mark => mark.id))
  assert.deepEqual(normalized.snapshot.retiredIds, ['deleted'])
  assert.deepEqual(normalized.snapshot.roots[0].style, input.marks[0].style)
  assert.deepEqual(normalized.snapshot.roots[1].style, {})
  assert.deepEqual(normalized.sources.heading, source)
  assert.deepEqual(normalized.consumedSources, input.consumedSources)
  assert.deepEqual(normalized.assets, input.assets)
  assert.deepEqual(input, before)
  normalized.snapshot.roots[0].style.fontSize = 99
  normalized.sources.heading.from = 99
  normalized.assets[0].path = 'other.png'
  assert.deepEqual(input, before)
})

test('unknown fields are rejected at each schema boundary with a useful field path', () => {
  const mutations: Array<(value: any) => void> = [
    value => { value.silent = true }, value => { value.marks[0].children = [] },
    value => { value.marks[0].content.unrecognized = true }, value => { value.marks[0].content.runs[0].font = 'font' },
    value => { value.marks[0].content.runs[0].format.color = '#ffffff' }, value => { value.marks[0].style.spacing = 12 },
    value => { value.marks[0].source.exact = true }, value => { value.assets[0].mime = 'image/png' },
    value => { value.consumedSources[0].hiddenContent = 'do not silently discard' },
  ]
  for (const mutate of mutations) {
    const input = document(); mutate(input)
    assert.throws(() => normalizeDocument(input), error => error instanceof CompilationError && error.diagnostics[0].code === 'UNKNOWN_FIELD' && !!error.diagnostics[0].field)
  }
})

test('engine JSON validation rejects getters without executing them, cycles and data JSON would silently alter', () => {
  let invoked = false
  const getter = Object.defineProperty({}, 'format', { enumerable: true, get() { invoked = true; return 'markflow' } })
  assert.throws(() => normalizeDocument(getter), errorCode('INVALID_JSON'))
  assert.equal(invoked, false)
  const cyclic: any = {}; cyclic.self = cyclic
  for (const input of [cyclic, { value: NaN }, { value: Infinity }, { value: undefined }, { value: Array(1) }, { value: new Date() }, { [Symbol('hidden')]: true }]) {
    assert.throws(() => normalizeDocument(input), errorCode('INVALID_JSON'))
  }
})

test('versions, revisions and identity namespaces reject invalid or colliding entries', () => {
  for (const metadata of [{ format: 'other' }, { version: 2 }]) assert.throws(() => normalizeDocument({ ...document(), ...metadata }), errorCode('UNSUPPORTED_VERSION'))
  for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => normalizeDocument({ ...document(), revision }), errorCode('INVALID_SCHEMA'))
  assert.throws(() => normalizeDocument({ ...document(), documentId: '../escape' }), errorCode('INVALID_ID'))
  const duplicate = document(); duplicate.marks[1].id = duplicate.marks[0].id
  assert.throws(() => normalizeDocument(duplicate), errorCode('DUPLICATE_ID'))
  for (const extras of [{ retiredIds: ['heading'] }, { retiredIds: ['a', 'a'] }, { retiredIds: null }, { consumedSources: null }, { consumedSources: [{ id: 'heading', source }] }, { consumedSources: [{ id: 'deleted', source }] }]) {
    assert.throws(() => normalizeDocument({ ...document(), ...extras }), CompilationError)
  }
  const duplicateAsset = document(); duplicateAsset.assets.push({ ...duplicateAsset.assets[0] })
  assert.throws(() => normalizeDocument(duplicateAsset), errorCode('DUPLICATE_ASSET'))
})

test('text styling accepts typed inline formats but rejects executable links, invalid colors and implicit fonts', () => {
  const input = document()
  for (const href of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'https://user:secret@example.com', ' https://example.com', 'https:\\example.com', 'https://example.com\n/path']) {
    input.marks[1].content = { kind: 'paragraph', runs: [{ text: 'link', format: { link: href } }] }
    assert.throws(() => normalizeDocument(input), errorCode('UNSAFE_LINK', 'paragraph'))
  }
  input.marks[1].content = { kind: 'paragraph', runs: [{ text: 'email', format: { link: 'mailto:hello@example.com' } }] }
  assert.doesNotThrow(() => normalizeDocument(input))
  for (const format of [{ bold: 'yes' }, { script: 'baseline' }, { highlight: 'red' }, { highlight: '#ff00ff00' }]) {
    input.marks[1].content = { kind: 'paragraph', runs: [{ text: 'text', format }] } as never
    assert.throws(() => normalizeDocument(input), CompilationError)
  }
  input.marks[1].content = paragraph('valid')
  for (const fontFamily of ['system', 'system-ui', 'serif', 'Arial, sans-serif']) {
    input.marks[1].style = { fontFamily }
    assert.throws(() => normalizeDocument(input), errorCode('IMPLICIT_FONT', 'paragraph'))
  }
  input.marks[1].style = { fontSize: -1 }
  assert.throws(() => normalizeDocument(input), errorCode('INVALID_STYLE', 'paragraph'))
  input.marks[1].style = {}
  input.marks[1].content = paragraph('\ud800')
  assert.throws(() => normalizeDocument(input), errorCode('INVALID_SCHEMA', 'paragraph'))
})

test('simple lists and rectangular tables reject missing ordinals, mixed shapes and merged-cell fields', () => {
  const cases = [
    { kind: 'list-item', ordered: true, runs: [] },
    { kind: 'list-item', ordered: true, ordinal: 0, runs: [] },
    { kind: 'list-item', ordered: false, ordinal: 1, runs: [] },
    { kind: 'table', header: false, rows: [] },
    { kind: 'table', header: false, rows: [[]] },
    { kind: 'table', header: false, rows: [[[]], [[], []]] },
    { kind: 'table', header: false, rows: [[{ runs: [], colspan: 2 }]] },
    { kind: 'heading', level: 7, runs: [] },
  ]
  for (const content of cases) assert.throws(() => normalizeDocument({ ...document(), marks: [{ id: 'invalid', content }] }), CompilationError)
  assert.doesNotThrow(() => normalizeDocument({ ...document(), marks: [{ id: 'empty-item', content: { kind: 'list-item', ordered: false, runs: [] } }] }))
})

test('assets are local portable paths and every image reference must resolve in the asset registry', () => {
  const input = document()
  for (const path of ['../a.png', '/a.png', 'C:\\a.png', 'https://example.com/a.png', '.git/a.png', 'a/../../b.png', 'CON.png']) {
    input.assets[0].path = path
    assert.throws(() => normalizeDocument(input), errorCode('UNSAFE_ASSET_PATH'))
  }
  input.assets[0].path = 'images\\safe.png'
  assert.equal(normalizeDocument(input).assets[0].path, 'images/safe.png')
  input.assets = []
  assert.throws(() => normalizeDocument(input), errorCode('MISSING_ASSET', 'image'))
})

test('content aliases reject dangling, retired, definition-only and cyclic targets', () => {
  const input = document()
  for (const targetId of ['absent', 'deleted', 'definition']) {
    input.marks[5].content = { kind: 'reference', targetId }
    assert.throws(() => normalizeDocument(input), errorCode('INVALID_REFERENCE', 'alias'))
  }
  input.marks[5].content = { kind: 'reference', targetId: 'alias' }
  assert.throws(() => normalizeDocument(input), errorCode('REFERENCE_CYCLE', 'alias'))
  input.marks[5].content = { kind: 'reference', targetId: 'paragraph' }
  input.marks[1].content = { kind: 'reference', targetId: 'alias' }
  assert.throws(() => normalizeDocument(input), errorCode('REFERENCE_CYCLE'))
})

test('source coordinates are validated independently from semantic content and surfaced in diagnostics', () => {
  for (const invalid of [{ file: '' }, { file: 'x', from: 8, to: 3 }, { file: 'x', from: 0 }, { file: 'x', line: 0 }, { file: 'x', column: 1 }, { file: 'x', pointer: '/bad~escape' }]) {
    const input = document(); input.marks[0].source = invalid as never
    assert.throws(() => normalizeDocument(input), CompilationError)
  }
  const input = document(); input.marks[0].content = { kind: 'heading', level: 0, runs: [] } as never
  assert.throws(() => normalizeDocument(input), error => error instanceof CompilationError && error.diagnostics[0].documentId === input.documentId
    && error.diagnostics[0].markId === 'heading' && error.diagnostics[0].field === 'marks.0.content.level' && error.diagnostics[0].source?.file === source.file)
})

test('semantic engine options reuse engine reference remapping and history without owning a second transaction model', () => {
  let count = 0
  const engine = new MarkEngine<SemanticContent>([{ id: 'group', content: paragraph('group'), children: [{ id: 'alias', content: { kind: 'reference', targetId: 'group' } }] }], { ...semanticEngineOptions, idFactory: () => `new-${++count}` })
  const copied = engine.transact([{ type: 'copy', id: 'group', parentId: null, index: 1 }])
  assert.deepEqual(copied.roots[1].children[0].content, { kind: 'reference', targetId: 'new-1' })
  assert.equal(engine.undo()!.roots.length, 1)
  assert.equal(engine.redo()!.roots[1].id, 'new-1')
})

test('semantic commands preserve document metadata and moved sources, clear changed sources, and leave copied origins unset', () => {
  const input = document(), original = structuredClone(input)
  const moved = applySemanticCommands(input, [{ type: 'move', id: 'paragraph', parentId: null, index: 0 }, { type: 'style', id: 'heading', patch: { fontSize: 28 } }], 7)
  assert.equal(moved.revision, 8)
  assert.equal(moved.marks[0].id, 'paragraph')
  assert.deepEqual(moved.marks[0].source, input.marks[1].source)
  assert.deepEqual(moved.marks.find(mark => mark.id === 'heading')!.source, source)
  const edited = applySemanticCommands(moved, [{ type: 'edit', id: 'paragraph', content: paragraph('changed') }, { type: 'copy', id: 'heading', parentId: null, index: 1 }], 8)
  assert.equal(edited.marks[0].source, undefined)
  assert.notEqual(edited.marks[1].id, 'heading')
  assert.equal(edited.marks[1].source, undefined)
  assert.deepEqual(edited.marks[1].style, { fontFamily: 'Microsoft YaHei', fontSize: 28 })
  assert.deepEqual(edited.assets, input.assets)
  assert.deepEqual(edited.consumedSources, input.consumedSources)
  assert.deepEqual(edited.retiredIds, input.retiredIds)
  assert.deepEqual(input, original)
  const split = applySemanticCommands(edited, [{ type: 'split', id: 'heading', parts: [{ content: paragraph('one') }, { content: paragraph('two') }] }], 9)
  const first = split.marks.findIndex(mark => mark.id === 'heading')
  assert.equal(split.marks[first].source, undefined)
  assert.deepEqual(split.marks[first + 1].style, {})
  const merged = applySemanticCommands(split, [{ type: 'merge', ids: ['heading', split.marks[first + 1].id], content: paragraph('one two') }], 10)
  assert.equal(merged.marks.find(mark => mark.id === 'heading')!.source, undefined)
  assert.ok(merged.retiredIds!.includes(split.marks[first + 1].id))
})

test('failed semantic batches are atomic; references can be repaired within one batch and deleted IDs cannot be reused later', () => {
  const input = document(), before = structuredClone(input)
  assert.throws(() => applySemanticCommands(input, [{ type: 'remove', id: 'paragraph' }], 7), errorCode('INVALID_REFERENCE'))
  assert.throws(() => applySemanticCommands(input, [{ type: 'edit', id: 'heading', content: paragraph('changed') }], 6), errorCode('REVISION_CONFLICT'))
  assert.throws(() => applySemanticCommands(input, [{ type: 'insert', parentId: null, index: 0, marks: [{ id: 'definition', content: paragraph('repurposed') }] }], 7), errorCode('DUPLICATE_ID'))
  assert.throws(() => applySemanticCommands(input, [{ type: '__proto__' }] as never, 7), errorCode('INVALID_COMMAND'))
  assert.throws(() => applySemanticCommands(input, [{ type: 'edit', id: 'heading', content: paragraph('lost'), unrecognized: true }] as never, 7), errorCode('UNKNOWN_FIELD'))
  assert.throws(() => applySemanticCommands(input, [{ type: 'edit', id: 'heading', content: { kind: 'reference', targetId: 'alias' } }, { type: 'edit', id: 'paragraph', content: { kind: 'reference', targetId: 'heading' } }], 7), errorCode('REFERENCE_CYCLE'))
  assert.throws(() => applySemanticCommands(input, [{ type: 'move', id: 'heading', parentId: 'paragraph', index: 0 }], 7), errorCode('UNSUPPORTED_STRUCTURE'))
  assert.deepEqual(input, before)
  const removed = applySemanticCommands(input, [{ type: 'remove', id: 'paragraph' }, { type: 'edit', id: 'alias', content: paragraph('resolved') }], 7)
  assert.ok(removed.retiredIds!.includes('paragraph'))
  assert.throws(() => applySemanticCommands(removed, [{ type: 'insert', parentId: null, index: 0, marks: [{ id: 'paragraph', content: paragraph('new') }] }], 8), errorCode('RETIRED_ID'))
})

test('diagnostic helpers keep warnings visible while only error diagnostics block compilation', () => {
  const warning = diagnostic('LIMITATION', 'Review final pagination.', { severity: 'warning', documentId: 'report', suggestion: 'Open the exported document in the target application.' })
  assert.doesNotThrow(() => throwIfErrors([warning]))
  const error = diagnostic('INVALID', 'Invalid document.', { markId: 'heading', source })
  assert.throws(() => throwIfErrors([warning, error]), value => value instanceof CompilationError && value.diagnostics.length === 2)
  const failure = new CompilationError([error])
  failure.diagnostics[0].source!.from = 99
  assert.equal(error.source!.from, 0)
})
